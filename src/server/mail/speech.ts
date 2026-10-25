import { asc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { MAIL_TOPICS, mailItems, mailSpeech, mailTodos } from "@db/schema";
import { capState, type Language } from "../../domain/assistant";
import { localDate } from "../../domain/time";
import { getAssistantSettings } from "../assistant/settings";
import type { Speech, SpeechAudio } from "../assistant/speech";
import { monthSpendUsd } from "../assistant/turns";
import { hit } from "../auth/rate-limit";
import type { Db } from "../db/client";
import { HttpError } from "../errors";
import { LlmError } from "../llm/types";
import { getHomeTimeZone } from "../settings";

// Reading the day aloud (intent 0025, MA-1, MA-2): the server writes the
// script from what it stored, part by part, and speaks one part at a time.
// It never speaks words the phone sends. The app plays the parts in order
// (so skip and back are just the next and previous part) and keeps the
// day's audio, so a second play costs nothing. Anything but audio tells the
// app to read that part with the phone's own voice.

export const speechQuery = z.object({ day: z.iso.date().optional() });

export type MailSpeechPart = {
  // "intro", "others", "todos", or the mail item's ID.
  id: string;
  // The email it reads, for "now playing" and marking read.
  itemId: string | null;
  title: string;
  text: string;
  language: "en" | "zh";
};

export type MailScript = { day: string; parts: MailSpeechPart[] };

const TOPIC: Record<(typeof MAIL_TOPICS)[number], { en: string; zh: string }> = {
  school: { en: "School", zh: "学校" },
  tennis: { en: "Tennis", zh: "网球" },
  swimming: { en: "Swimming", zh: "游泳" },
  soccer: { en: "Soccer", zh: "足球" },
  activities: { en: "Activities", zh: "活动" },
  household: { en: "Household", zh: "家务" },
  other: { en: "Other", zh: "其他" },
};

const MAX_TODOS = 8;
// Per parent, per hour: a whole day twice, with room for skipping back.
const SPEECH_LIMIT = { limit: 120, windowMs: 3_600_000 };

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export async function mailScript(db: Db, now = new Date(), day?: string): Promise<MailScript> {
  const tz = await getHomeTimeZone(db);
  const date = day ?? localDate(now, tz);
  const [items, todos] = await Promise.all([
    db.select().from(mailItems).where(eq(mailItems.day, date)).orderBy(asc(mailItems.receivedAt)),
    db
      .select({ text: mailTodos.text })
      .from(mailTodos)
      .where(isNull(mailTodos.doneAt))
      .orderBy(asc(mailTodos.dueOn), asc(mailTodos.createdAt))
      .limit(MAX_TODOS),
  ]);
  const read = items.filter((i) => i.summary && !i.routine);
  const rest = items.length - read.length;
  const topicOrder = (t: string) => MAIL_TOPICS.indexOf(t as (typeof MAIL_TOPICS)[number]);
  read.sort((a, b) => topicOrder(a.topic) - topicOrder(b.topic));
  const chinese = read.length > 0 && read.every((i) => i.language === "zh");
  const parts: MailSpeechPart[] = [];
  parts.push({
    id: "intro",
    itemId: null,
    title: "Today's mail",
    language: chinese ? "zh" : "en",
    text: chinese
      ? `今天有${read.length}封邮件，${todos.length}件待办。`
      : read.length
        ? `You have ${plural(read.length, "email")} and ${todos.length} to do.`
        : "No new email to read today.",
  });
  for (const i of read) {
    const zh = i.language === "zh";
    const topic = TOPIC[i.topic as keyof typeof TOPIC] ?? TOPIC.other;
    parts.push({
      id: i.id,
      itemId: i.id,
      title: i.subject,
      language: zh ? "zh" : "en",
      text: zh
        ? `${topic.zh}。来自${i.senderName}：${i.summary}`
        : `${topic.en}. From ${i.senderName}: ${i.summary}`,
    });
  }
  if (rest)
    parts.push({
      id: "others",
      itemId: null,
      title: "Also came in",
      language: chinese ? "zh" : "en",
      text: chinese ? `还有${rest}封其他邮件。` : `And ${plural(rest, "other email")}.`,
    });
  if (todos.length)
    parts.push({
      id: "todos",
      itemId: null,
      title: "To do",
      language: "en",
      text: `To do: ${todos.map((t) => t.text.replace(/[.;]+$/, "")).join("; ")}.`,
    });
  return { day: date, parts };
}

export async function speakMailPart(
  db: Db,
  deps: { speech: Speech; now?: Date },
  input: { userId: string; part: string; day?: string },
): Promise<SpeechAudio> {
  const now = deps.now ?? new Date();
  const script = await mailScript(db, now, input.day);
  const part = script.parts.find((p) => p.id === input.part);
  if (!part) throw new HttpError(404, "not found");
  const settings = await getAssistantSettings(db);
  if (!settings.speak) throw new HttpError(409, "spoken answers are switched off");
  if (capState(await monthSpendUsd(db, now), settings.monthlyCapUsd) !== "ok")
    throw new HttpError(409, "Cookie is near this month's limit, so the phone reads the mail");
  if (!(await hit(db, `mail:speech:${input.userId}`, SPEECH_LIMIT.limit, SPEECH_LIMIT.windowMs)))
    throw new HttpError(429, "too much read aloud; try again in a few minutes");
  let audio;
  try {
    audio = await deps.speech({ text: part.text, language: part.language as Language });
  } catch (err) {
    if (!(err instanceof LlmError)) throw err;
    throw new HttpError(503, "Cookie's voice isn't answering");
  }
  // MSEC-5: counted toward the cap; numbers only.
  await db.insert(mailSpeech).values({
    day: script.day,
    createdAt: now,
    part: part.itemId ? "item" : part.id,
    chars: audio.chars,
    costUsd: audio.costUsd,
  });
  return audio;
}
