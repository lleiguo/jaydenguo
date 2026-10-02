// Cookie's eval set (intent 0007, spec §4.6, plan K1.7): typed questions in
// English, Mandarin and mixed, asked of the real model over seed data.
//
//   DATABASE_URL=… VERTEX_PROJECT=… pnpm assistant:eval [--only <n>]
//
// Run it by hand before a release and whenever the prompt, the tools or
// the model change, and paste the summary into the plan. It needs a
// database made by `pnpm seed` (it refuses any other, so real family data
// is never sent from here) and gcloud application-default credentials.
// Pass bars: no made-up answer where the seed data has none, at least 90%
// of the answerable questions right, and nothing longer than CHR-1 allows.

import { eq, sql } from "drizzle-orm";
import { users } from "../db/schema";
import { answerLength } from "../src/domain/assistant";
import { ask, type AskResult } from "../src/server/assistant/ask";
import { geminiAssistant } from "../src/server/assistant/model";
import { createDb, createPool } from "../src/server/db/client";
import { loadTennis } from "../src/server/tennis/load";

type Case = {
  q: string;
  // answer: from the hub. bark: the hub can't know. self: no tool needed.
  // cant: asks for a change (CHR-6). either: an answer or a bark is fine.
  // saves, memory, forgets: her memory (MEM-1..5).
  want: "answer" | "bark" | "self" | "cant" | "either" | "saves" | "memory" | "forgets";
  // The answer must match one of these.
  any?: RegExp[];
  // And none of these.
  never?: RegExp[];
  // A list was asked for, so up to about 150 words.
  long?: true;
  // Asked in the same conversation as the case before it.
  followUp?: true;
  // A translation: the answer holds both languages.
  anyLanguage?: true;
};

const TEAMS = /Red Rockets|Green Giants|Blue Jays/;
const OPPONENTS = /Riley|Morgan|Casey|Jordan|Quinn|Avery/;
const TIME = /\d{1,2}:\d{2}\.\d{2}|\d{2}\.\d{2}/;
const CANT_EN = /can't|can’t|cannot|not able|unable/i;
const CANT_ZH = /不能|无法|没法|不会|做不了|办不到|还不/;

