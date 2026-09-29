import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildDocument } from "../../scripts/openapi";
import { operations } from "@/server/openapi/registry";

// intent 0004, API-4: openapi.json lists every /api/v1 operation.

const apiDir = path.resolve(__dirname, "../../src/app/api/v1");

function routeFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return routeFiles(full);
    return name === "route.ts" ? [full] : [];
  });
}

// "src/app/api/v1/events/[id]/route.ts" exporting GET → "GET /api/v1/events/{id}"
function implemented(): string[] {
  return routeFiles(apiDir).flatMap((file) => {
    const route = path
      .relative(apiDir, path.dirname(file))
      .split(path.sep)
      .map((p) => p.replace(/^\[(\w+)\]$/, "{$1}"))
      .join("/");
    const methods = [...readFileSync(file, "utf8").matchAll(/export const (GET|POST|PATCH|PUT|DELETE)\b/g)];
    return methods.map((m) => `${m[1]} /api/v1${route ? `/${route}` : ""}`);
  });
}

describe("the OpenAPI registry", () => {
  it("has exactly the implemented routes", () => {
    const registered = operations.map((o) => `${o.method} ${o.path}`);
    expect([...registered].sort()).toEqual(implemented().sort());
  });

  it("has unique operation ids", () => {
    const ids = operations.map((o) => o.operationId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("builds a document whose response types all exist", { timeout: 30_000 }, () => {
    const doc = buildDocument() as {
      paths: Record<string, unknown>;
      components: { schemas: Record<string, unknown> };
    };
    expect(Object.keys(doc.paths).length).toBeGreaterThan(50);
    const refs = [...JSON.stringify(doc).matchAll(/"#\/components\/schemas\/([^"]+)"/g)].map((m) => m[1]);
    for (const ref of new Set(refs)) expect(doc.components.schemas, ref).toHaveProperty(ref);
  });
});
