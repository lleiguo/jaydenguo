import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { emailSuggestions } from "@db/schema";
import {
  asksToApply,
  CHANGE_LIMITS,
  leftBecause,
  unsureFields,
  type AppliedKind,
} from "@/domain/assistant-changes";
import { localDate } from "@/domain/time";
import { HttpError } from "../../errors";
import {
  listSuggestions,
  type Confidence,
  type Extracted,
  type SuggestionView,
} from "../../email/suggestions";
import { changesSince } from "../actions";
import { applySuggestion, emailSource, readIfStale, type SuggestionRow } from "../email";
import { emailReadTool } from "./email-read";
import { dayOf, problem, stamp, type Tool, type ToolContext } from "./types";

// Email suggestions (intent 0008, EMS-2..5): what came in by email, and
// applying it when a parent asks. Offered only when there is an email
// source. Nothing here reads mail: only what the source fetched under its
// allow-list became a suggestion (EMS-7), and she sees its fields and the
// short quote, never the email (EMS-2).

// "2026-10-07 Wed 18:00–19:30", "2026-10-07 Wed, all day", "no date".
function whenOf(e: Extracted): string {
  if (!e.date) return "no date";
  if (!e.startTime) return `${dayOf(e.date)}, all day`;
  return `${dayOf(e.date)} ${e.startTime}${e.endTime ? `–${e.endTime}` : ""}`;
}

const isToday = (s: { receivedAt: string }, ctx: ToolContext) =>
  localDate(new Date(s.receivedAt), ctx.timeZone) === localDate(ctx.now, ctx.timeZone);

function shaped(s: SuggestionView, ctx: ToolContext) {
  return {
    id: s.id,
    kind: s.kind,
    title: s.extracted.title,
    when: whenOf(s.extracted),
    place: s.extracted.location ?? undefined,
    about: s.target ? { title: s.target.title, when: stamp(s.target.start, ctx.timeZone) } : undefined,
    // 0013 DUP-4: a new event that seems to be on the calendar already.
    alreadyOnCalendar: s.similar
      ? { title: s.similar.title, when: stamp(s.similar.start, ctx.timeZone) }
      : undefined,
    from: s.from,
    receivedToday: isToday(s, ctx) || undefined,
    unsure: unsureFields(s.confidence).length ? unsureFields(s.confidence) : undefined,
    quote: s.quote,
  };
}

export const suggestionsTool: Tool<Record<string, never>> = {
  name: "suggestions",
  kind: "hub",
  label: "Suggestions",
  description:
    "Email suggestions waiting for a parent's approval: new events, moves and cancellations the coach and club emails mentioned, newest first. Use for 'what came in by email'.",
  input: z.object({}),
  async run(ctx) {
    const source = await emailSource(ctx.db);
    const pending = await listSuggestions(ctx.db, "pending");
    return {
      emailLastRead: !source?.enabled
        ? "the email source is switched off"
        : source.lastSuccessAt
          ? stamp(source.lastSuccessAt, ctx.timeZone)
          : "never",
      pending: pending.slice(0, CHANGE_LIMITS.listed).map((s) => shaped(s, ctx)),
      more: Math.max(0, pending.length - CHANGE_LIMITS.listed) || undefined,
    };
  },
};

// The checks every applying tool makes first (EMS-3, CASEC-1, CASEC-5).
async function mayApply(ctx: ToolContext): Promise<string | null> {
  if (!asksToApply(ctx.question)) return "the question didn't ask you to add or apply anything";
  if (ctx.turn.webRan) return "nothing can be applied in a question that used the web";
  if (ctx.turn.actionIds.length) return "one change per question; this question already made one";
  if ((await changesSince(ctx.db, new Date(ctx.now.getTime() - 86_400_000))) >= CHANGE_LIMITS.perDay)
    return "that's enough changes for one day; say the Suggestions page can approve it";
  return null;
}

async function pendingRow(ctx: ToolContext, id: string): Promise<SuggestionRow | null> {
  const [row] = await ctx.db
    .select()
    .from(emailSuggestions)
    .where(and(eq(emailSuggestions.id, id), eq(emailSuggestions.status, "pending")));
  return row ?? null;
}

const applyInput = z.object({ id: z.uuid().describe("The suggestion's id, from `suggestions`") });

