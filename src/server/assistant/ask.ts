import { randomUUID } from "node:crypto";
import type { Content, Part } from "@google/genai";
import { z } from "zod";
import { assistantTurns } from "@db/schema";
import {
  allowCall,
  barkLine,
  capLine,
  capState,
  checkGrounding,
  errorLine,
  fitResult,
  languageOf,
  LIMITS,
  noCalls,
  restLine,
  type AssistantOutcome,
  type Language,
  type SourceKind,
  type ToolKind,
} from "@/domain/assistant";
import { hit } from "../auth/rate-limit";
import type { Db } from "../db/client";
import { LlmError } from "../llm/types";
import { listPeople } from "../people";
import { getHomeTimeZone } from "../settings";
import type { AssistantModel, ModelCall } from "./model";
import { answerInput, barkInput, contextLine, declarations, SYSTEM_PROMPT } from "./prompt";
import { getAssistantSettings } from "./settings";
import { HUB_TOOLS, type Tool, type ToolContext } from "./tools";
import { monthSpendUsd, recentTurns, type AssistantSource } from "./turns";

// One question to Cookie, end to end (intent 0007, spec §4.1): limits, the
// tool loop (at most LIMITS.rounds rounds), the grounding check, then the
// turn is saved with what it cost.

export const askInput = z.object({
  conversationId: z.string().uuid().optional(),
  text: z.string().trim().min(1, "ask a question").max(LIMITS.questionChars, "that question is too long"),
});

export type AskResult = {
  turnId: string;
  conversationId: string;
  // The question as typed or heard (VOX-2).
  heard: string;
  language: Language;
  outcome: AssistantOutcome;
  text: string;
  sources: AssistantSource[];
};

export type AskDeps = {
  model: AssistantModel;
  now?: Date;
  tools?: Tool[];
  // One line per turn: IDs, names and numbers only, never words (CSEC-7).
  log?: (fields: Record<string, unknown>) => void;
};

type ToolRun = { name: string; ms: number; chars: number; ok: boolean };

const consoleLog = (fields: Record<string, unknown>) =>
  console.log(JSON.stringify({ severity: "INFO", message: "assistant turn", ...fields }));

const isProblem = (value: unknown) =>
  !!value && typeof value === "object" && !Array.isArray(value) && "error" in value;

async function runTool(tool: Tool | undefined, ctx: ToolContext, call: ModelCall) {
  if (!tool) return { error: `there is no tool called ${call.name}` };
  const parsed = tool.input.safeParse(call.args);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return { error: `bad input (${first?.path.join(".") || "input"}: ${first?.message})` };
  }
  return tool.run(ctx, parsed.data);
}

