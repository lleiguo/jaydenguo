// CI check (plan M1.1): the dev-only sign-in shortcut must not exist in the
// production build. Source maps embed the original source, so only runnable
// JavaScript is scanned.
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const MARKER = "DEV_LOGIN_SHORTCUT_ENABLED";
const roots = [".next/server", ".next/standalone"];

function* files(dir) {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (name === "node_modules") continue;
    if (statSync(full).isDirectory()) yield* files(full);
    else if (/\.(c|m)?js$/.test(name)) yield full;
  }
}

const found = roots.flatMap((root) =>
  [...files(root)].filter((f) => readFileSync(f, "utf8").includes(MARKER)),
);
if (found.length) {
  console.error(`Dev sign-in shortcut found in the production build:\n${found.join("\n")}`);
  process.exit(1);
}
console.log("OK: no dev sign-in shortcut in the production build");
