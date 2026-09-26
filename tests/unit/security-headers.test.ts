import { describe, expect, it } from "vitest";
import { securityHeaders } from "@/lib/security-headers";

const get = (dev: boolean, key: string) => securityHeaders(dev).find((h) => h.key === key)?.value;

describe("securityHeaders", () => {
  it("forbids indexing and framing", () => {
    expect(get(false, "X-Robots-Tag")).toContain("noindex");
    expect(get(false, "X-Frame-Options")).toBe("DENY");
    expect(get(false, "Content-Security-Policy")).toContain("frame-ancestors 'none'");
  });

  it("only allows eval in development", () => {
    expect(get(false, "Content-Security-Policy")).not.toContain("unsafe-eval");
    expect(get(true, "Content-Security-Policy")).toContain("unsafe-eval");
  });

  it("sends HSTS", () => {
    expect(get(false, "Strict-Transport-Security")).toMatch(/max-age=\d+/);
  });
});