export const suggestionApplyTool: Tool<z.infer<typeof applyInput>> = {
  name: "suggestion_apply",
  kind: "hub",
  label: "Suggestions",
  description:
    "Apply ONE email suggestion the parent named, as approving it on the Suggestions page would: add, move or cancel the event. Only when the question asks for it. Call `suggestions` first; if the parent's words fit none or several, ask which.",
  input: applyInput,
  async run(ctx, q) {
    const no = await mayApply(ctx);
    if (no) return problem(no);
    const s = await pendingRow(ctx, q.id);
    if (!s) return problem("that isn't a waiting suggestion; call `suggestions` and ask which one is meant");
    const ex = s.extracted as Extracted;
    const left = leftBecause({ ...s, date: ex.date, confidence: {} });
    if (left) return problem(`it can't be applied (${left}); say it is on the Suggestions page`);
    let kind: AppliedKind;
    try {
      kind = await applySuggestion(ctx, s);
    } catch (err) {
      if (err instanceof HttpError) return problem(err.message);
      throw err;
    }
    const unsure = unsureFields(s.confidence as Confidence);
    return {
      applied: { kind, title: ex.title, when: whenOf(ex) },
      unsure: unsure.length ? unsure : undefined,
      say: `Say in one line what was ${kind}${unsure.length ? `, and that the email wasn't clear about the ${unsure.join(" and ")}` : ""}. It is on the hub's calendar, not the family's Google Calendar.`,
    };
  },
};

export const suggestionsApplyTodayTool: Tool<Record<string, never>> = {
  name: "suggestions_apply_today",
  kind: "hub",
  label: "Suggestions",
  description:
    "Apply the suggestions from today's emails, when the parent asks to update the calendar from today's email. Applies up to 5; leaves the unsure ones for the Suggestions page.",
  input: z.object({}),
  async run(ctx) {
    const no = await mayApply(ctx);
    if (no) return problem(no);
    const source = await emailSource(ctx.db);
    if (!source) return problem("no email is connected; say Gmail can be added under Settings → Sources");
    // EMS-5
    if ((await readIfStale(ctx.db, source, ctx.now, ctx.launch)) === "reading")
      return {
        checking: true,
        say: "Say you're checking the mail and to ask again in a minute. Nothing was applied.",
      };

    const today = (await listSuggestions(ctx.db, "pending"))
      .filter((s) => isToday(s, ctx))
      .sort((a, b) => a.receivedAt.localeCompare(b.receivedAt));
    const room = Math.min(
      CHANGE_LIMITS.batch,
      CHANGE_LIMITS.perDay - (await changesSince(ctx.db, new Date(ctx.now.getTime() - 86_400_000))),
    );
    const applied: { kind: AppliedKind; title: string; when: string }[] = [];
    const left: { title: string; why: string }[] = [];
    for (const view of today) {
      const why =
        leftBecause({
          kind: view.kind,
          date: view.extracted.date,
          targetEventId: view.target?.id ?? null,
          confidence: view.confidence,
        }) ?? (applied.length >= room ? "past the limit of 5 at once" : null);
      if (why) {
        left.push({ title: view.extracted.title, why });
        continue;
      }
      const row = await pendingRow(ctx, view.id);
      if (!row) continue;
      try {
        applied.push({
          kind: await applySuggestion(ctx, row),
          title: view.extracted.title,
          when: whenOf(view.extracted),
        });
      } catch (err) {
        if (!(err instanceof HttpError)) throw err;
        left.push({ title: view.extracted.title, why: err.message });
      }
    }
    const count = (k: AppliedKind) => applied.filter((a) => a.kind === k).length;
    return {
      added: count("added"),
      moved: count("moved"),
      cancelled: count("cancelled"),
      applied,
      left: left.length ? left : undefined,
      say: applied.length
        ? "In one or two lines: what was added, moved and cancelled; then each one left on the Suggestions page and why (from `left`), if any."
        : "Say nothing from today's email could be applied, and why, or that nothing came in today.",
    };
  },
};

export const EMAIL_TOOLS = [
  suggestionsTool,
  suggestionApplyTool,
  suggestionsApplyTodayTool,
  emailReadTool,
] as Tool[];