export async function ask(
  db: Db,
  deps: AskDeps,
  input: { userId: string; conversationId?: string; text: string },
): Promise<AskResult> {
  const now = deps.now ?? new Date();
  const tools = deps.tools ?? HUB_TOOLS;
  const log = deps.log ?? consoleLog;
  const started = Date.now();
  const conversationId = input.conversationId ?? randomUUID();
  const heard = input.text;
  const language = languageOf(heard);

  const usage = { inputTokens: 0, outputTokens: 0, costUsd: 0 };
  let model: string | null = null;
  let modelVersion: string | null = null;
  const runs: ToolRun[] = [];

  const finish = async (
    outcome: AssistantOutcome,
    text: string,
    sources: AssistantSource[] = [],
    saidLanguage: Language = language,
    why?: string,
  ): Promise<AskResult> => {
    const [row] = await db
      .insert(assistantTurns)
      .values({
        conversationId,
        userId: input.userId,
        mode: "text",
        heard,
        answer: text,
        outcome,
        language: saidLanguage,
        sources,
        tools: runs.map(({ name, ms, chars }) => ({ name, ms, chars })),
        model,
        modelVersion,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        costUsd: usage.costUsd,
        createdAt: now,
      })
      .returning({ id: assistantTurns.id });
    log({
      turnId: row.id,
      outcome,
      why,
      tools: runs.map((r) => r.name),
      ms: Date.now() - started,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
    });
    return { turnId: row.id, conversationId, heard, language: saidLanguage, outcome, text, sources };
  };

  // LIM-4, LIM-5
  const underAccount = await hit(
    db,
    `assistant:user:${input.userId}`,
    LIMITS.perAccount.limit,
    LIMITS.perAccount.windowMs,
  );
  const underDay = await hit(db, "assistant:day", LIMITS.perDay, 86_400_000);
  if (!underAccount || !underDay) return finish("limit", restLine(language), [], language, "rate");
  const settings = await getAssistantSettings(db);
  if (capState(await monthSpendUsd(db, now), settings.monthlyCapUsd) === "over")
    return finish("limit", capLine(language), [], language, "cap");

  const [timeZone, people, history] = await Promise.all([
    getHomeTimeZone(db),
    listPeople(db),
    recentTurns(db, conversationId, now),
  ]);
  const ctx: ToolContext = { db, now, timeZone, people };
  const contents: Content[] = [
    ...history.flatMap((t): Content[] => [
      { role: "user", parts: [{ text: t.heard }] },
      { role: "model", parts: [{ text: t.answer }] },
    ]),
    { role: "user", parts: [{ text: `${contextLine(now, timeZone, people)}\n${heard}` }] },
  ];
  const request = { system: SYSTEM_PROMPT, tools: declarations(tools), contents };
  const counts = noCalls();
  const bark = (why: string) => finish("bark", barkLine(language), [], language, why);

  for (let round = 1; round <= LIMITS.rounds; round++) {
    if (Date.now() - started > LIMITS.deadlineMs)
      return finish("error", errorLine(language), [], language, "deadline");
    let result;
    try {
      result = await deps.model.round(request);
    } catch (err) {
      if (!(err instanceof LlmError)) throw err;
      return finish("error", errorLine(language), [], language, err.kind);
    }
    usage.inputTokens += result.inputTokens;
    usage.outputTokens += result.outputTokens;
    usage.costUsd += result.costUsd;
    model = result.model;
    modelVersion = result.modelVersion;

    const end = result.calls.find((c) => c.name === "answer" || c.name === "bark");
    if (end?.name === "bark") {
      const said = barkInput.safeParse(end.args);
      return said.success ? finish("bark", said.data.text, [], said.data.language) : bark("bad bark");
    }
    if (end) {
      const said = answerInput.safeParse(end.args);
      if (!said.success) return bark("bad answer");
      const ran = [...new Set(runs.filter((r) => r.ok).map((r) => kindOf(tools, r.name)))];
      const grounded = checkGrounding(said.data.sources, ran, history.length > 0);
      if (!grounded.ok) return bark(grounded.reason);
      return finish("answer", said.data.text, sourcesOf(said.data.sources, tools, runs), said.data.language);
    }
    if (!result.calls.length) return bark("no tool call");

    const responses: Part[] = [];
    for (const call of result.calls) {
      if (!allowCall(counts, call.name)) return bark("tool limit");
      const t0 = Date.now();
      let value: unknown;
      try {
        value = await runTool(
          tools.find((t) => t.name === call.name),
          ctx,
          call,
        );
      } catch (err) {
        console.error(
          JSON.stringify({
            severity: "ERROR",
            message: "assistant tool failed",
            tool: call.name,
            error: String(err),
          }),
        );
        value = { error: "that lookup failed" };
      }
      const text = fitResult(value);
      runs.push({ name: call.name, ms: Date.now() - t0, chars: text.length, ok: !isProblem(value) });
      responses.push({
        functionResponse: { id: call.id, name: call.name, response: { result: JSON.parse(text) as unknown } },
      });
    }
    contents.push(result.content, { role: "user", parts: responses });
  }
  return bark("round limit");
}

const kindOf = (tools: Tool[], name: string): ToolKind => tools.find((t) => t.name === name)?.kind ?? "end";

// CHR-4: where the answer came from, as the clients show it.
function sourcesOf(claimed: SourceKind[], tools: Tool[], runs: ToolRun[]): AssistantSource[] {
  const out: AssistantSource[] = [];
  for (const kind of new Set(claimed)) {
    if (kind === "conversation") out.push({ kind, label: "Earlier in this chat" });
    else if (kind === "self") out.push({ kind, label: "Cookie" });
    else {
      const labels = runs
        .filter((r) => r.ok)
        .flatMap((r) => {
          const tool = tools.find((t) => t.name === r.name);
          return tool?.kind === kind ? [tool.label] : [];
        });
      for (const label of new Set(labels)) out.push({ kind, label });
    }
  }
  return out;
}
