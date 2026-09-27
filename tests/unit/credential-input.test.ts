import { describe, expect, it } from "vitest";
import { createCredentialInput } from "@/server/credentials/store";
import { normaliseFeedUrl } from "@/adapters/http";

const link = (secret: string) =>
  createCredentialInput.safeParse({ kind: "secret_url", provider: "teamsnap", label: "Soccer", secret });

describe("calendar link input", () => {
  it("accepts the forms sites hand out", () => {
    for (const s of [
      "webcal://ical.example.test/team/123.ics",
      "webcals://ical.example.test/team/123.ics",
      "https://ical.example.test/team/123.ics",
      "http://ical.example.test/team/123.ics",
      "WEBCAL://ical.example.test/x",
    ]) {
      expect(link(s).success, s).toBe(true);
    }
  });

  it("removes whitespace that copy and paste adds", () => {
    const r = link("  webcal://ical.example.test/team/\n123.ics \n");
    expect(r.success && r.data.secret).toBe("webcal://ical.example.test/team/123.ics");
  });

  it("explains what's wrong", () => {
    const r = link("go.example.test/team/123");
    expect(r.success).toBe(false);
    expect(r.error?.issues[0].message).toMatch(/should start with webcal:\/\/ or https:\/\//);
    expect(link("javascript:alert(1)").success).toBe(false);
  });

  it("fetches webcal links over https", () => {
    expect(normaliseFeedUrl("webcals://a.example.test/x.ics").href).toBe("https://a.example.test/x.ics");
    expect(normaliseFeedUrl("webcal://a.example.test/x.ics").href).toBe("https://a.example.test/x.ics");
  });
});
