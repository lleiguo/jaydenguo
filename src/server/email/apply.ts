import { and, asc, eq, gte, inArray, isNull, lt } from "drizzle-orm";
import { emailMessages, emailSuggestions, events } from "@db/schema";
import type { EmailMessage } from "../../adapters/gmail";
import { SyncError } from "../../adapters/types";
import { fromAddress } from "../../adapters/gmail";
import type { Db } from "../db/client";
import type { Logger } from "../log";
import { LlmError } from "../llm/types";
import { claudeModel } from "../llm/claude";
import { EMAIL_PROMPT_VERSION, modelExtractor, type Extractor, type UpcomingEvent } from "./extract";

// After a Gmail sync (plan M5.8): each allow-listed email is read once.
// Its suggestions are stored for the owner to approve; the email itself is
// not (§7.2). A failed extraction stops the run, and the unread emails are
// tried again next time.

const UPCOMING_DAYS = 60;

// Claude on Vertex AI; stand-ins with EMAIL_LLM=fake (local and tests);
// null when Vertex AI isn't set up.
export function defaultEmailExtractor(): Extractor | null {
  if (process.env.EMAIL_LLM === "fake") {
    if (process.env.K_SERVICE || process.env.CLOUD_RUN_JOB)
      throw new Error("EMAIL_LLM=fake is for local use only");
    return fakeExtractor;
  }
  if (!process.env.VERTEX_PROJECT) return null;
  return modelExtractor(claudeModel());
}

// One suggestion per email that names a date as YYYY-MM-DD; enough to try
// the pages without Vertex AI.
export const fakeExtractor: Extractor = async (email) => {
  const date = /\b(\d{4}-\d{2}-\d{2})\b/.exec(email.text)?.[1] ?? null;
  const time = /\b(\d{2}:\d{2})\b/.exec(email.text)?.[1] ?? null;
  const cancel = /cancel/i.test(email.text);
  if (!date) return { suggestions: [], model: "fake", costUsd: 0 };
  const quote = email.text.split("\n").find((l) => l.includes(date)) ?? email.text.slice(0, 200);
  return {
    model: "fake",
    costUsd: 0,
    suggestions: [
      {
        kind: cancel ? "cancel" : "new",
        target: cancel ? "E1" : null,
        title: email.subject || "Event from email",
        date,
        startTime: time,
        endTime: null,
        location: null,
        category: "other",
        notes: null,
        quote,
        confidence: {
          overall: "medium",
          title: "medium",
          date: "high",
          time: time ? "high" : "low",
          location: "low",
        },
      },
    ],
  };
};

async function upcomingEvents(db: Db, now: Date): Promise<(UpcomingEvent & { id: string })[]> {
  const rows = await db
    .select({ id: events.id, title: events.title, start: events.startUtc, category: events.category })
    .from(events)
    .where(
      and(
        eq(events.status, "active"),
        isNull(events.deletedAt),
        gte(events.startUtc, now),
        lt(events.startUtc, new Date(now.getTime() + UPCOMING_DAYS * 86_400_000)),
      ),
    )
    .orderBy(asc(events.startUtc))
    .limit(80);
  return rows.map((r, i) => ({
    id: r.id,
    label: `E${i + 1}`,
    title: r.title,
    start: r.start.toISOString(),
    category: r.category,
  }));
}

export async function syncEmails(
  db: Db,
  sourceId: string,
  emails: EmailMessage[],
  opts: { extractor: Extractor | null; now: Date; homeTimeZone: string; log: Logger },
): Promise<{ read: number; suggestions: number }> {
  if (!emails.length) return { read: 0, suggestions: 0 };
  const seen = await db
    .select({ id: emailMessages.gmailMessageId })
    .from(emailMessages)
    .where(
      and(
        eq(emailMessages.sourceId, sourceId),
        inArray(
          emailMessages.gmailMessageId,
          emails.map((e) => e.id),
        ),
      ),
    );
  const done = new Set(seen.map((s) => s.id));
  const fresh = emails.filter((e) => !done.has(e.id));
  if (!fresh.length) return { read: 0, suggestions: 0 };
  if (!opts.extractor)
    throw new SyncError(
      "Claude on Vertex AI isn't set up, so the emails can't be read into suggestions yet.",
    );

  const upcoming = await upcomingEvents(db, opts.now);
  const byLabel = new Map(upcoming.map((e) => [e.label, e.id]));
  let total = 0;
  for (const email of fresh) {
    let result: Awaited<ReturnType<Extractor>>;
    try {
      result = await opts.extractor(email, upcoming, opts.homeTimeZone);
    } catch (err) {
      if (err instanceof LlmError) throw new SyncError(`Couldn't read the emails: ${err.message}`);
      throw err;
    }
    await db.transaction(async (tx) => {
      const [message] = await tx
        .insert(emailMessages)
        .values({
          sourceId,
          gmailMessageId: email.id,
          receivedAt: new Date(email.receivedAt),
          fromAddress: fromAddress(email.from),
          subject: email.subject,
          suggestions: result.suggestions.length,
          model: result.model,
          promptVersion: EMAIL_PROMPT_VERSION,
        })
        .returning({ id: emailMessages.id });
      for (const s of result.suggestions) {
        const target = s.target ? (byLabel.get(s.target) ?? null) : null;
        // A change or cancellation needs an event it's about; without one it
        // is offered as a new event only if it has a date.
        const kind = s.kind !== "new" && !target ? "new" : s.kind;
        if (kind === "new" && !s.date) continue;
        await tx.insert(emailSuggestions).values({
          sourceId,
          messageId: message.id,
          gmailMessageId: email.id,
          messageUrl: email.url,
          kind,
          targetEventId: kind === "new" ? null : target,
          extracted: {
            title: s.title,
            date: s.date,
            startTime: s.startTime,
            endTime: s.endTime,
            location: s.location,
            category: s.category,
            notes: s.notes,
          },
          confidence: s.confidence,
          quote: s.quote,
        });
        total++;
      }
    });
    opts.log("email read", {
      sourceId,
      suggestions: result.suggestions.length,
      model: result.model,
      costUsd: result.costUsd,
    });
  }
  return { read: fresh.length, suggestions: total };
}
