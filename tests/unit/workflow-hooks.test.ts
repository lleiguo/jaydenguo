// The workflow's hooks (intent 0010): Claude Code's guard (CCH-2..4) and the
// git hooks (GH-3, GH-4), run as the tools run them.
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

const repo = path.resolve(__dirname, "../..");

// Git sets GIT_DIR and friends when it runs a hook (these tests run in
// pre-push); drop them so the scratch repo below is its own.
const cleanEnv = { ...process.env };
for (const k of Object.keys(cleanEnv)) if (k.startsWith("GIT_")) delete cleanEnv[k];
const guard = path.join(repo, ".claude/hooks/guard.mjs");

function runGuard(call: object, env: Record<string, string> = {}) {
  const r = spawnSync("node", [guard], {
    input: JSON.stringify(call),
    encoding: "utf8",
    env: { ...cleanEnv, CLAUDE_PROJECT_DIR: repo, ...env },
  });
  return { blocked: r.status === 2, status: r.status, stderr: r.stderr };
}

const bash = (command: string, env?: Record<string, string>) =>
  runGuard({ tool_name: "Bash", tool_input: { command } }, env);

// A fake `gh` that prints the given checks as `gh pr checks --json` would.
function fakeGh(checks: object[], exitCode = 0) {
  const dir = mkdtempSync(path.join(tmpdir(), "fake-gh-"));
  const file = path.join(dir, "gh");
  writeFileSync(file, `#!/bin/sh\necho '${JSON.stringify(checks)}'\nexit ${exitCode}\n`);
  chmodSync(file, 0o755);
  return { GUARD_GH: file };
}

describe("Claude Code guard", () => {
  it("blocks edits to generated migrations (CCH-2)", () => {
    expect(
      runGuard({ tool_name: "Edit", tool_input: { file_path: `${repo}/db/migrations/0001_x.sql` } }).blocked,
    ).toBe(true);
    expect(
      runGuard({ tool_name: "Write", tool_input: { file_path: "db/migrations/meta/_journal.json" } }).blocked,
    ).toBe(true);
    expect(
      runGuard({ tool_name: "Edit", tool_input: { file_path: `${repo}/db/schema/events.ts` } }).blocked,
    ).toBe(false);
  });

  it("blocks skipping the git hooks (CCH-3)", () => {
    expect(bash("git commit --no-verify -m 'x'").blocked).toBe(true);
    expect(bash("git add . && git commit -nm 'x'").blocked).toBe(true);
    expect(bash("git push --no-verify -u origin feature").blocked).toBe(true);
    expect(bash("git -c core.hooksPath=/dev/null push").blocked).toBe(true);
    expect(bash("git config --unset core.hooksPath").blocked).toBe(true);
    // Words in a message aren't flags.
    expect(bash("git commit -m 'explain why we never use --no-verify'").blocked).toBe(false);
    expect(bash("git commit -m 'x'").blocked).toBe(false);
  });

  it("blocks pushing to main (CCH-3)", () => {
    expect(bash("git push origin main").blocked).toBe(true);
    expect(bash("git push origin HEAD:main").blocked).toBe(true);
    expect(bash("git push origin HEAD:refs/heads/main").blocked).toBe(true);
    expect(bash("cd /x && git -C /y push -f origin main").blocked).toBe(true);
    expect(bash("git push -u origin feature/main-menu").blocked).toBe(false);
    expect(bash("git push -u origin docs/0010-workflow").blocked).toBe(false);
    expect(bash("git checkout main && git pull").blocked).toBe(false);
  });

  it("merges only when every check passed (CCH-4)", () => {
    const green = fakeGh([
      { name: "check", bucket: "pass" },
      { name: "ios", bucket: "skipping" },
    ]);
    expect(bash("gh pr merge 92 --merge", green).blocked).toBe(false);

    const pending = fakeGh([{ name: "check", bucket: "pending" }], 8);
    const r = bash("gh pr merge 92 --merge", pending);
    expect(r.blocked).toBe(true);
    expect(r.stderr).toContain("check (pending)");

    expect(bash("gh pr merge 92", fakeGh([{ name: "check", bucket: "fail" }], 1)).blocked).toBe(true);
    expect(bash("gh pr merge", fakeGh([])).blocked).toBe(true);
  });

  it("lets other commands and tools through", () => {
    expect(bash("pnpm verify").blocked).toBe(false);
    expect(
      runGuard({ tool_name: "Read", tool_input: { file_path: "db/migrations/0001_x.sql" } }).blocked,
    ).toBe(false);
  });
});

describe("git hooks", () => {
  it("pre-push refuses main (GH-3)", () => {
    const zero = "0".repeat(40);
    const r = spawnSync(path.join(repo, ".githooks/pre-push"), ["origin", "url"], {
      env: cleanEnv,
      input: `refs/heads/x ${"a".repeat(40)} refs/heads/main ${zero}\n`,
      encoding: "utf8",
    });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("refusing to push to main");
  });

  it("pre-push lets a branch deletion through without checks", () => {
    const zero = "0".repeat(40);
    const r = spawnSync(path.join(repo, ".githooks/pre-push"), ["origin", "url"], {
      env: cleanEnv,
      input: `(delete) ${zero} refs/heads/old ${"b".repeat(40)}\n`,
      encoding: "utf8",
    });
    expect(r.status).toBe(0);
  });

  it("commit-msg refuses hand-edited migrations (GH-4)", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "hooks-repo-"));
    const git = (...args: string[]) => spawnSync("git", args, { cwd: dir, encoding: "utf8", env: cleanEnv });
    git("init", "-q");
    mkdirSync(path.join(dir, "db/migrations"), { recursive: true });
    mkdirSync(path.join(dir, "db/schema"), { recursive: true });
    writeFileSync(path.join(dir, "db/migrations/0001_x.sql"), "select 1;\n");
    git("add", ".");

    const hook = path.join(repo, ".githooks/commit-msg");
    const msg = path.join(dir, "MSG");
    const run = (text: string) => {
      writeFileSync(msg, text);
      return spawnSync(hook, [msg], { cwd: dir, encoding: "utf8", env: cleanEnv }).status;
    };

    expect(run("Fix the migration")).toBe(1);
    expect(run("Add events table (pnpm db:generate --name events)")).toBe(0);

    writeFileSync(path.join(dir, "db/schema/events.ts"), "export {};\n");
    git("add", ".");
    expect(run("Add events table")).toBe(0);
  });
});
