import { googleAccessToken, googleApiBase } from "../google-calendar";
import { FetchError, politeFetch } from "../http";
import { SyncError, type Adapter, type AdapterContext, type NormalisedBatch } from "../types";

// Coach and club emails (SRC-4, EML-1, plan M5.8), read-only, through the
// owner's Google account: only messages from allow-listed senders or with
// allow-listed labels are fetched, and every fetched message is checked
// against the list again. Raw emails are never stored (§7.2): the sync
// hands the text to the extraction step, which keeps only the suggestions
// and a short quote. Nothing reaches the calendar without approval (EML-3).

export const GMAIL_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";
const LOOKBACK_DAYS = 14;
const MAX_MESSAGES = 50;
// Enough for a schedule change; long newsletters are cut.
export const MAX_TEXT = 8000;

export type GmailConfig = { senders: string[]; labels: string[]; lookbackDays?: number };

export type EmailMessage = {
  id: string;
  threadId: string;
  from: string;
  subject: string;
  receivedAt: string;
  text: string;
  // Gmail's link to the message, for the approved event (EML-3).
  url: string;
  // It carries one of the allow-list's labels (intent 0025, MS-3).
  byLabel?: boolean;
};

type Header = { name: string; value: string };
export type GmailPart = {
  mimeType?: string;
  headers?: Header[];
  body?: { data?: string; size?: number };
  parts?: GmailPart[];
};
export type GmailMessage = {
  id: string;
  threadId: string;
  labelIds?: string[];
  internalDate?: string;
  payload?: GmailPart;
};
export type GmailRaw = { messages: GmailMessage[]; labelIds: Record<string, string> };

export function parseGmailConfig(config: Record<string, unknown>): GmailConfig {
  const list = (v: unknown) =>
    (Array.isArray(v) ? v : typeof v === "string" ? v.split(/[,\n]/) : [])
      .map((s) => String(s).trim())
      .filter(Boolean);
  const days = Number(config.lookbackDays);
  return {
    senders: list(config.senders).map((s) => s.toLowerCase()),
    labels: list(config.labels),
    lookbackDays: days > 0 && days <= 60 ? days : LOOKBACK_DAYS,
  };
}

const quote = (s: string) => (/[\s"()]/.test(s) ? `"${s.replace(/"/g, "")}"` : s);

// The Gmail search for the allow-list: from any listed sender (a leading
// "*@" means the whole domain, "*@*." the domain and its subdomains, which
// Gmail finds as "from:domain") or with any listed label. Gmail's search
// is wider than the list; `senderAllowed` keeps only what the list allows.
export function gmailQuery(c: GmailConfig): string {
  const terms = [
    ...c.senders.map((s) => `from:${quote(s.replace(/^\*@\*\./, "").replace(/^\*@/, "@"))}`),
    ...c.labels.map((l) => `label:${quote(l.replace(/\s+/g, "-"))}`),
  ];
  return `{${terms.join(" ")}} newer_than:${c.lookbackDays ?? LOOKBACK_DAYS}d`;
}

// The address in a From header: `Coach Sam <sam@club.ca>` → sam@club.ca.
export function fromAddress(from: string): string {
  return (/<([^>]+)>/.exec(from)?.[1] ?? from).trim().toLowerCase();
}

export function senderAllowed(address: string, senders: string[]): boolean {
  const a = address.toLowerCase();
  const domain = a.slice(a.lastIndexOf("@") + 1);
  return senders.some((s) => {
    if (s.startsWith("*@*.")) {
      const d = s.slice(4);
      return domain === d || domain.endsWith(`.${d}`);
    }
    return s.startsWith("*@") ? a.endsWith(s.slice(1)) : a === s;
  });
}

const b64 = (data: string) =>
  Buffer.from(data.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");

function findPart(part: GmailPart | undefined, type: string): string | null {
  if (!part) return null;
  if (part.mimeType === type && part.body?.data) return b64(part.body.data);
  for (const p of part.parts ?? []) {
    const found = findPart(p, type);
    if (found) return found;
  }
  return null;
}

export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>|<\/(p|div|li|tr|h\d)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"');
}

// The readable text of a message: the plain-text part, or the HTML part
// without tags. Quoted replies ("On … wrote:") are cut.
export function messageText(payload: GmailPart | undefined): string {
  const text = findPart(payload, "text/plain") ?? htmlToText(findPart(payload, "text/html") ?? "");
  const cut = text.split(/\n\s*On .{5,200}wrote:\s*\n/)[0];
  return cut
    .replace(/\r/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, MAX_TEXT);
}

const header = (m: GmailMessage, name: string) =>
  m.payload?.headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? "";

export function normaliseGmail(raw: GmailRaw, ctx: AdapterContext): NormalisedBatch {
  const c = parseGmailConfig(ctx.source.config);
  const allowedLabelIds = new Set(
    c.labels.map((l) => raw.labelIds[l.toLowerCase()]).filter((id): id is string => !!id),
  );
  const emails: EmailMessage[] = [];
  const warnings: string[] = [];
  for (const m of raw.messages) {
    const from = header(m, "From");
    const byLabel = (m.labelIds ?? []).some((id) => allowedLabelIds.has(id));
    // EML-1: the search is the first filter; this is the second.
    if (!senderAllowed(fromAddress(from), c.senders) && !byLabel) {
      warnings.push("Skipped a message that isn't from an allowed sender or label.");
      continue;
    }
    emails.push({
      id: m.id,
      threadId: m.threadId,
      from,
      subject: header(m, "Subject").slice(0, 300),
      receivedAt: new Date(Number(m.internalDate ?? Date.parse(header(m, "Date")) ?? 0)).toISOString(),
      text: messageText(m.payload),
      url: `https://mail.google.com/mail/u/0/#all/${m.id}`,
      byLabel,
    });
  }
  // No calendar records: suggestions become events only when approved. An
  // empty window means the sync cancels nothing.
  return { records: [], window: { from: ctx.now, to: ctx.now }, warnings, emails };
}

