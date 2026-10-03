// Plan SP-E3 (intent 0008, EMS-1): does Gemini Flash read coach and club
// emails into suggestions well enough to replace Claude? Made-up emails,
// each with what a parent would expect from it, through the real model.
//
//   VERTEX_PROJECT=… pnpm tsx scripts/email-extract-check.ts
//
// Claude can't be asked for comparison (its quota on this project is 0), so
// the bar is these expectations: the right number and kinds of
// suggestions, the right dates and times, a word-for-word quote, nothing
// from a newsletter, and a guessed field marked "low".

import type { EmailMessage } from "../src/adapters/gmail";
import { EMAIL_MODEL } from "../src/server/email/apply";
import { modelExtractor, type ExtractedSuggestion, type UpcomingEvent } from "../src/server/email/extract";
import { geminiModel, vertexGenerate } from "../src/server/llm/gemini";

const TZ = "America/Toronto";

const upcoming: UpcomingEvent[] = [
  { label: "E1", title: "Soccer practice", start: "2027-03-09T22:00:00.000Z", category: "soccer" },
  { label: "E2", title: "Game vs Green Giants", start: "2027-03-13T15:00:00.000Z", category: "soccer" },
  { label: "E3", title: "Swim squad", start: "2027-03-10T10:30:00.000Z", category: "swimming" },
];

type Want = {
  kinds: ExtractedSuggestion["kind"][];
  // For each suggestion, in order: the date and start time it should have.
  dates?: (string | null)[];
  times?: (string | null)[];
  targets?: (string | null)[];
  // A field the email leaves open, which must not come back "high".
  unsure?: keyof ExtractedSuggestion["confidence"];
};

type Case = { name: string; email: Omit<EmailMessage, "id" | "threadId" | "url">; want: Want };

const sent = "2027-03-05T14:00:00.000Z"; // a Friday

const CASES: Case[] = [
  {
    name: "a new practice, date and time stated",
    email: {
      from: "Coach Sam <coach@club.example>",
      subject: "Extra practice",
      receivedAt: sent,
      text: "Hi all,\n\nWe've booked an extra practice on Thursday March 11 from 6:30 to 8 pm at the east field.\n\nSam",
    },
    want: { kinds: ["new"], dates: ["2027-03-11"], times: ["18:30"] },
  },
  {
    name: "a relative date, from the sent date",
    email: {
      from: "Coach Sam <coach@club.example>",
      subject: "Team photos",
      receivedAt: sent,
      text: "Team photos are next Saturday at 9am before warm-up. Full kit please.",
    },
    want: { kinds: ["new"], dates: ["2027-03-13"], times: ["09:00"] },
  },
  {
    name: "a game moved",
    email: {
      from: "League office <office@league.example>",
      subject: "Schedule change",
      receivedAt: sent,
      text: "Due to field maintenance, Saturday's game against the Green Giants (March 13) moves from 10:00 to 1:00 pm, same field.",
    },
    want: { kinds: ["change"], dates: ["2027-03-13"], times: ["13:00"], targets: ["E2"] },
  },
  {
    name: "a practice cancelled",
    email: {
      from: "Coach Sam <coach@club.example>",
      subject: "No practice Tuesday",
      receivedAt: sent,
      text: "Practice this coming Tuesday (March 9) is cancelled because of the tournament. See you Thursday.",
    },
    want: { kinds: ["cancel"], targets: ["E1"] },
  },
  {
    name: "a newsletter: nothing",
    email: {
      from: "Club news <news@club.example>",
      subject: "March newsletter",
      receivedAt: sent,
      text: "Thanks to all volunteers this season! Our shop has 20% off hoodies all month. Remember to renew your membership online.",
    },
    want: { kinds: [] },
  },
  {
    name: "two events in one email",
    email: {
      from: "Swim club <info@swim.example>",
      subject: "Upcoming meets",
      receivedAt: sent,
      text: "Two dates for your calendars: the Spring Invitational on Saturday March 20 (warm-up 7:15 am) and the club time trial on Sunday March 28 at 4 pm.",
    },
    want: { kinds: ["new", "new"], dates: ["2027-03-20", "2027-03-28"], times: ["07:15", "16:00"] },
  },
  {
    name: "Chinese, a new class",
    email: {
      from: "中文学校 <office@school.example>",
      subject: "加课通知",
      receivedAt: sent,
      text: "各位家长好：3月14日（星期日）上午10点到12点加一次课，地点不变。谢谢！",
    },
    want: { kinds: ["new"], dates: ["2027-03-14"], times: ["10:00"] },
  },
  {
    name: "no time given",
    email: {
      from: "Coach Sam <coach@club.example>",
      subject: "Fundraiser",
      receivedAt: sent,
      text: "Our car wash fundraiser is on Saturday March 27 at the community centre. Times to follow.",
    },
    want: { kinds: ["new"], dates: ["2027-03-27"], times: [null], unsure: "time" },
  },
];

function judge(c: Case, got: ExtractedSuggestion[]): string[] {
  const faults: string[] = [];
  const kinds = got.map((s) => s.kind);
  if (JSON.stringify(kinds) !== JSON.stringify(c.want.kinds))
    faults.push(`kinds ${JSON.stringify(kinds)}, wanted ${JSON.stringify(c.want.kinds)}`);
  c.want.dates?.forEach((d, i) => {
    if (got[i] && got[i].date !== d) faults.push(`date ${got[i].date}, wanted ${d}`);
  });
  c.want.times?.forEach((t, i) => {
    if (got[i] && got[i].startTime !== t) faults.push(`time ${got[i].startTime}, wanted ${t}`);
  });
  c.want.targets?.forEach((t, i) => {
    if (got[i] && got[i].target !== t) faults.push(`target ${got[i].target}, wanted ${t}`);
  });
  for (const s of got)
    if (!c.email.text.replace(/\s+/g, " ").includes(s.quote.replace(/\s+/g, " ").replace(/^"|"$/g, "")))
      faults.push("quote isn't word for word");
  if (c.want.unsure && got[0]?.confidence[c.want.unsure] === "high")
    faults.push(`${c.want.unsure} marked high though the email doesn't say`);
  return faults;
}

async function main() {
  const model = EMAIL_MODEL();
  const extract = modelExtractor(geminiModel(vertexGenerate(), model));
  let passed = 0;
  let cost = 0;
  for (const [i, c] of CASES.entries()) {
    const started = Date.now();
    const result = await extract(
      { ...c.email, id: `case-${i}`, threadId: `t-${i}`, url: "https://mail.example/x" },
      upcoming,
      TZ,
    );
    cost += result.costUsd;
    const faults = judge(c, result.suggestions);
    if (!faults.length) passed++;
    console.log(
      `${faults.length ? "FAIL" : "ok  "} ${c.name} (${Date.now() - started} ms)${faults.length ? `: ${faults.join("; ")}` : ""}`,
    );
  }
  console.log(`\n${model}: ${passed}/${CASES.length} · US$${cost.toFixed(4)}`);
  process.exitCode = passed === CASES.length ? 0 : 1;
}

void main();
