import { and, desc, eq, ne } from "drizzle-orm";
import { assistantActions, emailSuggestions, sources, syncRuns } from "@db/schema";
import { appliedKind } from "@/domain/assistant-changes";
import type { DbOrTx } from "../db/client";
import { approveSuggestion, type Extracted } from "../email/suggestions";
import { COOKIE_READ_GAP_MS, STALE_RUN_MS } from "../sync/policy";
import { cookieActor, type AppliedBefore } from "./actions";
import type { ToolContext } from "./tools/types";

// Email suggestions through Cookie (intent 0008, EMS-2..7): what the email
// source has read stays on the Suggestions page until a parent asks her to
// apply it, by the same path as the page's Approve.

export type EmailSource = { id: string; enabled: boolean; lastSuccessAt: Date | null };

// The email source she reads suggestions from: the first Gmail source.
// Without one she isn't given the email tools.
export async function emailSource(db: DbOrTx): Promise<EmailSource | null> {
  const [row] = await db
    .select({ id: sources.id, enabled: sources.enabled, lastSuccessAt: sources.lastSuccessAt })
    .from(sources)
    .where(eq(sources.kind, "gmail"))
    .orderBy(desc(sources.enabled), sources.createdAt)
    .limit(1);
  return row ?? null;
}

// EMS-5: today's email hasn't been read if the source last read more than
// half an hour ago. Then she starts a read (outside the hourly limit) and
// applies nothing yet. "reading": a read is under way; "fresh": go ahead.
export async function readIfStale(
  db: DbOrTx,
  source: EmailSource,
  now: Date,
  launch?: (args: string[]) => Promise<void>,
): Promise<"fresh" | "reading"> {
  // A switched-off source isn't read; what it holds is all there is.
  if (!source.enabled) return "fresh";
  if (source.lastSuccessAt && now.getTime() - source.lastSuccessAt.getTime() < COOKIE_READ_GAP_MS)
    return "fresh";
  const [last] = await db
    .select({ status: syncRuns.status, startedAt: syncRuns.startedAt })
    .from(syncRuns)
    .where(and(eq(syncRuns.sourceId, source.id), ne(syncRuns.status, "skipped")))
    .orderBy(desc(syncRuns.startedAt))
    .limit(1);
  const running = last?.status === "running" && now.getTime() - last.startedAt.getTime() < STALE_RUN_MS;
  if (!running) await launch?.(["sync", source.id, "manual", "cookie"]).catch(() => undefined);
  return "reading";
}

export type SuggestionRow = typeof emailSuggestions.$inferSelect;

// EMS-3, EMS-4: apply one pending suggestion as the Suggestions page's
// Approve would, recorded so the answer can show it and Undo it (ACT-2).
export async function applySuggestion(ctx: ToolContext, s: SuggestionRow) {
  const actor = await cookieActor(ctx.db, ctx.userId);
  const { eventId, undo } = await approveSuggestion(ctx.db, actor, s.id, null);
  const [action] = await ctx.db
    .insert(assistantActions)
    .values({
      userId: ctx.userId,
      kind: "apply_suggestion",
      // Nothing goes to Google (EMS-6): done as soon as it's applied.
      state: "done",
      eventId: eventId ?? s.targetEventId,
      suggestionId: s.id,
      before: { kind: s.kind, undo, at: new Date().toISOString() } satisfies AppliedBefore,
      // A millisecond apart, so the answer's cards keep the order they were applied in.
      createdAt: new Date(ctx.now.getTime() + ctx.turn.actionIds.length),
      doneAt: ctx.now,
    })
    .returning({ id: assistantActions.id });
  ctx.turn.actionIds.push(action.id);
  const kind = appliedKind(s.kind);
  ctx.turn.applied.push({ title: (s.extracted as Extracted).title, kind });
  return kind;
}
