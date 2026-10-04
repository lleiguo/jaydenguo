#!/usr/bin/env node
// PreToolUse guard for Claude Code (intent 0010, CCH-2..4). Reads the tool
// call as JSON on stdin; exits 2 with the reason on stderr to block it.
//
// - Edit/Write to db/migrations/**: generated SQL is never edited by hand.
// - Bash with --no-verify, or a push to main: the git hooks are not skipped.
// - Bash `gh pr merge`: only when every check on the PR has passed.
//
// GUARD_GH overrides the gh binary (tests use a fake).
import { execFileSync } from "node:child_process";
import path from "node:path";

function block(reason) {
  process.stderr.write(`${reason}\n`);
  process.exit(2);
}

function checkEdit(filePath) {
  const root = process.env.CLAUDE_PROJECT_DIR || process.cwd();
  const rel = path.relative(root, path.resolve(root, filePath)).split(path.sep).join("/");
  if (rel.startsWith("db/migrations/")) {
    block(
      "db/migrations/ is generated: edit db/schema/ and run `pnpm db:generate --name <what>` (AGENTS.md).",
    );
  }
}

// Splits a shell command into simple commands, each as a list of words.
// Good enough for the commands agents write; not a full shell parser.
function commands(line) {
  return line
    .split(/&&|\|\||[;|\n]/)
    .map((part) => (part.match(/"[^"]*"|'[^']*'|\S+/g) ?? []).map((w) => w.replace(/^["']|["']$/g, "")))
    .filter((words) => words.length > 0);
}

// The words after `<tool> <sub>` (e.g. git push, gh pr merge), skipping env
// assignments and git's own options such as `-C dir`.
function argsAfter(words, tool, sub) {
  let i = 0;
  while (i < words.length && /^[A-Z_][A-Z0-9_]*=/.test(words[i])) i++;
  if (words[i] !== tool) return null;
  i++;
  while (i < words.length && words[i].startsWith("-")) i += words[i] === "-C" || words[i] === "-c" ? 2 : 1;
  for (const s of sub) {
    if (words[i] !== s) return null;
    i++;
  }
  return words.slice(i);
}

function checkBash(line) {
  for (const words of commands(line)) {
    if (
      argsAfter(words, "git", []) &&
      words.some((w) => w === "--no-verify" || w.includes("core.hooksPath"))
    ) {
      block(
        "Don't skip or change the git hooks (--no-verify, core.hooksPath). Fix what they report (AGENTS.md).",
      );
    }
    const commit = argsAfter(words, "git", ["commit"]);
    if (commit && commit.some((w) => /^-[a-zA-Z]*n[a-zA-Z]*$/.test(w) && !w.startsWith("--"))) {
      block("`git commit -n` skips the hooks. Commit without -n (AGENTS.md).");
    }
    const push = argsAfter(words, "git", ["push"]);
    if (push && push.some((w) => /^(\+?[\w./-]*:)?\+?(refs\/heads\/)?main$/.test(w))) {
      block("Don't push to main. Open a PR and merge it when CI passes (AGENTS.md).");
    }
    const merge = argsAfter(words, "gh", ["pr", "merge"]);
    if (merge) checkMerge(merge.find((w) => !w.startsWith("-")));
  }
}

function checkMerge(pr) {
  const gh = process.env.GUARD_GH || "gh";
  let checks;
  try {
    const out = execFileSync(gh, ["pr", "checks", ...(pr ? [pr] : []), "--json", "name,bucket"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    checks = JSON.parse(out);
  } catch (err) {
    // gh exits 8 while checks are pending but still prints them.
    try {
      checks = JSON.parse(err.stdout);
    } catch {
      block(`Couldn't read the PR's checks with \`gh pr checks\`; merge only when they've all passed.`);
    }
  }
  if (!Array.isArray(checks) || checks.length === 0) {
    block("The PR has no checks yet. Wait for CI, then merge when every check has passed.");
  }
  const notGreen = checks.filter((c) => c.bucket !== "pass" && c.bucket !== "skipping");
  if (notGreen.length > 0) {
    block(
      `Not merging: ${notGreen.map((c) => `${c.name} (${c.bucket})`).join(", ")}. ` +
        "Merge only when every check has passed (AGENTS.md).",
    );
  }
}

let input = "";
for await (const chunk of process.stdin) input += chunk;
const call = JSON.parse(input || "{}");
const tool = call.tool_name;
const args = call.tool_input ?? {};

if (["Edit", "Write", "MultiEdit", "NotebookEdit"].includes(tool)) {
  checkEdit(args.file_path ?? args.notebook_path ?? "");
} else if (tool === "Bash") {
  checkBash(args.command ?? "");
}
