// PR gate (intent 0010, CIG-5, WSEC-2): no real names of the family,
// teammates, coaches or schools in the lines a PR adds. The names come from
// the GitHub secret PERSONAL_DATA_DENYLIST (one per line) and are never
// printed: a finding names only the file and line.
//
// Run in CI with BASE (the base commit) set. Without the secret (forks, or
// before the owner adds it) the check is skipped.
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

/**
 * @param {string} diff `git diff -U0` output
 * @param {string[]} names
 * @returns {{ file: string, line: number }[]}
 */
export function findNames(diff, names) {
  const patterns = names
    .map((n) => n.trim())
    .filter((n) => n.length >= 3)
    .map((n) => new RegExp(`(^|[^\\p{L}\\p{N}])${escape(n)}($|[^\\p{L}\\p{N}])`, "iu"));
  const found = [];
  let file = "";
  let line = 0;
  for (const text of diff.split("\n")) {
    if (text.startsWith("+++ ")) {
      file = text.replace(/^\+\+\+ (b\/)?/, "");
    } else if (text.startsWith("@@")) {
      line = Number(/\+(\d+)/.exec(text)?.[1] ?? 0);
    } else if (text.startsWith("+")) {
      if (patterns.some((p) => p.test(text.slice(1)))) found.push({ file, line });
      line++;
    }
  }
  return found;
}

function escape(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const names = (process.env.PERSONAL_DATA_DENYLIST ?? "").split("\n").filter((n) => n.trim());
  if (names.length === 0) {
    console.log("::notice title=Personal data::PERSONAL_DATA_DENYLIST isn't set; skipped.");
    process.exit(0);
  }
  const base = process.env.BASE;
  if (!base) throw new Error("BASE (the PR's base commit) is required");
  const diff = execFileSync("git", ["diff", "-U0", "--no-color", `${base}...HEAD`], {
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
  });
  const found = findNames(diff, names);
  for (const f of found) {
    console.log(
      `::error file=${f.file},line=${f.line},title=Personal data::A listed real name is in this line.`,
    );
  }
  if (found.length > 0) process.exit(1);
  console.log("No listed names in the added lines.");
}
