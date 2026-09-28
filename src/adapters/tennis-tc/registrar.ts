import { parse, type HTMLElement } from "node-html-parser";
import { USER_AGENT } from "../http";

// Entering him in a tournament on the site (plan M3b.6, TEN-9, spikes.md
// SP-7): signed in with the stored Tennis Canada login, the one-page entry
// form at /individual-entry/<t> is filled with his event, the regulations
// are agreed to, and it's submitted. The outcome is read from the page the
// site shows next: "entered", or "payment_needed" when the site asks for
// payment (the owner pays; the Tennis page flags it). Anything the app
// can't tell for sure is flagged to the owner too, never counted as
// entered. Plain HTTP with a cookie jar, like the rest of the adapter; the
// same politeness gap between requests (SYNC-5).

export class TcLoginError extends Error {}

export type EntryOutcome =
  | { result: "entered"; note?: string }
  | { result: "payment_needed"; note: string }
  | { result: "unavailable"; note: string };

const COLOURS = ["red", "orange", "green", "yellow"] as const;
const clean = (s: string) => s.replace(/\s+/g, " ").trim();
const colourOf = (s: string) => COLOURS.find((c) => new RegExp(`\\b${c}\\b`, "i").test(s)) ?? null;
// Age numbers in an event name: "U9", "BS10", "RT 9 - 12".
const agesOf = (s: string) =>
  [...s.matchAll(/(\d{1,2})/g)].map((m) => Number(m[1])).filter((n) => n >= 5 && n <= 18);

export type EventOption = { value: string; label: string; fee: string | null };

export function feeOf(label: string): string | null {
  return /\$\s?\d+(?:[.,]\d{2})?/.exec(label)?.[0].replace(/\s/g, "") ?? null;
}

// The form's event whose name matches the event the search chose, e.g.
// "U10 (Orange Ball)" → "BS10 - Orange $30.00": same ball colour, and the
// same age if the name has one. Null when it isn't clear.
export function pickEventOption(options: EventOption[], eventName: string): EventOption | null {
  const real = options.filter((o) => o.value);
  const strip = (l: string) => clean(l.replace(/\$\s?\d+(?:[.,]\d{2})?/, "")).toLowerCase();
  const exact = real.find((o) => strip(o.label) === clean(eventName).toLowerCase());
  if (exact) return exact;
  const colour = colourOf(eventName);
  let fits = real.filter((o) => !colour || colourOf(o.label) === colour);
  const ages = agesOf(eventName);
  if (ages.length) {
    const byAge = fits.filter((o) => agesOf(o.label).some((a) => ages.includes(a)));
    if (byAge.length) fits = byAge;
  }
  if (!colour && !ages.length) return null;
  return fits.length === 1 ? fits[0] : null;
}

type FormField = { name: string; value: string; type: string };

export type EntryForm = {
  action: string;
  fields: FormField[];
  eventField: string;
  options: EventOption[];
  agreeField: string | null;
};

// The entry form (SP-7): one form posting to …/SubmitEntry.
export function parseEntryForm(html: string): EntryForm | null {
  const root = parse(html);
  const form = root.querySelectorAll("form").find((f) => /SubmitEntry/i.test(f.getAttribute("action") ?? ""));
  if (!form) return null;
  const fields: FormField[] = [];
  let eventField = "";
  let options: EventOption[] = [];
  let agreeField: string | null = null;
  for (const el of form.querySelectorAll("input, select, textarea")) {
    const name = el.getAttribute("name");
    if (!name) continue;
    const tag = el.tagName.toLowerCase();
    const type = (el.getAttribute("type") ?? tag).toLowerCase();
    if (tag === "select") {
      if (/SelectedEvents\[0\]\.EventID$/i.test(name)) {
        eventField = name;
        options = el.querySelectorAll("option").map((o: HTMLElement) => {
          const label = clean(o.text);
          return { value: o.getAttribute("value") ?? "", label, fee: feeOf(label) };
        });
      }
      continue;
    }
    if (type === "checkbox") {
      if (/Disclaimer|Agree/i.test(name)) agreeField = name;
      continue;
    }
    if (type === "submit" || type === "button") continue;
    fields.push({ name, value: tag === "textarea" ? "" : (el.getAttribute("value") ?? ""), type });
  }
  if (!eventField) return null;
  return { action: form.getAttribute("action")!, fields, eventField, options, agreeField };
}

export type AfterSubmit =
  | { kind: "entered" }
  | { kind: "payment"; what: string }
  | { kind: "rejected"; message: string }
  | { kind: "unknown" };

const PAY_ACTION = /^(pay(\s+now)?|go to payment|proceed to payment|checkout|pay online)\b/i;
const UNPAID = /\b(unpaid|not paid|payment (required|pending|due|outstanding)|awaiting payment)\b/i;

// What the site shows after Submit, or on the tournament's entry page when
// he's already entered ("My entry" with an "Entered" badge, SP-7).
export function classifyEntryPage(html: string, url: string): AfterSubmit {
  const root = parse(html);
  const path = new URL(url).pathname;
  const text = clean(root.querySelector("main")?.text ?? root.text);
  const actions = root.querySelectorAll("a, button").map((a) => clean(a.text));
  if (/\/(pay|payment|payments|checkout)(\/|$)/i.test(path) || actions.some((a) => PAY_ACTION.test(a)))
    return { kind: "payment", what: "The site asks for payment." };
  if (UNPAID.test(text)) return { kind: "payment", what: `The site says: ${UNPAID.exec(text)![0]}.` };
  if (parseEntryForm(html)) {
    const errors = root
      .querySelectorAll(
        ".field-validation-error, .validation-summary-errors li, .alert--danger, .alert-danger",
      )
      .map((e) => clean(e.text))
      .filter(Boolean);
    return errors.length ? { kind: "rejected", message: errors.join(" ") } : { kind: "unknown" };
  }
  if (/\bMy entry\b/i.test(text) && /\bEntered\b/.test(text)) return { kind: "entered" };
  return { kind: "unknown" };
}