// The messages a Gmail search finds, in full, with the account's labels
// (to check the allow-list's labels by ID).
export async function searchGmail(token: string, q: string, max: number): Promise<GmailRaw> {
  const labels = await gmail<{ labels?: { id: string; name: string }[] }>(token, "labels");
  const labelIds = Object.fromEntries((labels.labels ?? []).map((l) => [l.name.toLowerCase(), l.id]));
  const list = await gmail<{ messages?: { id: string }[] }>(
    token,
    `messages?maxResults=${max}&q=${encodeURIComponent(q)}`,
  );
  const messages: GmailMessage[] = [];
  for (const { id } of list.messages ?? [])
    messages.push(await gmail<GmailMessage>(token, `messages/${encodeURIComponent(id)}?format=full`));
  return { messages, labelIds };
}

// How far back the sender check looks, and how many senders and labels it
// tries (each is one Gmail search).
export const CHECK_DAYS = 30;
const CHECK_MAX = 20;

// The allowed senders and labels with no email in the last CHECK_DAYS:
// usually a typo. Only message IDs are listed, never read.
export async function unmatchedSenders(token: string, c: GmailConfig): Promise<string[]> {
  const terms = [
    ...c.senders.map((s) => ({
      shown: s,
      q: gmailQuery({ senders: [s], labels: [], lookbackDays: CHECK_DAYS }),
    })),
    ...c.labels.map((l) => ({
      shown: `label ${l}`,
      q: gmailQuery({ senders: [], labels: [l], lookbackDays: CHECK_DAYS }),
    })),
  ].slice(0, CHECK_MAX);
  const none: string[] = [];
  for (const t of terms) {
    const list = await gmail<{ messages?: { id: string }[] }>(
      token,
      `messages?maxResults=1&q=${encodeURIComponent(t.q)}`,
    );
    if (!list.messages?.length) none.push(t.shown);
  }
  return none;
}

async function gmail<T>(token: string, path: string): Promise<T> {
  let res: Response;
  try {
    res = await politeFetch(new URL(`/gmail/v1/users/me/${path}`, googleApiBase()), {
      headers: { authorization: `Bearer ${token}` },
    });
  } catch (err) {
    throw new SyncError(err instanceof FetchError ? err.message : "Couldn't reach Gmail.");
  }
  if (res.status === 401 || res.status === 403)
    throw new SyncError("Gmail refused. Reconnect Google with Gmail access on the Accounts page.");
  if (!res.ok) throw new SyncError(`Gmail answered with an error (${res.status}).`);
  return (await res.json()) as T;
}

export const gmailAdapter: Adapter<GmailRaw> = {
  kind: "gmail",
  label: "Coach and club emails",
  credentialKinds: ["oauth"],
  async fetchRaw(ctx) {
    if (!ctx.credential) throw new SyncError("Connect a Google account with Gmail access first.");
    const c = parseGmailConfig(ctx.source.config);
    if (!c.senders.length && !c.labels.length)
      throw new SyncError("Add at least one sender or label to read on the Sources page.");
    const token = await googleAccessToken(ctx.credential.secret);
    return searchGmail(token, gmailQuery(c), MAX_MESSAGES);
  },
  normalise: normaliseGmail,
};
