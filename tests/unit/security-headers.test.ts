import { describe, expect, it } from "vitest";
import { contentSecurityPolicy, newNonce, securityHeaders } from "@/lib/security-headers";

describe("securityHeaders", () => {
  const byKey = Object.fromEntries(securityHeaders().map((h) => [h.key, h.value]));

  it("sends HSTS, noindex and anti-framing headers", () => {
    expect(byKey["Strict-Transport-Security"]).toContain("max-age=");
    expect(byKey["X-Robots-Tag"]).toContain("noindex");
    expect(byKey["X-Frame-Options"]).toBe("DENY");
  });
});

describe("contentSecurityPolicy", () => {
  it("allows scripts and styles only by nonce in production", () => {
    const csp = contentSecurityPolicy("abc123", false);
    expect(csp).toContain("script-src 'self' 'nonce-abc123' 'strict-dynamic'");
    expect(csp).toContain("style-src 'self' 'nonce-abc123'");
    expect(csp).not.toContain("unsafe-inline");
    expect(csp).not.toContain("unsafe-eval");
    expect(csp).toContain("frame-ancestors 'none'");
  });

  it("adds eval and websockets only in development", () => {
    const csp = contentSecurityPolicy("n", true);
    expect(csp).toContain("'unsafe-eval'");
    expect(csp).toContain("ws:");
    expect(csp).toContain("style-src 'self' 'unsafe-inline'");
  });

  it("uses a fresh nonce every time", () => {
    expect(newNonce()).not.toBe(newNonce());
    expect(newNonce()).toMatch(/^[A-Za-z0-9+/]{22}==$/);
  });
});
