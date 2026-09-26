import { afterEach, describe, expect, it, vi } from "vitest";

const close = vi.fn();
vi.mock("@google-cloud/cloud-sql-connector", () => ({
  AuthTypes: { IAM: "IAM" },
  IpAddressTypes: { PUBLIC: "PUBLIC" },
  Connector: class {
    getOptions = vi.fn(async () => ({}));
    close = close;
  },
}));

const { createPool } = await import("@/server/db/client");

describe("createPool on Cloud Run", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    close.mockReset();
  });

  it("closes the Cloud SQL connector so worker jobs can exit", async () => {
    vi.stubEnv("INSTANCE_CONNECTION_NAME", "proj:region:hub");
    vi.stubEnv("DB_IAM_USER", "hub-worker@proj.iam");
    vi.stubEnv("DB_NAME", "hub");
    const handle = await createPool();
    expect(close).not.toHaveBeenCalled();
    await handle.close();
    expect(close).toHaveBeenCalledOnce();
  });

  it("requires the IAM user and database name", async () => {
    vi.stubEnv("INSTANCE_CONNECTION_NAME", "proj:region:hub");
    vi.stubEnv("DB_IAM_USER", "");
    await expect(createPool()).rejects.toThrow("DB_IAM_USER");
  });
});
