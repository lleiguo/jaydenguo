import { describe, expect, it } from "vitest";
import { isAppTooOld } from "@/lib/app-version";
import { isPublicPath, isTokenEndpoint } from "@/lib/routes";
import { handoffInput } from "@/server/auth/device";
import {
  bearerToken,
  cleanDeviceName,
  isWellFormedChallenge,
  isWellFormedVerifier,
  pkceChallenge,
  verifierMatches,
} from "@/server/auth/tokens";

// intent 0004, API-1, API-2, API-5, API-6.

const token = "A".repeat(43);

describe("bearerToken", () => {
  it("takes a well-formed token only", () => {
    expect(bearerToken(`Bearer ${token}`)).toBe(token);
    expect(bearerToken(`bearer ${token}`)).toBeUndefined();
    expect(bearerToken(`Bearer ${token}x`)).toBeUndefined();
    expect(bearerToken("Basic dXNlcjpwYXNz")).toBeUndefined();
    expect(bearerToken(null)).toBeUndefined();
  });
});

describe("PKCE (S256)", () => {
  // RFC 7636 appendix B.
  const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
  const challenge = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM";

  it("matches the RFC's example", () => {
    expect(pkceChallenge(verifier)).toBe(challenge);
    expect(verifierMatches(verifier, challenge)).toBe(true);
  });

  it("refuses a wrong or malformed verifier", () => {
    expect(verifierMatches(verifier.replace("d", "e"), challenge)).toBe(false);
    expect(verifierMatches("short", challenge)).toBe(false);
    expect(isWellFormedVerifier("a".repeat(129))).toBe(false);
    expect(isWellFormedChallenge(`${challenge}=`)).toBe(false);
  });
});

describe("cleanDeviceName", () => {
  it("strips control characters and limits the length", () => {
    expect(cleanDeviceName("Lei’s iPhone\u0000‮")).toBe("Lei’s iPhone");
    expect(cleanDeviceName("x".repeat(100))).toHaveLength(60);
    expect(cleanDeviceName("  ")).toBeNull();
    expect(cleanDeviceName(null)).toBeNull();
  });
});

describe("isAppTooOld", () => {
  it("compares versions part by part", () => {
    expect(isAppTooOld("1.2.0", "1.10.0")).toBe(true);
    expect(isAppTooOld("1.10", "1.10.0")).toBe(false);
    expect(isAppTooOld("2", "1.9.9")).toBe(false);
  });

  it("never blocks the website or an unset minimum", () => {
    expect(isAppTooOld(null, "1.0.0")).toBe(false);
    expect(isAppTooOld("0.1", undefined)).toBe(false);
  });

  it("treats an unreadable version as too old", () => {
    expect(isAppTooOld("banana", "1.0")).toBe(true);
  });
});

describe("public paths for the app", () => {
  it("lets the code exchange and handoff through, nothing more", () => {
    expect(isPublicPath("/api/v1/auth/device")).toBe(true);
    expect(isPublicPath("/auth/handoff")).toBe(true);
    expect(isPublicPath("/auth/app-done")).toBe(true);
    expect(isPublicPath("/api/v1/auth/handoff")).toBe(false);
    expect(isPublicPath("/api/v1/auth/signout")).toBe(false);
    expect(isTokenEndpoint("/api/v1/auth/device")).toBe(true);
    expect(isTokenEndpoint("/api/v1/auth/handoff")).toBe(false);
  });
});

describe("handoffInput", () => {
  it("opens Google connect only, on this site", () => {
    expect(
      handoffInput.safeParse({ next: "/accounts/google/connect?feature=drive&next=/auth/app-done" }).success,
    ).toBe(true);
    expect(handoffInput.safeParse({ next: "/settings" }).success).toBe(false);
    expect(handoffInput.safeParse({ next: "https://evil.example/accounts/google/connect" }).success).toBe(
      false,
    );
    expect(handoffInput.safeParse({ next: "//evil.example/accounts/google/connect" }).success).toBe(false);
  });
});
