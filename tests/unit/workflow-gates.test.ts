// The workflow's PR gates (intent 0010, CIG-1..3, CIG-5, CIG-6).
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { checkIntent } from "../../scripts/check-intent.mjs";
import { findNames } from "../../scripts/check-personal-data.mjs";

// A scratch repo with intent folders: 0011 approved, 0012 draft, 0003 from
// before 0010 (status only in the README table).
function repo() {
  const root = mkdtempSync(path.join(tmpdir(), "intent-gate-"));
  const write = (rel: string, text: string) => {
    mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    writeFileSync(path.join(root, rel), text);
  };
  for (const doc of ["intent", "spec", "plan"]) {
    write(`intent/0011-approved/${doc}.md`, `# X\nStatus: approved (owner, 2026-10-03, in chat).\n`);
    write(
      `intent/0012-draft/${doc}.md`,
      `# X\nStatus: ${doc === "intent" ? "approved (owner)" : "draft (2026-10-03)"}.\n`,
    );
    write(`intent/0003-old/${doc}.md`, `# X\n`);
  }
  write(
    "intent/README.md",
    [
      "| # | Change | Intent | Spec | Plan |",
      "|---|---|---|---|---|",
      "| 0003 | [Old](0003-old/) | approved 2026-09-28 | approved 2026-09-28 | approved; done |",
    ].join("\n"),
  );
  return root;
}

const code = ["src/server/x.ts"];

describe("intent gate", () => {
  const root = repo();
  const check = (body: string, files = code) => checkIntent({ body, files, root });

  it("needs an Intent line (CIG-1)", () => {
    expect(check("Fixes the form.").errors[0]).toContain("no `Intent:` line");
    expect(check("Intent: soon").errors[0]).toContain("isn't a list of intent numbers");
    expect(check("Intent: 0099").errors[0]).toContain("no folder");
  });

  it("passes an approved intent, and warns when the plan didn't change (CIG-2, CIG-6)", () => {
    const r = check("Builds W1.\n\nIntent: 0011\n");
    expect(r.errors).toEqual([]);
    expect(r.warnings[0]).toContain("plan.md didn't");
    expect(check("intent: 0011", [...code, "intent/0011-approved/plan.md"])).toEqual({
      errors: [],
      warnings: [],
    });
  });

  it("refuses code for a draft spec or plan (CIG-2)", () => {
    const r = check("Intent: 0012");
    expect(r.errors).toHaveLength(2);
    expect(r.errors[0]).toContain("spec.md isn't approved");
    expect(check("Intent: 0011, 0012").errors).toHaveLength(2);
  });

  it("lets the docs PR through while it's a draft (CIG-2)", () => {
    expect(check("Intent: 0012", ["intent/0012-draft/spec.md", "intent/README.md"]).errors).toEqual([]);
  });

  it("reads older intents' status from the README table", () => {
    expect(check("Intent: 0003", [...code, "intent/0003-old/plan.md"]).errors).toEqual([]);
  });

  it("allows none with a reason, but not for schema, migrations or infra (CIG-3)", () => {
    expect(check("Intent: none — build number").errors).toEqual([]);
    expect(check("Intent: none - fix a typo").errors).toEqual([]);
    expect(check("Intent: none").errors[0]).toContain("needs a reason");
    const r = check("Intent: none — tidy", ["db/schema/events.ts", "infra/main.tf", "src/x.ts"]);
    expect(r.errors[0]).toContain("db/schema/events.ts, infra/main.tf");
  });
});

describe("personal data gate (CIG-5)", () => {
  const diff = [
    "diff --git a/tests/fixtures/a.json b/tests/fixtures/a.json",
    "--- a/tests/fixtures/a.json",
    "+++ b/tests/fixtures/a.json",
    "@@ -3,0 +4,3 @@",
    '+  "player": "Alex Rivera",',
    '+  "club": "Northside",',
    '+  "coach": "Sam O\'Neil"',
    "diff --git a/src/x.ts b/src/x.ts",
    "--- a/src/x.ts",
    "+++ b/src/x.ts",
    "@@ -10 +10 @@",
    "-const rivera = 1;",
    "+const riverside = 1;",
  ].join("\n");

  it("names the file and line of each added line with a listed name", () => {
    expect(findNames(diff, ["rivera", "Sam O'Neil"])).toEqual([
      { file: "tests/fixtures/a.json", line: 4 },
      { file: "tests/fixtures/a.json", line: 6 },
    ]);
  });

  it("matches whole words only, and ignores removed lines and short names", () => {
    expect(findNames(diff, ["river", "al", ""])).toEqual([]);
  });
});
