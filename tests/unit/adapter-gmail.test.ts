import { describe, expect, it } from "vitest";
import {
  fromAddress,
  gmailQuery,
  messageText,
  normaliseGmail,
  parseGmailConfig,
  senderAllowed,
} from "@/adapters/gmail";
import type { AdapterContext } from "@/adapters/types";
import { scriptedModel } from "@/server/llm/scripted";
import { extractPrompt, extractionSchema, EXTRACT_SYSTEM, modelExtractor } from "@/server/email/extract";
import { GMAIL_LABELS, GMAIL_MESSAGES } from "../e2e/support/fake-gmail";

const ctx = (config: Record<string, unknown>): AdapterContext => ({
  source: { id: "s", name: "Coach emails", config, mapping: { default: "other", rules: [] } },
  credential: null,
  now: new Date("2027-12-14T00:00:00Z"),
  homeTimeZone: "America/Toronto",
});

const raw = {
  messages: GMAIL_MESSAGES,
  labelIds: Object.fromEntries(GMAIL_LABELS.map((l) => [l.name.toLowerCase(), l.id])),
};

describe("gmail adapter", () => {
  it("builds a search from the allow-list only", () => {
    expect(
      gmailQuery(parseGmailConfig({ senders: ["*@club.example", "coach@x.ca"], labels: ["Jayden Sports"] })),
    ).toBe("{from:@club.example from:coach@x.ca label:Jayden-Sports} newer_than:14d");
  });

  it("matches senders exactly or by domain", () => {
    expect(senderAllowed("coach@club.example", ["*@club.example"])).toBe(true);
    expect(senderAllowed("coach@evilclub.example", ["*@club.example"])).toBe(false);
    expect(senderAllowed("coach@club.example", ["coach@club.example"])).toBe(true);
    expect(fromAddress("Coach Sam <Coach@Club.example>")).toBe("coach@club.example");
  });

  it("takes in a domain's subdomains with *@*.domain", () => {
    const senders = ["*@*.veracross.example"];
    expect(senderAllowed("noreply@school.veracross.example", senders)).toBe(true);
    expect(senderAllowed("news@veracross.example", senders)).toBe(true);
    expect(senderAllowed("x@notveracross.example", senders)).toBe(false);
    expect(senderAllowed("x@veracross.example.evil", senders)).toBe(false);
    expect(gmailQuery(parseGmailConfig({ senders, labels: [] }))).toBe(
      "{from:veracross.example} newer_than:14d",
    );
  });

  it("keeps only allow-listed messages, even if the search returned more (EML-1)", () => {
    const batch = normaliseGmail(raw, ctx({ senders: ["*@club.example"], labels: ["Jayden"] }));
    expect(batch.emails!.map((e) => e.id)).toEqual(["msg-practice", "msg-labelled"]);
    expect(batch.warnings).toHaveLength(1);
    // No calendar records, and a window that cancels nothing.
    expect(batch.records).toEqual([]);
    expect(batch.window.from).toEqual(batch.window.to);
  });

  it("reads the plain text, or the HTML without tags, and drops quoted replies", () => {
    const [practice, labelled] = normaliseGmail(
      raw,
      ctx({ senders: ["*@club.example"], labels: ["Jayden"] }),
    ).emails!;
    expect(practice.text).toBe("Hi all,\n\nExtra practice on 2028-06-14 at 18:30 at the east field.\n\nSam");
    expect(practice.subject).toBe("Extra practice");
    expect(practice.url).toBe("https://mail.google.com/mail/u/0/#all/msg-practice");
    expect(labelled.text).toContain("The holiday party is on 2028-06-15.");
    expect(labelled.text).not.toContain("old");
    expect(messageText(undefined)).toBe("");
  });
});

describe("email extraction", () => {
  it("cuts text that runs past its limit instead of failing the email", () => {
    const long = "word ".repeat(200);
    const parsed = extractionSchema.parse({
      suggestions: [
        {
          kind: "new",
          target: null,
          title: long,
          date: null,
          startTime: null,
          endTime: null,
          location: long,
          category: "other",
          notes: long,
          quote: long,
          confidence: { overall: "high", title: "high", date: "high", time: "high", location: "high" },
        },
      ],
    });
    const [s] = parsed.suggestions;
    expect(s.title.length).toBeLessThanOrEqual(200);
    expect(s.location!.length).toBeLessThanOrEqual(300);
    expect(s.notes!.length).toBeLessThanOrEqual(500);
    expect(s.quote.length).toBeLessThanOrEqual(400);
    expect(s.quote.endsWith("…")).toBe(true);
    expect(extractionSchema.safeParse({ suggestions: [{ ...s, quote: "" }] }).success).toBe(false);
  });

  const email = normaliseGmail(raw, ctx({ senders: ["*@club.example"], labels: [] })).emails![0];

  it("sends the email, the time zone and labelled upcoming events", () => {
    const prompt = extractPrompt(
      email,
      [
        {
          label: "E1",
          title: "Soccer",
          start: "2027-12-20T23:00:00.000Z",
          end: "2027-12-21T00:30:00.000Z",
          allDay: false,
          category: "soccer",
          sourceKind: "gmail",
        },
        {
          label: "E2",
          title: "Tournament",
          start: "2027-12-22T00:00:00.000Z",
          end: "2027-12-23T00:00:00.000Z",
          allDay: true,
          category: "tennis",
          sourceKind: null,
        },
      ],
      "America/Toronto",
    );
    expect(prompt).toContain("Time zone: America/Toronto");
    // DUP-1: local time, with the end and where it came from.
    expect(prompt).toContain("E1: Soccer (soccer, from email), Mon 2027-12-20 18:00–19:30");
    expect(prompt).toContain("E2: Tournament (tennis, added by hand), Wed 2027-12-22, all day");
    // DUP-2
    expect(EXTRACT_SYSTEM).toMatch(/reminder.*gives no suggestion/);
    expect(EXTRACT_SYSTEM).toMatch(/"change" of it, never a "new" event/);
    expect(prompt).toContain("Extra practice on 2028-06-14");
    expect(EXTRACT_SYSTEM).toContain("word for word");
  });

  it("returns the model's structured suggestions", async () => {
    const answer = {
      suggestions: [
        {
          kind: "new",
          target: null,
          title: "Extra practice",
          date: "2028-06-14",
          startTime: "18:30",
          endTime: null,
          location: "East field",
          category: "soccer",
          notes: null,
          quote: "Extra practice on 2028-06-14 at 18:30 at the east field.",
          confidence: { overall: "high", title: "high", date: "high", time: "high", location: "medium" },
        },
      ],
    };
    expect(extractionSchema.safeParse(answer).success).toBe(true);
    const model = scriptedModel("gemini", () => answer);
    const result = await modelExtractor(model)(email, [], "America/Toronto");
    expect(result.suggestions).toHaveLength(1);
    expect(model.requests[0].purpose).toBe("email");
    expect(model.requests[0].media).toBeUndefined();
  });

  it("rejects a suggestion without a quote", () => {
    expect(
      extractionSchema.safeParse({
        suggestions: [
          {
            kind: "new",
            target: null,
            title: "x",
            date: null,
            startTime: null,
            endTime: null,
            location: null,
            category: "other",
            notes: null,
            quote: "",
            confidence: { overall: "low", title: "low", date: "low", time: "low", location: "low" },
          },
        ],
      }).success,
    ).toBe(false);
  });
});
