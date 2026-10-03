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
  // Raised from 10,000 when she learned to add an event (intent 0008).
  promptChars: 12_000,
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
  // MEM-9: turn text is cleared after this long.
  historyDays: 90,
} as const;

// LIM-3, VOX-5
export const VOICE_LIMITS = {
  clipSeconds: 30,
  clipBytes: 1024 * 1024,
  // How many names the transcriber is given (VOX-3).
  spellingNames: 40,
  // An answer longer than this is read only this far.
  speechChars: 600,
  perAccount: { limit: 30, windowMs: 5 * 60_000 },
} as const;

// MEM-1, MEM-3, MEM-4
export const MEMORY_LIMITS = {
  textChars: 300,
  keywords: 12,
  results: 8,
  restoreDays: 30,
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

// A clip with no words in it.
export const unheardLine = (language: Language | null | undefined) =>
  zh(language) ? "汪！我没听清，再说一遍？" : "Woof! I didn't catch that. Say it again?";

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

// --- Memory (MEM-1, MEM-5, MEM-6) -----------------------------------------------

// MEM-1: she saves a fact only when the question itself asks her to, so
// text in a tool result (an event title, a web page) can never plant one.
const REMEMBER =
  /\b(remember|memori[sz]e|note (that|down)|keep in mind|make a note|don'?t forget|save (that|this))\b|记住|记得|记下|记一下|别忘|不要忘|帮我记/i;
export const asksToRemember = (question: string) => REMEMBER.test(question);

// MEM-5: and forgets one only when asked to.
const FORGET = /\b(forget|remove|delete|erase)\b|忘记|忘掉|忘了|删掉|删除|别记|不用记/i;
export const asksToForget = (question: string) => FORGET.test(question);

// MEM-6: passwords, card numbers and sign-in codes are never kept.
const SECRET_WORD =
  /pass\s?(word|code|phrase)|\bpin\b|\bcvv\b|security code|sign-?in code|verification code|密码|验证码|口令/i;
const CARD_NUMBER = /(?:\d[ -]?){13,19}/;
export const looksSecret = (text: string) => SECRET_WORD.test(text) || CARD_NUMBER.test(text);

// --- The web (TOOL-11, TOOL-12, CSEC-3, CSEC-4) ---------------------------------

export const WEB_LIMITS = {
  queryChars: 120,
  redirects: 3,
  timeoutMs: 5000,
  bytes: 1024 * 1024,
  pageChars: 8000,
  sources: 3,
} as const;

// CSEC-3: a search query carries nothing about the family. `privateWords`
// are the people's names and the owner's "never send to the web" list.
// Returns what is wrong, in words the model can act on, or null.
export function webQueryProblem(query: string, privateWords: readonly string[]): string | null {
  const q = query.trim();
  if (!q) return "the query is empty";
  if (q.length > WEB_LIMITS.queryChars) return `keep the query under ${WEB_LIMITS.queryChars} characters`;
  const lower = q.toLowerCase();
  const hit = privateWords
    .map((w) => w.trim().toLowerCase())
    .filter((w) => w.length >= 2)
    .some((w) =>
      // A Latin word must match as a whole word ("Sam" isn't in "same").
      /^[\x00-\x7f]+$/.test(w)
        ? new RegExp(`(^|[^a-z0-9])${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z0-9]|$)`).test(lower)
        : lower.includes(w),
    );
  return hit ? "the query names someone or something private; ask it without names" : null;
}

// CSEC-4: the links written in the question itself. A page can be fetched
// only if its link is one of these, so nothing a tool returned (a search
// result, a page's own text) can send her to another address.
export function linksIn(question: string): string[] {
  return (question.match(/https:\/\/[^\s<>"'）)，。]+/g) ?? []).map((u) => u.replace(/[.,;:!?]+$/, ""));
}

// Whether a fetch may go to this address: public unicast only. Private,
// loopback, link-local (which holds the cloud metadata server), carrier
// NAT, multicast and unspecified addresses are all refused, in IPv4, IPv6
// and IPv4 written inside IPv6.
export function isPublicAddress(ip: string): boolean {
  const mapped = ip.toLowerCase().match(/^(?:::ffff:|64:ff9b::)(\d+\.\d+\.\d+\.\d+)$/);
  const v4 = (mapped ? mapped[1] : ip).match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const [a, b] = v4.slice(1).map(Number);
    if (v4.slice(1).some((n) => Number(n) > 255)) return false;
    if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
    if (a === 100 && b >= 64 && b <= 127) return false;
    if (a === 169 && b === 254) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && (b === 168 || b === 0)) return false;
    if (a === 198 && (b === 18 || b === 19)) return false;
    return true;
  }
  const v6 = ip.toLowerCase();
  if (!v6.includes(":")) return false;
  // "::", "::1", and IPv4 carried inside IPv6 however it is written:
  // mapped (::ffff:…), compatible (::…), NAT64 (64:ff9b:…), 6to4 (2002:…)
  // and Teredo (2001:0:…).
  if (/^(::|64:ff9b:|2002:|2001:0?0?0?0:)/.test(v6)) return false;
  // fc00::/7 unique local, fe80::/10 link-local, ff00::/8 multicast.
  if (/^f[cd]/.test(v6) || /^fe[89ab]/.test(v6) || /^ff/.test(v6)) return false;
  // Anything else written with an embedded IPv4 is refused rather than parsed.
  if (v6.includes(".")) return false;
  return true;
}

// The first reason a URL may not be fetched, or null: HTTPS on its usual
// port, a host name (not a bare address), no sign-in details in it.
export function fetchUrlProblem(url: string): string | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return "that isn't a link";
  }
  if (u.protocol !== "https:") return "only https links can be read";
  if (u.port && u.port !== "443") return "only the usual https port can be read";
  if (u.username || u.password) return "links with sign-in details can't be read";
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host) || host.includes(":")) return "links to a bare address can't be read";
  if (!host.includes(".") || /(^|\.)(localhost|internal|local)$/i.test(host))
    return "that isn't a public site";
  return null;
}

