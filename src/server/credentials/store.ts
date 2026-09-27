import { randomUUID } from "node:crypto";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { auditLog, credentials, sources } from "@db/schema";
import { seal } from "../crypto/envelope";
import { defaultKeyWrapper, type KeyWrapper } from "../crypto/key-wrapper";
import type { Db } from "../db/client";
import { HttpError } from "../errors";
import { aadFor } from "./aad";
import type { JobLauncher } from "../jobs/launcher";

// Web-side credential operations (CRED-1..7). Everything here can seal
// secrets but never open them: there is no read path for a secret value
// (CRED-4). Testing and OAuth revocation need the plaintext, so they run as
// worker jobs.

export const PROVIDERS = {
  teamsnap: "TeamSnap",
  spordle: "Spordle",
  veracross: "Veracross",
  tennis_tc: "Tennis Canada tournaments",
  commit_swim: "Commit Swimming",
  ical: "Other calendar link",
  google: "Google",
} as const;
export type Provider = keyof typeof PROVIDERS;

// The only shape that leaves the server.
export type CredentialView = {
  id: string;
  kind: string;
  provider: string;
  label: string;
  username: string | null;
  scopes: string[] | null;
  meta: unknown;
  status: string;
  updatedAt: string;
  lastUsedAt: string | null;
  lastTestAt: string | null;
  lastTestOk: boolean | null;
  lastError: string | null;
};

const viewColumns = {
  id: credentials.id,
  kind: credentials.kind,
  provider: credentials.provider,
  label: credentials.label,
  username: credentials.username,
  scopes: credentials.scopes,
  meta: credentials.meta,
  status: credentials.status,
  updatedAt: credentials.updatedAt,
  lastUsedAt: credentials.lastUsedAt,
  lastTestAt: credentials.lastTestAt,
  lastTestOk: credentials.lastTestOk,
  lastError: credentials.lastError,
};

const selectView = (db: Db) => db.select(viewColumns).from(credentials);
type ViewRow = Awaited<ReturnType<typeof selectView>>[number];

function toView(r: ViewRow): CredentialView {
  return {
    ...r,
    updatedAt: r.updatedAt.toISOString(),
    lastUsedAt: r.lastUsedAt?.toISOString() ?? null,
    lastTestAt: r.lastTestAt?.toISOString() ?? null,
  };
}

export async function listCredentials(db: Db): Promise<CredentialView[]> {
  const rows = await selectView(db).orderBy(desc(credentials.createdAt));
  return rows.map(toView);
}

export async function getCredential(db: Db, id: string): Promise<CredentialView> {
  const [row] = await selectView(db).where(eq(credentials.id, id));
  if (!row) throw new HttpError(404, "not found");
  return toView(row);
}

const feedUrl = z
  .string()
  .trim()
  .max(2000)
  .refine(
    (v) => /^(https|webcal):\/\/[^\s]+$/i.test(v) || /^http:\/\/(127\.0\.0\.1|localhost)[:/][^\s]*$/.test(v),
    "must be an https:// or webcal:// link",
  );

export const createCredentialInput = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("password"),
    provider: z.enum(["spordle", "veracross", "tennis_tc", "commit_swim", "teamsnap"]),
    label: z.string().trim().min(1).max(80),
    username: z.string().trim().min(1).max(200),
    secret: z.string().min(1).max(500),
  }),
  z.object({
    kind: z.literal("secret_url"),
    provider: z.enum(["teamsnap", "spordle", "veracross", "ical"]),
    label: z.string().trim().min(1).max(80),
    secret: feedUrl,
  }),
]);

export const updateCredentialInput = z.object({
  label: z.string().trim().min(1).max(80).optional(),
  username: z.string().trim().min(1).max(200).optional(),
  // Omitted or empty: keep the stored secret.
  secret: z.string().max(2000).optional(),
});

export async function createCredential(
  db: Db,
  actor: string,
  input: z.infer<typeof createCredentialInput>,
  wrapper: KeyWrapper = defaultKeyWrapper(),
): Promise<CredentialView> {
  const id = randomUUID();
  const sealed = await seal(wrapper, input.secret, aadFor(id));
  await db.insert(credentials).values({
    id,
    kind: input.kind,
    provider: input.provider,
    label: input.label,
    username: input.kind === "password" ? input.username : null,
    ...sealed,
  });
  await audit(db, actor, "credential.create", id, { provider: input.provider, kind: input.kind });
  return getCredential(db, id);
}

export async function updateCredential(
  db: Db,
  actor: string,
  id: string,
  input: z.infer<typeof updateCredentialInput>,
  wrapper: KeyWrapper = defaultKeyWrapper(),
): Promise<CredentialView> {
  const current = await getCredential(db, id);
  if (current.kind === "oauth" && input.secret) throw new HttpError(400, "reconnect Google instead");
  if (input.secret && current.kind === "secret_url") feedUrl.parse(input.secret);
  const sealed = input.secret ? await seal(wrapper, input.secret, aadFor(id)) : {};
  await db
    .update(credentials)
    .set({
      label: input.label,
      username: current.kind === "password" ? input.username : undefined,
      ...sealed,
      ...(input.secret ? { lastTestAt: null, lastTestOk: null, lastError: null } : {}),
      updatedAt: new Date(),
    })
    .where(eq(credentials.id, id));
  await audit(db, actor, "credential.update", id, { secretChanged: !!input.secret });
  return getCredential(db, id);
}

// CRED-6 "Remove": deletes the ciphertext. An OAuth grant is revoked at
// Google first, which needs the token in plaintext, so the worker finishes
// that removal.
export async function removeCredential(db: Db, actor: string, id: string, launcher: JobLauncher) {
  const current = await getCredential(db, id);
  await db.update(sources).set({ credentialId: null }).where(eq(sources.credentialId, id));
  if (current.kind === "oauth") {
    await db.update(credentials).set({ status: "removing" }).where(eq(credentials.id, id));
    await audit(db, actor, "credential.remove_requested", id, { provider: current.provider });
    await launcher.start(["credential:remove", id]);
    return;
  }
  await db.delete(credentials).where(eq(credentials.id, id));
  await audit(db, actor, "credential.delete", id, { provider: current.provider });
}

// CRED-6 "Test connection": the worker checks the login without syncing and
// writes the result back to the row.
export async function requestTest(db: Db, actor: string, id: string, launcher: JobLauncher) {
  const current = await getCredential(db, id);
  if (current.status !== "active") throw new HttpError(409, "credential is being removed");
  await audit(db, actor, "credential.test_requested", id, { provider: current.provider });
  await launcher.start(["credential:test", id]);
}

export async function audit(db: Db, actor: string, action: string, target: string, details?: object) {
  await db.insert(auditLog).values({ actor, action, target, details: details ?? null });
}
