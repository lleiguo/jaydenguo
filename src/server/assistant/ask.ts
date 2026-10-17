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
  clipProblem,
  errorLine,
  fitResult,
  imageProblem,
  languageOf,
  LIMITS,
  mp4Seconds,
  noCalls,
  restLine,
  SHARED_LIMITS,
  unheardLine,
  VOICE_LIMITS,
  type AssistantOutcome,
  type ClaimKind,
  type Language,
  type Shared,
  type ToolKind,
} from "@/domain/assistant";
import { addingLine, appliedLine } from "@/domain/assistant-changes";
import { hit } from "../auth/rate-limit";
import { HttpError } from "../errors";
import type { Db } from "../db/client";
import { LlmError } from "../llm/types";
import { listPeople } from "../people";
import { getHomeTimeZone } from "../settings";
import type { AssistantModel, ModelCall } from "./model";
import {
  answerInput,
  barkInput,
  contextLine,
  declarations,
  pastedPart,
  SHARED_MARKER,
  systemPrompt,
} from "./prompt";
import { errorKind } from "./quiet";
import { getAssistantSettings } from "./settings";
import type { MemoryView } from "./memory";
import { geminiTranscriber, spellingList, type Clip, type Transcriber } from "./transcribe";
import { canAdd, claimActions, didFor, type Did } from "./actions";
import { emailSource } from "./email";
import { claimRead, type Waiting } from "./email-read";
import {
  CHANGE_TOOLS,
  EMAIL_TOOLS,
  HUB_TOOLS,
  MEMORY_TOOLS,
  newTurn,
  WEB_TOOLS,
  type Tool,
  type ToolContext,
} from "./tools";
import { monthSpendUsd, recentTurns, type AssistantSource } from "./turns";
import { geminiSearch, guardedFetch, type PageFetch, type WebSearch } from "./web";

// One question to Cookie, end to end (intent 0007, spec §4.1): limits, a
// spoken question turned into text, the tool loop (at most LIMITS.rounds
// rounds), the grounding check, then the turn is saved with what it cost.

// Base64 of a clip at the size limit, with room for padding.
const CLIP_BASE64 = Math.ceil(VOICE_LIMITS.clipBytes / 3) * 4 + 4;
const IMAGE_BASE64 = Math.ceil(SHARED_LIMITS.imageBytes / 3) * 4 + 4;

// A typed question, or a recording of a spoken one (LIM-3). Either may come
// with screenshots or a pasted text, or those may come alone (intent 0019,
// SHT-1..5).
export const askInput = z
  .object({
    conversationId: z.string().uuid().optional(),
    text: z
      .string()
      .trim()
      .min(1, "ask a question")
      .max(LIMITS.questionChars, "that question is too long")
      .optional(),
    audio: z
      .object({
        data: z.string().min(1, "that recording is empty").max(CLIP_BASE64, "that recording is too big"),
        mimeType: z.string().max(40),
      })
      .optional(),
    images: z
      .array(
        z.object({
          data: z.string().min(1, "that picture is empty").max(IMAGE_BASE64, "that picture is too big"),
          mimeType: z.string().max(40),
        }),
      )
      .min(1)
      .max(SHARED_LIMITS.images, `share at most ${SHARED_LIMITS.images} pictures`)
      .optional(),
    pasted: z
      .string()
      .trim()
      .min(1, "the pasted text is empty")
      .max(SHARED_LIMITS.pastedChars, "that pasted text is too long")
      .optional(),
  })
  .refine((q) => !(q.text !== undefined && q.audio !== undefined), "ask a question")
  .refine((q) => !(q.images && q.pasted !== undefined), "share pictures or a text, not both")
  .refine(
    (q) => q.text !== undefined || q.audio !== undefined || !!q.images || q.pasted !== undefined,
    "ask a question",
  );

// What a parent shared, checked (SHT-2): base64 JPEGs, or a pasted text.
export type SharedInput = { kind: "images"; images: string[] } | { kind: "pasted"; text: string };

