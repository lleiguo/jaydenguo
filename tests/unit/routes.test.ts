import { describe, expect, it } from "vitest";
import { isPublicPath, isSameOriginMutation, safeReturnTo } from "@/lib/routes";

describe("isPublicPath", () => {
  it("keeps the public list exact", () => {
    expect(isPublicPath("/login")).toBe(true);
    expect(isPublicPath("/api/healthz")).toBe(true);
    expect(isPublicPath("/_next/static/chunk.js")).toBe(true);
    expect(isPublicPath("/")).toBe(false);
    expect(isPublicPath("/login/extra")).toBe(false);
    expect(isPublicPath("/api/v1/me")).toBe(false);
    expect(isPublicPath("/api/healthz/../v1/me")).toBe(false);
  });
});

describe("safeReturnTo", () => {
  it("only allows paths on this site", () => {
    expect(safeReturnTo("/settings?x=1")).toBe("/settings?x=1");
    expect(safeReturnTo("https://evil.example")).toBe("/");
    expect(safeReturnTo("//evil.example")).toBe("/");
    expect(safeReturnTo("/\\evil.example")).toBe("/");
    expect(safeReturnTo(null)).toBe("/");
  });
});

describe("isSameOriginMutation", () => {
  const origin = "https://site.example";
  const h = (init: Record<string, string>) => new Headers(init);

  it("lets safe methods through", () => {
    expect(isSameOriginMutation("GET", h({ origin: "https://evil.example" }), origin)).toBe(true);
  });

  it("requires a matching Origin on mutations", () => {
    expect(isSameOriginMutation("POST", h({ origin }), origin)).toBe(true);
    expect(isSameOriginMutation("POST", h({ origin: "https://evil.example" }), origin)).toBe(false);
    expect(isSameOriginMutation("DELETE", h({}), origin)).toBe(false);
    expect(isSameOriginMutation("PUT", h({ "sec-fetch-site": "same-origin" }), origin)).toBe(true);
    expect(isSameOriginMutation("PUT", h({ "sec-fetch-site": "cross-site" }), origin)).toBe(false);
    expect(isSameOriginMutation("POST", h({ origin: "null", "sec-fetch-site": "same-origin" }), origin)).toBe(
      true,
    );
    expect(isSameOriginMutation("POST", h({ origin: "null", "sec-fetch-site": "cross-site" }), origin)).toBe(
      false,
    );
  });
});
