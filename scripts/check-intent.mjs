// PR gate (intent 0010, CIG-1..3, CIG-6): the PR description names the
// intent it builds, and that intent is approved.
//
//   Intent: 0010            one or more, comma-separated
//   Intent: none — <reason> a fix or chore; not for schema, migrations, infra
//
// Run in CI with PR_BODY and BASE (the base commit) set; prints GitHub
// annotations and exits 1 on an error. Warnings don't fail.
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const NEEDS_INTENT = /^(db\/schema|db\/migrations|infra)\//;
const DOCS = ["intent", "spec", "plan"];

/**
 * @param {{ body: string, files: string[], root: string }} pr
 * @returns {{ errors: string[], warnings: string[] }}
 */
export function checkIntent({ body, files, root }) {
  const errors = [];
  const warnings = [];
  const lines = [...(body ?? "").matchAll(/^\s*Intent:\s*(.*)$/gim)].map((m) => m[1].trim());

  if (lines.length === 0) {
    errors.push(
      "The PR description has no `Intent:` line. Add `Intent: NNNN` or `Intent: none — <reason>` (AGENTS.md).",
    );
    return { errors, warnings };
  }
  const value = lines[0];

  if (/^none\b/i.test(value)) {
    const reason = value.replace(/^none\s*[—–:-]*\s*/i, "");
    if (reason.length < 3) errors.push("`Intent: none` needs a reason: `Intent: none — <reason>`.");
    const blocked = files.filter((f) => NEEDS_INTENT.test(f));
    if (blocked.length > 0) {
      errors.push(
        `\`Intent: none\` can't cover changes to the schema, migrations or infra: ${blocked.join(", ")}.`,
      );
    }
    return { errors, warnings };
  }

  if (!/^\d{4}(\s*,\s*\d{4})*$/.test(value)) {
    errors.push(
      `\`Intent: ${value}\` isn't a list of intent numbers (e.g. \`Intent: 0010\`) or \`none — <reason>\`.`,
    );
    return { errors, warnings };
  }

  const docsOnly = files.length > 0 && files.every((f) => f.startsWith("intent/"));
  const readme = readOr(path.join(root, "intent/README.md"));

  for (const n of value.split(",").map((s) => s.trim())) {
    const folder = intentFolder(root, n);
    if (!folder) {
      errors.push(`Intent ${n}: no folder intent/${n}-*.`);
      continue;
    }
    // The docs PR itself is how an intent gets approved.
    if (docsOnly) continue;

    for (const doc of DOCS) {
      const status = statusOf(root, folder, doc, readme, n);
      if (!/^approved\b/i.test(status)) {
        errors.push(
          `Intent ${n}: ${doc}.md isn't approved (Status: ${status || "none"}). Code waits for approval.`,
        );
      }
    }
    const touchesCode = files.some((f) => f.startsWith("src/") || f.startsWith("ios/"));
    if (touchesCode && !files.includes(`intent/${folder}/plan.md`)) {
      warnings.push(
        `Intent ${n}: code changed but intent/${folder}/plan.md didn't. Update its Status if the build moved on.`,
      );
    }
  }
  return { errors, warnings };
}

function intentFolder(root, n) {
  const dir = path.join(root, "intent");
  if (!existsSync(dir)) return null;
  return readdirSync(dir).find((d) => d.startsWith(`${n}-`)) ?? null;
}

function readOr(file) {
  return existsSync(file) ? readFileSync(file, "utf8") : "";
}

// A doc's own `Status:` line; intents from before 0010 keep theirs only in
// the README table (columns Intent | Spec | Plan).
function statusOf(root, folder, doc, readme, n) {
  const own = readOr(path.join(root, "intent", folder, `${doc}.md`)).match(/^Status:\s*(.*)$/m);
  if (own) return own[1].trim();
  const row = readme.split("\n").find((l) => l.startsWith(`| ${n} |`));
  if (!row) return "";
  const cells = row.split("|").map((c) => c.trim());
  return cells[3 + DOCS.indexOf(doc)] ?? "";
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const base = process.env.BASE;
  if (!base) throw new Error("BASE (the PR's base commit) is required");
  const files = execFileSync("git", ["diff", "--name-only", `${base}...HEAD`], { encoding: "utf8" })
    .split("\n")
    .filter(Boolean);
  const { errors, warnings } = checkIntent({ body: process.env.PR_BODY ?? "", files, root: process.cwd() });
  for (const w of warnings) console.log(`::warning title=Intent::${w}`);
  for (const e of errors) console.log(`::error title=Intent::${e}`);
  if (errors.length > 0) process.exit(1);
  console.log("Intent check passed.");
}