// The pictures as checked base64, or a 400 that says what is wrong.
export function sharedOf(input: {
  images?: { data: string; mimeType: string }[];
  pasted?: string;
}): SharedInput | undefined {
  if (input.pasted !== undefined) return { kind: "pasted", text: input.pasted };
  if (!input.images) return undefined;
  const images = input.images.map((image) => {
    const data = /^[A-Za-z0-9+/]+={0,2}$/.test(image.data) ? Buffer.from(image.data, "base64") : null;
    const problem = data ? imageProblem(image.mimeType, data) : "that isn't a picture Cookie can read";
    if (!data || problem) throw new HttpError(400, problem ?? "bad picture");
    return image.data;
  });
  return { kind: "images", images };
}

// The recording as bytes, or a 400 that says what is wrong with it.
export function clipOf(audio: { data: string; mimeType: string }): Clip {
  const data = /^[A-Za-z0-9+/]+={0,2}$/.test(audio.data) ? Buffer.from(audio.data, "base64") : null;
  const problem = data ? clipProblem(audio.mimeType, data) : "that isn't a recording Cookie can listen to";
  if (!data || problem) throw new HttpError(400, problem ?? "bad recording");
  return { data, mimeType: "audio/mp4" };
}

export type AskResult = {
  turnId: string;
  conversationId: string;
  // The question as typed or heard (VOX-2).
  heard: string;
  language: Language;
  outcome: AssistantOutcome;
  text: string;
  sources: AssistantSource[];
  // A fact this question saved or forgot, for "Saved to memory · Undo" (MEM-2).
  saved: MemoryView | null;
  forgot: MemoryView | null;
  // What this question changed, with its Undo (intent 0008, ACT-1).
  did: Did | null;
  // An email she went to read: the summary follows (intent 0009, ERA-1).
  waiting: Waiting | null;
};

