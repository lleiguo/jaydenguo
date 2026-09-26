import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

// A Cloud Run job only completes when its process exits; a lingering handle
// once kept `migrate` running until the job timed out.
describe("worker process", () => {
  it("exits promptly after the migrate job", () => {
    const started = Date.now();
    const result = spawnSync("pnpm", ["exec", "tsx", "src/worker/main.ts", "migrate"], {
      env: process.env,
      encoding: "utf8",
      timeout: 30_000,
    });
    expect(result.signal).toBeNull(); // not killed by the timeout
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("job finished");
    expect(Date.now() - started).toBeLessThan(30_000);
  });

  it("exits with code 2 for an unknown job", () => {
    const result = spawnSync("pnpm", ["exec", "tsx", "src/worker/main.ts", "nope"], {
      env: process.env,
      encoding: "utf8",
      timeout: 30_000,
    });
    expect(result.status).toBe(2);
  });
});
