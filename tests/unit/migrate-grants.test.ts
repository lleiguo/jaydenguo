import { describe, expect, it } from "vitest";
import { webGrantStatements } from "@/server/db/migrate";

describe("webGrantStatements", () => {
  it("quotes the IAM user name, which contains @ and dots", () => {
    const statements = webGrantStatements("hub-web@proj.iam");
    expect(statements.every((s) => s.includes('"hub-web@proj.iam"'))).toBe(true);
  });

  it("escapes embedded quotes", () => {
    expect(webGrantStatements('a"b')[0]).toContain('"a""b"');
  });

  it("never grants DDL", () => {
    expect(webGrantStatements("w").join(" ")).not.toMatch(/\b(CREATE|ALL PRIVILEGES|TRUNCATE)\b/);
  });
});