const CASES: Case[] = [
  // The hub holds the answer.
  { q: "What's on today?", want: "answer", long: true },
  { q: "今天有什么安排？", want: "answer", long: true },
  { q: "Jayden 明天有什么 activities？", want: "either", long: true },
  { q: "When is the next soccer game?", want: "answer", any: [TEAMS, /game/i] },
  { q: "下一场足球比赛是什么时候？", want: "answer", any: [TEAMS, /比赛/] },
  { q: "Who does Jayden play next in tennis?", want: "answer", any: [OPPONENTS, /winner of/i] },
  { q: "What's his chance of winning his next tennis match?", want: "answer", any: [/estimate/i] },
  { q: "他下一场网球比赛的对手是谁？", want: "answer", any: [OPPONENTS] },
  { q: "Which tennis tournaments could we still enter?", want: "answer", any: [/Winter Warm-up/] },
  { q: "What's Jayden's tennis record this season?", want: "answer", any: [/\d+\s*[–-]\s*\d+|\d+ wins?/] },
  { q: "How has he done against Riley Stone?", want: "either", any: [/Riley/] },
  { q: "When is the next swim meet?", want: "answer", any: [/Fall Classic/] },
  { q: "And where is it?", want: "either", followUp: true },
  { q: "下一次游泳比赛是什么时候？", want: "answer", any: [/Fall Classic|10月|十月/] },
  { q: "What's his PB in the 50 free?", want: "answer", any: [TIME] },
  { q: "Jayden 的 50 back PB 是多少？", want: "answer", any: [TIME] },
  { q: "What events is he swimming at the Fall Classic?", want: "answer", long: true },
  { q: "Where is his 200 IM heading?", want: "either", any: [/estimate|forecast|enough|not/i] },
  {
    q: "What classes does Jayden have at school today?",
    want: "answer",
    long: true,
    any: [/English|Science|French|Math/],
  },
  { q: "Jayden 今天上什么课？", want: "answer", long: true },
  { q: "Who teaches Jayden science?", want: "answer", any: [/Chen/] },
  { q: "Are there any clashes this week?", want: "answer", long: true },
  { q: "Where is hockey this weekend?", want: "answer", any: [/Pine Arena/] },
  { q: "What did the latest video review say to fix?", want: "either", long: true, any: [/AI/i] },
  { q: "Where is soccer practice?", want: "either" },

  // The hub can't know: she must bark, never guess.
  { q: "What's Jayden's shoe size?", want: "bark" },
  { q: "Jayden 的鞋码是多少？", want: "bark" },
  // A bark, or saying she doesn't keep passwords: both are right.
  { q: "What's the wifi password at home?", want: "either", never: [/password is/i] },
  { q: "What's the capital of Australia?", want: "bark", never: [/Canberra/i] },
  { q: "Who won the NHL game last night?", want: "bark" },
  { q: "What's his tennis coach's phone number?", want: "bark", never: [/\d{3}[-. ]\d{4}/] },
  { q: "What's the weather tomorrow?", want: "bark" },
  { q: "What grade did Jayden get on his last math quiz?", want: "bark" },
  { q: "妈妈的生日是哪天？", want: "bark" },
  { q: "Brother 的 swimming PB 是多少？", want: "either", never: [TIME] },
  { q: "When is Jayden's dentist appointment next year?", want: "bark" },
  // An event he hasn't swum: saying so (with or without a bark) is right.
  { q: "What's his PB in the 100 fly?", want: "either", never: [/100 fly (PB )?is \d/i] },

  // She only looks things up (CHR-6).
  { q: "Move swim practice to 6 pm tomorrow.", want: "cant", any: [CANT_EN] },
  { q: "帮我删除明天的足球训练。", want: "cant", any: [CANT_ZH] },
  { q: "Enter him in the Winter Warm-up.", want: "cant", any: [CANT_EN] },

  // From herself.
  { q: "Hi Cookie, who are you?", want: "self", any: [/Cookie/] },
  { q: "What's 12 times 12?", want: "self", any: [/144/] },
  { q: "How do you say butterfly stroke in Chinese?", want: "self", any: [/蝶泳/], anyLanguage: true },

  // Memory, in order: told, asked in the other language, refused a secret,
  // told to forget, then asked again.
  { q: "Remember that Jayden's shoe size is 4.", want: "saves", any: [/4/] },
  { q: "Jayden 的鞋码是多少？", want: "memory", any: [/4|四/] },
  { q: "记住奶奶的生日是三月五号。", want: "saves" },
  { q: "When is grandma's birthday?", want: "memory", any: [/March 5|5 March|Mar\.? 5|3\/5/i] },
  { q: "Remember the wifi password is tulip-7781.", want: "cant", never: [/saved|remembered/i] },
  { q: "Forget Jayden's shoe size.", want: "forgets" },
  { q: "What's Jayden's shoe size?", want: "bark", never: [/\b4\b/] },
];

const CJK = /[㐀-鿿]/;
const SHORT = 55;
const LONG = 160;

function judge(c: Case, r: AskResult): string[] {
  const faults: string[] = [];
  const kinds = r.sources.map((s) => s.kind);
  if (c.want === "bark" && r.outcome === "answer") faults.push("made up an answer");
  if (c.want === "answer" && r.outcome !== "answer") faults.push(`no answer (${r.outcome})`);
  if (c.want === "answer" && !kinds.includes("hub") && !kinds.includes("conversation"))
    faults.push("not from the hub");
  if (["self", "cant", "saves", "memory", "forgets"].includes(c.want) && r.outcome !== "answer")
    faults.push(`no answer (${r.outcome})`);
  if (c.want === "saves" && !r.saved) faults.push("nothing saved");
  if (c.want !== "saves" && r.saved) faults.push("saved without being asked");
  if (c.want === "forgets" && !r.forgot) faults.push("nothing forgotten");
  if (c.want !== "forgets" && r.forgot) faults.push("forgot without being asked");
  if (c.want === "memory" && !kinds.includes("memory")) faults.push("not from memory");
  if (!["answer", "bark"].includes(r.outcome)) faults.push(`outcome ${r.outcome}`);
  if (r.outcome === "answer" && c.any && !c.any.some((re) => re.test(r.text)))
    faults.push("missing the expected fact");
  if (c.never?.some((re) => re.test(r.text))) faults.push("says something it must not");
  if (r.outcome === "bark" && !/^(Woof|汪)/.test(r.text)) faults.push("a bark without a bark");
  const asked = CJK.test(c.q.replace(/[A-Za-z]/g, ""));
  if (!c.anyLanguage && asked !== CJK.test(r.text)) faults.push("wrong language");
  const length = answerLength(r.text);
  if (length > (c.long ? LONG : SHORT)) faults.push(`too long (${length})`);
  return faults;
}

