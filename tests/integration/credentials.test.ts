import { spawnSync } from "node:child_process";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { credentials } from "@db/schema";
import { createCredential } from "@/server/credentials/store";
import { LocalKeyWrapper } from "@/server/crypto/key-wrapper";
import { createDb, createPool, type PoolHandle } from "@/server/db/client";
import { runMigrations } from "@/server/db/migrate";
import { openCredential, rotateKeysJob } from "@/worker/credentials";
import { log } from "@/server/log";

describe("credentials", () => {
  let handle: PoolHandle;
  let db: ReturnType<typeof createDb>;

  beforeAll(async () => {
    await runMigrations();
    handle = await createPool();
    db = createDb(handle.pool);
  });
  afterAll(() => handle.close());

  it("a worker job's log never contains the secret it used (CRED-5)", async () => {
    const marker = `secret-${Date.now()}`;
    // Port 9 refuses connections, so the job goes through its error path.
    const cred = await createCredential(db, "test", {
      kind: "secret_url",
      provider: "ical",
      label: "leak check",
      secret: `http://127.0.0.1:9/feeds/${marker}.ics`,
    });
    const run = spawnSync("pnpm", ["exec", "tsx", "src/worker/main.ts", "credential:test", cred.id], {
      env: process.env,
      encoding: "utf8",
      timeout: 60_000,
    });
    expect(run.status).toBe(0);
    expect(run.stdout + run.stderr).toContain("credential tested");
    expect(run.stdout + run.stderr).not.toContain(marker);
    const [row] = await db.select().from(credentials).where(eq(credentials.id, cred.id));
    expect(row.lastTestOk).toBe(false);
    expect(row.lastError).not.toContain(marker);
  });

  it("key rotation re-wraps every data key and secrets still open (plan M1.2)", async () => {
    const v1 = new LocalKeyWrapper({ "local-v1": "dev-only-local-key-encryption-key" }, "local-v1");
    const a = await createCredential(
      db,
      "test",
      { kind: "secret_url", provider: "ical", label: "rot a", secret: "https://a.example/x.ics" },
      v1,
    );
    const b = await createCredential(
      db,
      "test",
      { kind: "password", provider: "spordle", label: "rot b", username: "u", secret: "pw-b-123" },
      v1,
    );

    const v2 = new LocalKeyWrapper(
      { "local-v1": "dev-only-local-key-encryption-key", "local-v2": "second key" },
      "local-v2",
    );
    await rotateKeysJob([], { log, db: async () => db }, v2);

    const rows = await db.select().from(credentials);
    expect(rows.every((r) => r.keyVersion === "local-v2")).toBe(true);
    const onlyV2 = new LocalKeyWrapper({ "local-v2": "second key" }, "local-v2");
    expect((await openCredential(db, a.id, "test", onlyV2)).secret).toBe("https://a.example/x.ics");
    expect((await openCredential(db, b.id, "test", onlyV2)).secret).toBe("pw-b-123");

    // Put everything back on the default local key for other tests.
    await rotateKeysJob(
      [],
      { log, db: async () => db },
      new LocalKeyWrapper(
        { "local-v1": "dev-only-local-key-encryption-key", "local-v2": "second key" },
        "local-v1",
      ),
    );
  });
});
