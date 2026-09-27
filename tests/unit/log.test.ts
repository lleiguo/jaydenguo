import { afterEach, describe, expect, it } from "vitest";
import { createLogger, forgetSecrets, redact, registerSecret } from "@/server/log";

describe("log redaction (CRED-5)", () => {
  afterEach(() => forgetSecrets());

  it("replaces fields whose names look secret", () => {
    expect(redact({ password: "x", nested: { refreshToken: "y", icalUrl: "z" }, name: "ok" })).toEqual({
      password: "[redacted]",
      nested: { refreshToken: "[redacted]", icalUrl: "[redacted]" },
      name: "ok",
    });
  });

  it("scrubs registered secret values anywhere in a line, including URL-encoded", () => {
    const lines: string[] = [];
    const log = createLogger((l) => lines.push(l));
    const feed = "https://go.teamsnap.com/ical/abc123secret.ics";
    registerSecret(feed);
    registerSecret("s3cr3t-pass");
    log(`fetching ${feed}`, {
      error: new Error("login failed for s3cr3t-pass"),
      url: encodeURIComponent(feed),
    });
    const out = lines.join("\n");
    expect(out).not.toContain("abc123secret");
    expect(out).not.toContain("s3cr3t-pass");
    expect(out).toContain("[redacted]");
  });

  it("scrubs secrets that JSON escaping would change", () => {
    const lines: string[] = [];
    registerSecret('pa"ss\\word');
    createLogger((l) => lines.push(l))("x", { detail: 'value pa"ss\\word end' });
    expect(lines[0]).not.toContain("pa");
  });
});