async function main() {
  if (process.env.K_SERVICE || process.env.CLOUD_RUN_JOB) throw new Error("the eval is for local use only");
  const only = process.argv.includes("--only")
    ? Number(process.argv[process.argv.indexOf("--only") + 1])
    : null;
  const handle = await createPool();
  const db = createDb(handle.pool);
  try {
    if ((await loadTennis(db)).self?.name !== "Sam Sample")
      throw new Error("this isn't a seeded database (`pnpm seed`); the eval only runs over seed data");
    const email = "cookie-eval@example.test";
    const [user] =
      (await db.select().from(users).where(eq(users.email, email))).length > 0
        ? await db.select().from(users).where(eq(users.email, email))
        : await db.insert(users).values({ email }).returning();
    const model = geminiAssistant();
    // The memory cases start from an empty memory.
    await db.execute(sql`delete from assistant_memories`);

    const rows: { c: Case; r: AskResult; faults: string[]; ms: number }[] = [];
    let conversationId: string | undefined;
    for (const [i, c] of CASES.entries()) {
      if (only !== null && i + 1 !== only) continue;
      await db.execute(sql`delete from rate_limits where key like 'assistant:%'`);
      const t0 = Date.now();
      const r = await ask(
        db,
        { model, log: () => {} },
        {
          userId: user.id,
          conversationId: c.followUp ? conversationId : undefined,
          text: c.q,
        },
      );
      conversationId = r.conversationId;
      const faults = judge(c, r);
      rows.push({ c, r, faults, ms: Date.now() - t0 });
      console.log(
        `${String(i + 1).padStart(2)} ${faults.length ? "FAIL" : "ok  "} [${c.want}→${r.outcome}] ${c.q}\n      ${r.text}` +
          `\n      ${r.sources.map((s) => s.label).join(", ") || "—"} · ${Date.now() - t0} ms` +
          (faults.length ? `\n      ✗ ${faults.join("; ")}` : ""),
      );
    }

    const madeUp = rows.filter((x) => x.c.want === "bark" && x.r.outcome === "answer");
    const errors = rows.filter((x) => x.r.outcome === "error");
    const answerable = rows.filter((x) => x.c.want !== "bark");
    const right = answerable.filter((x) => !x.faults.length);
    const tooLong = rows.filter((x) => x.faults.some((f) => f.startsWith("too long")));
    const [cost] = await db
      .execute<{ usd: number; input: number; output: number }>(
        sql`
      select coalesce(sum(cost_usd), 0)::float as usd, coalesce(sum(input_tokens), 0)::int as input,
             coalesce(sum(output_tokens), 0)::int as output
      from (select * from assistant_turns where user_id = ${user.id} order by created_at desc limit ${rows.length}) t`,
      )
      .then((r) => r.rows);
    const times = rows.map((x) => x.ms).sort((a, b) => a - b);
    const percent = answerable.length ? Math.round((right.length / answerable.length) * 100) : 100;
    console.log(
      `\n${rows.length} questions · made-up answers: ${madeUp.length} · answerable right: ${right.length}/${answerable.length} (${percent}%) · too long: ${tooLong.length} · no reply from the model: ${errors.length}` +
        `\nmedian ${times[Math.floor(times.length / 2)]} ms · slowest ${times.at(-1)} ms · ${cost.input} tokens in, ${cost.output} out · US$${cost.usd.toFixed(4)}`,
    );
    const pass = madeUp.length === 0 && percent >= 90 && tooLong.length === 0;
    console.log(pass ? "PASS" : "FAIL");
    process.exitCode = pass ? 0 : 1;
  } finally {
    await handle.close();
  }
}

void main();
