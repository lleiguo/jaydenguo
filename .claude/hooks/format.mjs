#!/usr/bin/env node
// PostToolUse for Claude Code (intent 0010, CCH-1): formats the file Edit
// or Write just changed with Prettier, if Prettier handles it and it isn't
// ignored. Never blocks: a file Prettier can't parse is left for
// `pnpm verify` to report.
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

let input = "";
for await (const chunk of process.stdin) input += chunk;
const call = JSON.parse(input || "{}");
const file = call.tool_input?.file_path;
const root = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const prettier = path.join(root, "node_modules", ".bin", "prettier");

if (file && existsSync(file) && existsSync(prettier) && !path.relative(root, file).startsWith("..")) {
  try {
    execFileSync(prettier, ["--write", "--ignore-unknown", "--log-level", "silent", file], {
      cwd: root,
      stdio: "ignore",
      timeout: 10_000,
    });
  } catch {
    // Left for `pnpm verify`.
  }
}
