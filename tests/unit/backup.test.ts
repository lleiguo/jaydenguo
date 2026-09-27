import { afterEach, describe, expect, it } from "vitest";
import { exportRequest, runBackup, type Fetcher } from "@/worker/backup";

describe("backup (plan M1.13)", () => {
  afterEach(() => {
    delete process.env.BACKUP_BUCKET;
    delete process.env.INSTANCE_CONNECTION_NAME;
  });

  it("asks Cloud SQL for a compressed SQL export into the backup bucket", () => {
    const r = exportRequest(
      "proj:northamerica-northeast2:hub",
      "hub",
      "proj-backups",
      new Date("2026-10-01T09:30:00Z"),
    );
    expect(r.url).toBe("https://sqladmin.googleapis.com/v1/projects/proj/instances/hub/export");
    expect(r.body.exportContext).toMatchObject({
      fileType: "SQL",
      databases: ["hub"],
      uri: "gs://proj-backups/sql/hub-20261001T0930.sql.gz",
    });
  });

  it("waits for the export and fails the job when Cloud SQL reports an error", async () => {
    process.env.BACKUP_BUCKET = "b";
    process.env.INSTANCE_CONNECTION_NAME = "p:r:i";
    const log = () => {};
    const replies = (ops: object[]): Fetcher => {
      let i = 0;
      return async () => ({ status: 200, json: async () => ops[Math.min(i++, ops.length - 1)] });
    };
    await expect(
      runBackup(
        { log },
        {
          fetch: replies([
            { name: "op1", status: "PENDING" },
            { name: "op1", status: "DONE" },
          ]),
          pollMs: 1,
        },
      ),
    ).resolves.toMatch(/^gs:\/\/b\/sql\/hub-/);
    await expect(
      runBackup(
        { log },
        {
          fetch: replies([
            { name: "op2", status: "RUNNING" },
            { name: "op2", status: "DONE", error: { errors: [{ message: "disk full" }] } },
          ]),
          pollMs: 1,
        },
      ),
    ).rejects.toThrow("disk full");
  });
});
