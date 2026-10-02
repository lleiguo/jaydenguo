// Cookie's rules (intent 0007): where an answer may come from, how much a
// question may cost, and what she says when she can't answer. Pure, so
// they're unit tested.

export const ASSISTANT_MODES = ["voice", "text"] as const;
export type AssistantMode = (typeof ASSISTANT_MODES)[number];

export const ASSISTANT_OUTCOMES = ["answer", "bark", "limit", "error"] as const;
export type AssistantOutcome = (typeof ASSISTANT_OUTCOMES)[number];

export const MEMORY_VIAS = ["voice", "chat", "settings"] as const;

// CHR-3: what an answer says it is based on.
export const SOURCE_KINDS = ["hub", "memory", "web", "conversation", "self"] as const;
export type SourceKind = (typeof SOURCE_KINDS)[number];

export const LANGUAGES = ["en", "zh", "mixed"] as const;
export type Language = (typeof LANGUAGES)[number];

// What a tool reads; `end` tools (answer, bark) finish the question.
export type ToolKind = "hub" | "memory" | "web" | "end";

export const LIMITS = {
  // LIM-1
  rounds: 4,
  toolCalls: 5,
  webSearches: 1,
  webFetches: 1,
  // One model call, and the whole question, before she gives up (VOX-6).
  roundTimeoutMs: 12_000,
  deadlineMs: 25_000,
  // TOOL-15
  resultChars: 6000,
  promptChars: 8000,
  // LIM-2, LIM-3
  outputTokens: 500,
  questionChars: 500,
  // MEM-8
  historyTurns: 6,
  historyChars: 2000,
  historyMinutes: 30,
  // LIM-4
  perAccount: { limit: 20, windowMs: 5 * 60_000 },
  perDay: 300,
  // LIM-5
  defaultCapUsd: 10,
  speechOffAt: 0.8,
} as const;

// --- Grounding (CHR-3) -------------------------------------------------------

export type Grounding = { ok: true } | { ok: false; reason: string };

// An answer may only claim a source whose tool ran in this question, or
// earlier turns when there are some. `self` (greetings, who she is, sums,
// word help) needs nothing.
export function checkGrounding(
  claimed: readonly SourceKind[],
  ran: readonly ToolKind[],
  hasHistory: boolean,
): Grounding {
  if (!claimed.length) return { ok: false, reason: "no source given" };
  for (const kind of new Set(claimed)) {
    if (kind === "self") continue;
    if (kind === "conversation") {
      if (!hasHistory) return { ok: false, reason: "no earlier turns" };
      continue;
    }
    if (!ran.includes(kind)) return { ok: false, reason: `no ${kind} tool ran` };
  }
  return { ok: true };
}

// --- Limits (LIM-1) ----------------------------------------------------------

export type CallCounts = { total: number; webSearches: number; webFetches: number };

export const noCalls = (): CallCounts => ({ total: 0, webSearches: 0, webFetches: 0 });

// Whether one more call of this tool fits; counts it when it does.
export function allowCall(counts: CallCounts, name: string): boolean {
  if (counts.total >= LIMITS.toolCalls) return false;
  if (name === "web_search" && counts.webSearches >= LIMITS.webSearches) return false;
  if (name === "web_fetch" && counts.webFetches >= LIMITS.webFetches) return false;
  counts.total++;
  if (name === "web_search") counts.webSearches++;
  if (name === "web_fetch") counts.webFetches++;
  return true;
}

export type CapState = "ok" | "speech_off" | "over";

// LIM-5: at 80% spoken answers fall back to the phone's voice; at the cap
// she stops answering until the month ends or the cap is raised.
export function capState(spentUsd: number, capUsd: number): CapState {
  if (capUsd <= 0 || spentUsd >= capUsd) return "over";
  return spentUsd >= capUsd * LIMITS.speechOffAt ? "speech_off" : "ok";
}

// --- Tool results (TOOL-15) --------------------------------------------------

// Drops what the model doesn't need to read: nulls, empty strings and
// empty lists.
export function compact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(compact).filter((v) => v !== undefined);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      const c = compact(v);
      if (c === undefined || c === null || c === "" || (Array.isArray(c) && !c.length)) continue;
      out[k] = c;
    }
    return out;
  }
  return value === null ? undefined : value;
}

function longestArray(node: unknown): unknown[] | null {
  let best: unknown[] | null = null;
  let bestSize = 0;
  const visit = (n: unknown) => {
    if (Array.isArray(n)) {
      const size = JSON.stringify(n).length;
      if (n.length > 1 && size > bestSize) [best, bestSize] = [n, size];
      n.forEach(visit);
    } else if (n && typeof n === "object") Object.values(n).forEach(visit);
  };
  visit(node);
  return best;
}

// A tool result as compact JSON of at most `max` characters. Too long, and
// items come off the end of its longest list until it fits, with
// `more: true` so the model knows there was more.
export function fitResult(value: unknown, max: number = LIMITS.resultChars): string {
  const root = compact(structuredClone(value)) ?? {};
  let text = JSON.stringify(root);
  if (text.length <= max) return text;
  const wrapped: Record<string, unknown> =
    root && typeof root === "object" && !Array.isArray(root)
      ? (root as Record<string, unknown>)
      : { items: root };
  wrapped.more = true;
  for (;;) {
    text = JSON.stringify(wrapped);
    if (text.length <= max) return text;
    const list = longestArray(wrapped);
    if (!list) break;
    list.pop();
  }
  return JSON.stringify({ more: true, text: text.slice(0, max - 40) });
}

// --- Language and fixed lines --------------------------------------------------

const CJK = /[㐀-鿿]/g;

// The language of a typed question, for the lines the server writes itself.
export function languageOf(text: string): Language {
  const cjk = text.match(CJK)?.length ?? 0;
  const latinWords = text.match(/[A-Za-z]{2,}/g)?.length ?? 0;
  if (!cjk) return "en";
  // One or two English words (a name, a sport) in a Chinese sentence is still Chinese.
  return latinWords >= 3 && latinWords * 2 >= cjk ? "mixed" : "zh";
}

const zh = (language: Language | null | undefined) => language === "zh" || language === "mixed";

// CHR-2: a bark the server gives when the model's answer can't stand.
export const barkLine = (language: Language | null | undefined) =>
  zh(language) ? "汪！这个我不知道。" : "Woof! I don't know that one.";

// LIM-4
export const restLine = (language: Language | null | undefined) =>
  zh(language) ? "Cookie 要休息一下，过几分钟再问吧。" : "Cookie needs a rest. Try again in a few minutes.";

// LIM-5
export const capLine = (language: Language | null | undefined) =>
  zh(language) ? "Cookie 这个月的额度用完了。" : "Cookie has reached this month's limit.";

export const errorLine = (language: Language | null | undefined) =>
  zh(language) ? "Cookie 现在答不了，请稍后再试。" : "Cookie can't answer right now. Try again in a moment.";

// CHR-1: short by default. Chinese is counted in characters, English in
// words; a mixed answer counts both.
export function answerLength(text: string): number {
  const cjk = text.match(CJK)?.length ?? 0;
  const words = text.replace(CJK, " ").match(/[A-Za-z0-9][A-Za-z0-9'’:.–-]*/g)?.length ?? 0;
  // 60 characters read about as long as 40 words.
  return Math.round(words + cjk * (40 / 60));
}