// --- Voice (VOX-1..5, LIM-3) -------------------------------------------------

// What the iPhone records: AAC in an MPEG-4 file.
const CLIP_TYPES = new Set(["audio/mp4", "audio/m4a", "audio/x-m4a", "audio/aac"]);

// How long an MPEG-4 clip runs, from its movie header; null if this isn't
// one or it doesn't say.
export function mp4Seconds(bytes: Uint8Array): number | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (at: number) => String.fromCharCode(...bytes.subarray(at, at + 4));
  // Walks the boxes in [from, to) and returns the body of the one named.
  const find = (name: string, from: number, to: number): [number, number] | null => {
    for (let at = from; at + 8 <= to;) {
      let size = view.getUint32(at);
      let head = 8;
      if (size === 1) {
        if (at + 16 > to) return null;
        size = Number(view.getBigUint64(at + 8));
        head = 16;
      } else if (size === 0) size = to - at;
      if (size < head || at + size > to) return null;
      if (tag(at + 4) === name) return [at + head, at + size];
      at += size;
    }
    return null;
  };
  if (bytes.length < 16 || tag(4) !== "ftyp") return null;
  const moov = find("moov", 0, bytes.length);
  const mvhd = moov && find("mvhd", moov[0], moov[1]);
  if (!mvhd) return null;
  const [at, end] = mvhd;
  const long = bytes[at] === 1;
  if (end - at < (long ? 32 : 20)) return null;
  const scale = view.getUint32(at + (long ? 20 : 12));
  const length = long ? Number(view.getBigUint64(at + 24)) : view.getUint32(at + 16);
  return scale > 0 && length > 0 ? length / scale : null;
}

// LIM-3: why a clip is refused, in words the app can show, or null.
export function clipProblem(mimeType: string, bytes: Uint8Array): string | null {
  if (!CLIP_TYPES.has(mimeType.toLowerCase())) return "that isn't a recording Cookie can listen to";
  if (bytes.length > VOICE_LIMITS.clipBytes) return "that recording is too big";
  const seconds = mp4Seconds(bytes);
  if (seconds === null) return "that isn't a recording Cookie can listen to";
  // A little slack: the recorder stops at the limit, give or take a frame.
  if (seconds > VOICE_LIMITS.clipSeconds + 1)
    return `recordings can be ${VOICE_LIMITS.clipSeconds} seconds at most`;
  return null;
}

// VOX-5, CHR-4: the answer as it is read aloud. Links aren't read, and a
// web answer says where it came from.
export function spokenText(text: string, language: Language | null | undefined, fromWeb: boolean): string {
  const plain = text
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[*_#`]+/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, VOICE_LIMITS.speechChars);
  if (!plain || !fromWeb) return plain;
  return zh(language) ? `网上说：${plain}` : `From the web: ${plain}`;
}