export type AskDeps = {
  model: AssistantModel;
  // Turns a spoken question into text (VOX-1).
  transcribe?: Transcriber;
  now?: Date;
  tools?: Tool[];
  // The web, when "Use the web" is on (TOOL-17).
  web?: { search: WebSearch; fetch: PageFetch };
  // Starts worker jobs (intent 0008: writing an added event to Google).
  launch?: (args: string[]) => Promise<void>;
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
  input: { userId: string; conversationId?: string; text?: string; audio?: Clip; shared?: SharedInput },
): Promise<AskResult> {
  const now = deps.now ?? new Date();
  const turn = newTurn();
  const log = deps.log ?? consoleLog;
  const started = Date.now();
  const conversationId = input.conversationId ?? randomUUID();
  // A spoken question has no words until it is transcribed, below.
  const clip = input.audio;
  const seconds = clip ? mp4Seconds(clip.data) : null;
  let heard = clip ? "" : (input.text ?? "");
  // What was shared, as the turn records it (SHSEC-1), and what its checks
  // may read. With no words, the server's own lines follow the material's
  // language (SHA-4).
  const material = input.shared;
  const shared: Shared | null = !material
    ? null
    : material.kind === "images"
      ? { kind: "images", count: material.images.length }
      : { kind: "pasted", count: material.text.length };
  const limits = shared
    ? { toolCalls: SHARED_LIMITS.toolCalls, deadlineMs: SHARED_LIMITS.deadlineMs }
    : { toolCalls: LIMITS.toolCalls, deadlineMs: LIMITS.deadlineMs };
  let language = languageOf(heard || (material?.kind === "pasted" ? material.text : ""));

  const usage = { inputTokens: 0, outputTokens: 0, costUsd: 0 };
  let people: Awaited<ReturnType<typeof listPeople>> = [];
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
        mode: clip ? "voice" : "text",
        heard,
        sharedKind: shared?.kind ?? null,
        sharedCount: shared?.count ?? null,
        answer: text,
        outcome,
        language: saidLanguage,
        sources,
        tools: runs.map(({ name, ms, chars }) => ({ name, ms, chars })),
        model,
        modelVersion,
        inputTokens: usage.inputTokens + turn.webCost.inputTokens,
        outputTokens: usage.outputTokens + turn.webCost.outputTokens,
        audioSeconds: seconds,
        searches: turn.webCost.searches,
        costUsd: usage.costUsd + turn.webCost.costUsd,
        createdAt: now,
      })
      .returning({ id: assistantTurns.id });
    await claimActions(db, turn.actionIds, row.id);
    if (turn.emailRead) await claimRead(db, turn.emailRead.id, row.id);
    const did = turn.actionIds.length ? ((await didFor(db, [row.id], people)).get(row.id) ?? null) : null;
    log({
      turnId: row.id,
      outcome,
      why,
      tools: runs.map((r) => r.name),
      shared: shared ? `${shared.kind}:${shared.count}` : undefined,
      ms: Date.now() - started,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
    });
    return {
      turnId: row.id,
      conversationId,
      heard,
      language: saidLanguage,
      outcome,
      text,
      sources,
      saved: turn.saved,
      forgot: turn.forgot,
      did,
      waiting: turn.emailRead ? { kind: "email", until: turn.emailRead.until } : null,
    };
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

  const [timeZone, everyone, history] = await Promise.all([
    getHomeTimeZone(db),
    listPeople(db),
    recentTurns(db, conversationId, now),
  ]);
  people = everyone;

  // VOX-1..3: the clip becomes text first, so the words are known whatever
  // happens next, and a spoken question takes the same path as a typed one.
  if (clip) {
    let transcript;
    try {
      transcript = await (deps.transcribe ?? geminiTranscriber())(clip, await spellingList(db, people));
    } catch (err) {
      if (!(err instanceof LlmError)) throw err;
      return finish("error", errorLine(language), [], language, err.kind);
    }
    usage.inputTokens += transcript.inputTokens;
    usage.outputTokens += transcript.outputTokens;
    usage.costUsd += transcript.costUsd;
    model = transcript.model;
    modelVersion = transcript.modelVersion;
    heard = transcript.text.slice(0, LIMITS.questionChars);
    language = languageOf(heard);
    // A recording with nothing said is fine when something was shared:
    // she summarizes it (SHA-4).
    if (!heard && !shared) return finish("bark", unheardLine(language), [], language, "nothing heard");
  }
  // The web tools aren't even described to the model while the web is off.
  // Nor is adding to the calendar, until she is able to (intent 0008, GCW-8).
  const tools = deps.tools ?? [
    ...HUB_TOOLS,
    ...((await canAdd(db, settings)) ? CHANGE_TOOLS : []),
    ...((await emailSource(db)) ? EMAIL_TOOLS : []),
    ...MEMORY_TOOLS,
    // SHSEC-3: nothing shared can reach the web.
    ...(settings.web && !shared ? WEB_TOOLS : []),
  ];
  const webOn = tools.some((t) => t.kind === "web");
  const changeOn = tools.some((t) => t.name === "calendar_add");
  const emailOn = tools.some((t) => t.name === "suggestions");
  const ctx: ToolContext = {
    db,
    now,
    timeZone,
    people,
    userId: input.userId,
    question: heard,
    conversationId,
    spoken: !!clip,
    shared: shared && { ...shared, text: material?.kind === "pasted" ? material.text : undefined },
    turn,
    settings,
    web: deps.web ?? { search: (q, l) => geminiSearch()(q, l), fetch: guardedFetch() },
    launch: deps.launch,
  };
  // SHSEC-2: what was shared goes in its own parts behind the marker line,
  // ahead of the question, which stays the parent's words alone.
  const materialParts: Part[] = !material
    ? []
    : [
        { text: SHARED_MARKER },
        ...(material.kind === "images"
          ? material.images.map((data): Part => ({ inlineData: { mimeType: "image/jpeg", data } }))
          : [{ text: pastedPart(material.text) }]),
      ];
  const contents: Content[] = [
    ...history.flatMap((t): Content[] => [
      { role: "user", parts: [{ text: t.heard }] },
      { role: "model", parts: [{ text: t.answer }] },
    ]),
    {
      role: "user",
      parts: [...materialParts, { text: `${contextLine(now, timeZone, people)}\n${heard || "[no words]"}` }],
    },
  ];
  const request = {
    system: systemPrompt(webOn, changeOn, emailOn, !!shared),
    tools: declarations(tools),
    contents,
    ...(shared ? { timeoutMs: SHARED_LIMITS.roundTimeoutMs } : {}),
  };
  const counts = noCalls();
  // If an event was added and her own ending can't stand, the server
  // says what was added: a bark would hide a change that did happen.
  const bark = (why: string) =>
    turn.added.length
      ? finish(
          "answer",
          turn.added.map((event) => addingLine(language, event)).join("\n"),
          [{ kind: "hub", label: "Calendar" }],
          language,
          why,
        )
      : turn.applied.length
        ? finish(
            "answer",
            appliedLine(language, turn.applied),
            [{ kind: "hub", label: "Suggestions" }],
            language,
            why,
          )
        : finish("bark", barkLine(language), [], language, why);
  // The model failing after something was changed still says what was:
  // "can't answer right now" would hide it (intent 0019, found in SP-S2).
  const failed = (why: string) =>
    turn.added.length || turn.applied.length
      ? bark(why)
      : finish("error", errorLine(language), [], language, why);

  for (let round = 1; round <= LIMITS.rounds; round++) {
    if (Date.now() - started > limits.deadlineMs) return failed("deadline");
    // LIM-1: on her last round, or with her lookups used up, she may only
    // finish: answer from what she has found, or bark. Otherwise a
    // question could spend every round looking and end with nothing.
    const last = round === LIMITS.rounds || counts.total >= limits.toolCalls;
    let result;
    try {
      result = await deps.model.round(last ? { ...request, only: ["answer", "bark"] } : request);
    } catch (err) {
      if (!(err instanceof LlmError)) throw err;
      return failed(err.kind);
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
      const grounded = checkGrounding(said.data.sources, ran, history.length > 0, !!shared);
      if (!grounded.ok) return bark(grounded.reason);
      return finish(
        "answer",
        said.data.text,
        sourcesOf(said.data.sources, tools, runs, turn.webSources),
        said.data.language,
      );
    }
    if (!result.calls.length) return bark("no tool call");
    if (last) return bark("round limit");

    const responses: Part[] = [];
    for (const call of result.calls) {
      if (!allowCall(counts, call.name, limits.toolCalls)) return bark("tool limit");
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
            // The kind only: a database error's message quotes values (CSEC-7).
            error: errorKind(err),
          }),
        );
        value = { error: "that lookup failed" };
      }
      const text = fitResult(value);
      const ok = !isProblem(value);
      runs.push({ name: call.name, ms: Date.now() - t0, chars: text.length, ok });
      if (ok && kindOf(tools, call.name) === "web") turn.webRan = true;
      responses.push({
        functionResponse: { id: call.id, name: call.name, response: { result: JSON.parse(text) as unknown } },
      });
    }
    // A web search's answer is Google's: it goes out word for word, with
    // its links, and ends the question (see ./web.ts).
    if (turn.webAnswer) return finish("answer", turn.webAnswer.text, turn.webAnswer.sources, language, "web");
    contents.push(result.content, { role: "user", parts: responses });
  }
  return bark("round limit");
}

const kindOf = (tools: Tool[], name: string): ToolKind => tools.find((t) => t.name === name)?.kind ?? "end";

// CHR-4: where the answer came from, as the clients show it.
function sourcesOf(
  claimed: ClaimKind[],
  tools: Tool[],
  runs: ToolRun[],
  pages: AssistantSource[],
): AssistantSource[] {
  const out: AssistantSource[] = [];
  for (const kind of new Set(claimed)) {
    if (kind === "conversation") out.push({ kind, label: "Earlier in this chat" });
    else if (kind === "self") out.push({ kind, label: "Cookie" });
    else if (kind === "shared") out.push({ kind: "self", label: "What you shared", shared: true });
    else if (kind === "web") out.push(...pages);
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
