import { describe, expect, it } from "vitest";
import { readQuery } from "@/server/assistant/email-read";
import { summarySchema } from "@/worker/assistant-email";

// Intent 0009: the Gmail search for an email Cookie was asked to read, and
// the shape of her summary.

describe("reading an email (ERD-2, ERD-3)", () => {
  const config = { senders: ["*@*.school.example", "coach@club.example"], labels: ["Jayden"] };

  it("searches the allow-list, narrowed by the parent's words, over the days asked", () => {
    expect(readQuery(config, "field trip", null, 7)).toBe(
      "{from:school.example from:coach@club.example label:Jayden} newer_than:7d field trip",
    );
  });

  it("adds the sender named, and keeps search syntax out of the words", () => {
    expect(readQuery(config, 'the "bake sale" (Friday) {x}', "Coach Sam", 30)).toBe(
      "{from:school.example from:coach@club.example label:Jayden} newer_than:30d from:CoachSam the bake sale Friday",
    );
  });

  it("takes a summary, the pick, and others", () => {
    expect(summarySchema.safeParse({ pick: 1, summary: "Friday, bring lunch.", others: [2] }).success).toBe(
      true,
    );
    expect(summarySchema.safeParse({ pick: null, summary: "None fits.", others: [] }).success).toBe(true);
    // A summary that runs long is cut, not refused.
    expect(summarySchema.parse({ pick: 1, summary: "x".repeat(1300), others: [] }).summary).toHaveLength(
      1200,
    );
  });
});
