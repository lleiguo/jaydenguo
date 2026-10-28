import { and, eq, gt, isNull, lt, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { deviceLocations, devices, notifications, sessions } from "@db/schema";
import {
  APNS_ENVIRONMENTS,
  DEFAULT_KINDS,
  MORE_KINDS,
  NOTIFICATION_KINDS,
  OPT_IN_KINDS,
  NOTIFICATION_LABEL,
  type NotificationKind,
} from "../../domain/notifications";
import type { SessionUser } from "../auth/session";
import type { DbOrTx } from "../db/client";
import { HttpError } from "../errors";
import { createLogger, type Logger } from "../log";
import { defaultSender, type PushSender } from "./apns";

// Notifications (intent 0004, PUSH-1..6, plan N7): what happened is stored
// once per dedup key, and each phone that wants that kind gets a push that
// carries only the notification's id and kind (PUSH-2). The app's
// extension fetches the text with its device token before it shows.

export type NewNotification = {
  kind: NotificationKind;
  // One notification per event, ever (PUSH-5): e.g. "clash:<a>|<b>".
  dedupKey: string;
  title: string;
  body: string;
  // The app link path a tap opens (PUSH-4).
  target: string;
};

export type NotifyDeps = {
  sender?: PushSender;
  log?: Logger;
  now?: Date;
  // Only this account's phones (intent 0009, ERA-3: the parent who asked).
  userId?: string;
  // Only this phone (intent 0027: each phone's own "Time to leave").
  deviceId?: string;
};

// What Apple sees: nothing about the family (PUSH-2, AUTH-3).
export const GENERIC_ALERT = { title: "Cookie", body: "New update" };

// Never throws: a notification must not fail the job that noticed the event.
export async function notify(db: DbOrTx, n: NewNotification, deps: NotifyDeps = {}): Promise<string | null> {
  const log = deps.log ?? createLogger();
  try {
    const [row] = await db
      .insert(notifications)
      .values(n)
      .onConflictDoNothing({ target: notifications.dedupKey })
      .returning({ id: notifications.id });
    if (!row) return null;
    const now = deps.now ?? new Date();
    const phones = await db
      .select({
        id: devices.id,
        token: devices.token,
        environment: devices.environment,
        topic: devices.topic,
      })
      .from(devices)
      .innerJoin(sessions, eq(sessions.id, devices.sessionId))
      .where(
        and(
          sql`${n.kind} = any(${devices.kinds})`,
          isNull(sessions.revokedAt),
          gt(sessions.expiresAt, now),
          deps.userId ? eq(sessions.userId, deps.userId) : undefined,
          deps.deviceId ? eq(devices.id, deps.deviceId) : undefined,
        ),
      );
    const sender = deps.sender ?? defaultSender(log);
    const payload = {
      aps: { alert: GENERIC_ALERT, "mutable-content": 1, sound: "default" },
      id: row.id,
      kind: n.kind,
    };
    const results = { sent: 0, invalid: 0, failed: 0 };
    for (const p of phones) {
      const result = await sender.send(
        { token: p.token, environment: p.environment as "sandbox" | "production", topic: p.topic },
        payload,
      );
      results[result]++;
      // PUSH-6: Apple says the token is dead.
      if (result === "invalid") await db.delete(devices).where(eq(devices.id, p.id));
    }
    log("notified", { kind: n.kind, id: row.id, devices: phones.length, ...results });
    return row.id;
  } catch (err) {
    log("notification failed", { kind: n.kind, error: err }, "WARNING");
    return null;
  }
}

// Marks an event as noticed without sending anything (intent 0023): the
// first run's backfill (N-3), and one key per swim or entry so a later push
// lists only what's new. True when the key is new.
export async function claim(db: DbOrTx, kind: NotificationKind, dedupKey: string): Promise<boolean> {
  const rows = await db
    .insert(notifications)
    .values({ kind, dedupKey, title: "", body: "", target: "" })
    .onConflictDoNothing({ target: notifications.dedupKey })
    .returning({ id: notifications.id });
  return rows.length > 0;
}

export async function claimed(db: DbOrTx, dedupKey: string): Promise<Date | null> {
  const [row] = await db
    .select({ createdAt: notifications.createdAt })
    .from(notifications)
    .where(eq(notifications.dedupKey, dedupKey));
  return row?.createdAt ?? null;
}

// Kept 90 days (spec §4.2).
export async function pruneNotifications(db: DbOrTx, now = new Date()) {
  const cutoff = new Date(now.getTime() - 90 * 86_400_000);
  const gone = await db
    .delete(notifications)
    .where(lt(notifications.createdAt, cutoff))
    .returning({ id: notifications.id });
  return gone.length;
}

// --- The phone's registration and settings (PUSH-3) -----------------------

export const registerDeviceInput = z.object({
  token: z.string().regex(/^[0-9a-f]{32,200}$/i, "Not an APNs device token"),
  environment: z.enum(APNS_ENVIRONMENTS),
  topic: z.string().regex(/^com\.jaydenguo\.hub(\.dev)?$/, "Not this app's bundle ID"),
});

// Builds before intent 0027 send `kinds` only; `leavePeople` is whose
// events "Time to leave" covers (TRF-A3), empty for everyone.
export const deviceKindsInput = z
  .object({
    kinds: z.array(z.enum(NOTIFICATION_KINDS)).optional(),
    leavePeople: z.array(z.uuid()).max(20).optional(),
  })
  .refine((v) => v.kinds !== undefined || v.leavePeople !== undefined, "Nothing to change");

export type DeviceSettings = {
  registered: boolean;
  kinds: NotificationKind[];
  available: { kind: NotificationKind; label: string }[];
  // Kinds builds before intent 0023 can't decode; they ignore this field.
  // Never gains a kind (MORE_KINDS).
  more: { kind: NotificationKind; label: string }[];
  // Kinds added after build 23 (intent 0025): a plain string, so a kind a
  // build doesn't know yet can't break it. Builds before 25 ignore it.
  extra: { kind: string; label: string }[];
  // Whose events "Time to leave" covers (intent 0027, TRF-A3); empty for
  // everyone.
  leavePeople: string[];
};

const deviceOnly = (session: SessionUser) => {
  if (session.kind !== "device")
    throw new HttpError(403, "Only the iPhone app can register for notifications.");
};

export async function deviceSettings(db: DbOrTx, session: SessionUser): Promise<DeviceSettings> {
  deviceOnly(session);
  const [row] = await db.select().from(devices).where(eq(devices.sessionId, session.sessionId));
  return {
    registered: !!row,
    kinds: (row?.kinds as NotificationKind[] | undefined) ?? DEFAULT_KINDS,
    available: NOTIFICATION_KINDS.filter((k) => !OPT_IN_KINDS.includes(k)).map((kind) => ({
      kind,
      label: NOTIFICATION_LABEL[kind],
    })),
    more: MORE_KINDS.map((kind) => ({ kind, label: NOTIFICATION_LABEL[kind] })),
    extra: OPT_IN_KINDS.filter((k) => !MORE_KINDS.includes(k)).map((kind) => ({
      kind,
      label: NOTIFICATION_LABEL[kind],
    })),
    leavePeople: row?.leavePeople ?? [],
  };
}

// The app sends its token after each launch; a token that moved to a new
// sign-in leaves the old row.
export async function registerDevice(
  db: DbOrTx,
  session: SessionUser,
  input: z.infer<typeof registerDeviceInput>,
): Promise<DeviceSettings> {
  deviceOnly(session);
  const token = input.token.toLowerCase();
  await db.delete(devices).where(and(eq(devices.token, token), ne(devices.sessionId, session.sessionId)));
  await db
    .insert(devices)
    .values({
      sessionId: session.sessionId,
      token,
      environment: input.environment,
      topic: input.topic,
      kinds: DEFAULT_KINDS,
    })
    .onConflictDoUpdate({
      target: devices.sessionId,
      set: { token, environment: input.environment, topic: input.topic, updatedAt: new Date() },
    });
  return deviceSettings(db, session);
}

export async function setDeviceKinds(
  db: DbOrTx,
  session: SessionUser,
  input: { kinds?: NotificationKind[]; leavePeople?: string[] },
) {
  deviceOnly(session);
  const [row] = await db
    .update(devices)
    .set({
      ...(input.kinds ? { kinds: [...new Set(input.kinds)] } : {}),
      ...(input.leavePeople ? { leavePeople: [...new Set(input.leavePeople)] } : {}),
      updatedAt: new Date(),
    })
    .where(eq(devices.sessionId, session.sessionId))
    .returning({ id: devices.id, kinds: devices.kinds });
  if (!row) throw new HttpError(409, "Turn on notifications for this phone first.");
  // Intent 0027, TRF-A2: "Time to leave" off forgets this phone's place.
  if (!row.kinds.includes("leave"))
    await db.delete(deviceLocations).where(eq(deviceLocations.deviceId, row.id));
  return deviceSettings(db, session);
}

export type NotificationView = {
  id: string;
  kind: NotificationKind;
  title: string;
  body: string;
  target: string;
  createdAt: string;
};

// PUSH-2: the text, for the app's extension.
export async function getNotification(db: DbOrTx, id: string): Promise<NotificationView | null> {
  const [row] = await db.select().from(notifications).where(eq(notifications.id, id));
  if (!row) return null;
  return {
    id: row.id,
    kind: row.kind as NotificationKind,
    title: row.title,
    body: row.body,
    target: row.target,
    createdAt: row.createdAt.toISOString(),
  };
}
