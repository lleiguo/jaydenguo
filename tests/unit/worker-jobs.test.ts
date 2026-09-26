import { describe, expect, it } from "vitest";
import { helpText, parseCommand } from "@/worker/jobs";

describe("parseCommand", () => {
  it("returns help when no job is given", () => {
    expect(parseCommand([])).toEqual({ kind: "help" });
    expect(parseCommand(["--help"])).toEqual({ kind: "help" });
  });

  it("parses a known job and its arguments", () => {
    expect(parseCommand(["noop", "a", "b"])).toEqual({ kind: "run", name: "noop", args: ["a", "b"] });
  });

  it("rejects unknown jobs, including inherited object keys", () => {
    expect(parseCommand(["nope"])).toMatchObject({ kind: "error" });
    expect(parseCommand(["toString"])).toMatchObject({ kind: "error" });
  });

  it("lists every job in the help text", () => {
    expect(helpText()).toContain("migrate");
    expect(helpText()).toContain("noop");
  });
});