// --- The signed-in client ---------------------------------------------------

const minGap = () => Number(process.env.FETCH_MIN_GAP_MS ?? 2000);

export function tcRegistrarClient(base: string, username: string, password: string) {
  const jar = new Map<string, string>();
  let last = 0;
  let signedIn = false;

  async function request(url: URL, init: { method?: string; body?: URLSearchParams } = {}) {
    let method = init.method ?? "GET";
    let body: URLSearchParams | undefined = init.body;
    let at = url;
    for (let hop = 0; hop < 6; hop++) {
      const wait = last + minGap() - Date.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      last = Date.now();
      const res = await fetch(at, {
        method,
        redirect: "manual",
        headers: {
          "user-agent": USER_AGENT,
          cookie: [...jar].map(([k, v]) => `${k}=${v}`).join("; "),
          ...(body ? { "content-type": "application/x-www-form-urlencoded" } : {}),
        },
        body,
        signal: AbortSignal.timeout(30_000),
      });
      for (const c of res.headers.getSetCookie()) {
        const [pair] = c.split(";");
        const i = pair.indexOf("=");
        if (i > 0) jar.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim());
      }
      const location = res.headers.get("location");
      if (res.status >= 300 && res.status < 400 && location) {
        at = new URL(location, at);
        method = "GET";
        body = undefined;
        continue;
      }
      return { status: res.status, url: at.href, html: await res.text() };
    }
    throw new Error("too many redirects");
  }

  const onLogin = (url: string) => /\/user\/login/i.test(new URL(url).pathname);

  async function signIn(page: { url: string; html: string }) {
    const root = parse(page.html);
    const form = root.querySelector("form#form_login") ?? root.querySelector("form");
    if (!form) throw new TcLoginError("The Tennis Canada sign-in page has changed.");
    const body = new URLSearchParams();
    for (const el of form.querySelectorAll("input")) {
      const name = el.getAttribute("name");
      const type = (el.getAttribute("type") ?? "").toLowerCase();
      if (!name || type === "checkbox") continue;
      body.set(name, el.getAttribute("value") ?? "");
    }
    body.set("Login", username);
    body.set("Password", password);
    const after = await request(new URL(form.getAttribute("action") || "/user", page.url), {
      method: "POST",
      body,
    });
    if (onLogin(after.url))
      throw new TcLoginError("Tennis Canada sign-in failed: check the login on the Accounts page.");
    signedIn = true;
    return after;
  }

  async function entryPage(tournamentId: string) {
    const url = new URL(`/individual-entry/${encodeURIComponent(tournamentId)}`, base);
    let page = await request(url);
    if (onLogin(page.url)) {
      if (signedIn) throw new TcLoginError("Tennis Canada signed the app out.");
      page = await signIn(page);
      if (!new URL(page.url).pathname.toLowerCase().startsWith("/individual-entry"))
        page = await request(url);
    }
    return page;
  }

  return {
    async enter(e: { tournamentId: string; eventName: string }): Promise<EntryOutcome> {
      const page = await entryPage(e.tournamentId);
      const form = parseEntryForm(page.html);
      if (!form) {
        // Already entered (by the owner, or an earlier run): read the status.
        const already = classifyEntryPage(page.html, page.url);
        if (already.kind === "entered") return { result: "entered", note: "Already entered on the site." };
        if (already.kind === "payment") return { result: "payment_needed", note: already.what };
        return { result: "unavailable", note: "The entry form isn't open on the site; use the link." };
      }
      const option = pickEventOption(form.options, e.eventName);
      if (!option)
        return {
          result: "unavailable",
          note: `Couldn't tell which event on the form is "${e.eventName}" (${
            form.options
              .filter((o) => o.value)
              .map((o) => o.label)
              .join("; ") || "none offered"
          }); use the link.`,
        };
      if (!form.agreeField)
        return { result: "unavailable", note: "The entry form has changed; use the link." };
      const body = new URLSearchParams();
      for (const f of form.fields) {
        // The agreement is sent as "true" before its hidden "false" (the
        // site's checkbox pattern), so it's added separately below.
        if (f.name === form.agreeField) continue;
        body.append(f.name, f.value);
      }
      body.set(form.eventField, option.value);
      body.append(form.agreeField, "true");
      body.append(form.agreeField, "false");
      const after = await request(new URL(form.action, page.url), { method: "POST", body });
      const fee = option.fee ? ` Fee ${option.fee}.` : "";
      const outcome = classifyEntryPage(after.html, after.url);
      switch (outcome.kind) {
        case "entered":
          return { result: "entered", note: `Entered in ${option.label.replace(/\s*\$.*$/, "")}.${fee}` };
        case "payment":
          return { result: "payment_needed", note: `Payment required.${fee} ${outcome.what}`.trim() };
        case "rejected":
          return { result: "unavailable", note: `The site didn't take the entry: ${outcome.message}` };
        default:
          // Submitted, but the result isn't clear: the owner checks it.
          return {
            result: "payment_needed",
            note: `Submitted, but the site's answer wasn't clear; check the entry on the site.${fee}`,
          };
      }
    },
  };
}
