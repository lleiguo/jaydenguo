import { readFileSync } from "node:fs";
import { isPublicPath } from "../../../src/lib/routes";

// Every route in the production build, read from Next's own manifest so a
// new page or API route is covered without editing the test (plan M1.1).
export function builtRoutes(): string[] {
  const manifest = JSON.parse(readFileSync(".next/app-path-routes-manifest.json", "utf8")) as Record<
    string,
    string
  >;
  return [...new Set(Object.values(manifest))]
    .filter((route) => !["/_global-error", "/_not-found"].includes(route))
    .map((route) =>
      route
        .replace(/\[\[?\.{3}[^\]]+\]\]?/g, "x/y")
        .replace(/\[[^\]]+\]/g, "00000000-0000-4000-8000-000000000000"),
    )
    .sort();
}

export function protectedRoutes(): string[] {
  return builtRoutes().filter((route) => !isPublicPath(route));
}
