"use client";

import { useCallback, useEffect, useState } from "react";
import { CATEGORIES } from "@/domain/constants";
import type { Person } from "@/domain/people";
import { HOUSEHOLD_RULES, SCHOOL_DATE_RULES } from "@/domain/categories";
import { rulesToText, textToRules } from "./rules";

// Sources (ACT-1, SYNC-1, SYNC-2, SYNC-4): what feeds the calendar, how each
// maps to categories, run history, and on-demand refresh with live progress.

type Run = {
  id: string;
  trigger: string;
  status: string;
  added: number;
  changed: number;
  cancelled: number;
  errorMessage: string | null;
  startedAt: string;
  finishedAt: string | null;
};
type Source = {
  id: string;
  kind: Kind;
  name: string;
  enabled: boolean;
  credentialLabel: string | null;
  config: { entry?: EntrySettings } | null;
  categoryMapping: Mapping;
  lastSuccessAt: string | null;
  lastRun: Run | null;
  running: boolean;
  nextRefreshAt: string | null;
};
type Mapping = {
  default: string;
  owners?: string[];
  rules?: { match: string; category?: string; attendance?: string; owner?: string }[];
};
type EntrySettings = {
  homePostalCode?: string;
  autoEnter?: boolean;
  maxDriveMinutes?: number;
  include?: string;
  prefer?: string;
  exclude?: string;
};
type Credential = {
  id: string;
  kind: string;
  provider: string;
  label: string;
  meta: { calendars?: { id: string; summary: string; primary: boolean }[] };
  scopes: string[] | null;
};

const GMAIL_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";
const splitList = (v: FormDataEntryValue | null) =>
  String(v ?? "")
    .split(/[,\n]/)
    .map((x) => x.trim())
    .filter(Boolean);

type Kind = "google_calendar" | "ical" | "commit_swim" | "tennis_tc" | "school_dates" | "veracross" | "gmail";
const KIND_LABEL: Record<Kind, string> = {
  google_calendar: "Google Calendar",
  ical: "Calendar feed",
  commit_swim: "Commit Swimming",
  tennis_tc: "Tennis Canada tournaments",
  school_dates: "School key dates",
  veracross: "Veracross",
  gmail: "Coach and club emails",
};
// Kinds that read public pages and need no account.
const NO_ACCOUNT: Kind[] = ["tennis_tc", "school_dates"];
const ACCOUNT_NOUN: Record<Kind, [string, string]> = {
  google_calendar: ["a Google account", "Google account"],
  ical: ["a private calendar link", "Calendar link"],
  commit_swim: ["a Commit Swimming login", "Commit Swimming login"],
  tennis_tc: ["", ""],
  school_dates: ["", ""],
  veracross: ["a Veracross login", "Veracross login"],
  gmail: ["a Google account with Gmail access", "Google account"],
};
const DEFAULT_CATEGORY: Record<Kind, string> = {
  google_calendar: "other",
  ical: "soccer",
  commit_swim: "swimming",
  tennis_tc: "tennis",
  school_dates: "school_class",
  veracross: "school_class",
  gmail: "other",
};

const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : "never");
const label = (c: string) => c.replace("_", " ");

export function SourcesPanel() {
  const [sources, setSources] = useState<Source[] | null>(null);
  const [creds, setCreds] = useState<Credential[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [s, c, p] = await Promise.all([
      fetch("/api/v1/sources"),
      fetch("/api/v1/credentials"),
      fetch("/api/v1/people"),
    ]);
    if (s.ok) setSources((await s.json()).sources);
    if (c.ok) setCreds((await c.json()).credentials);
    if (p.ok) setPeople((await p.json()).people);
  }, []);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  // Live progress while anything runs (SYNC-2).
  const anyRunning = sources?.some((s) => s.running) ?? false;
  const [watchUntil, setWatchUntil] = useState(0);
  useEffect(() => {
    if (!anyRunning && Date.now() > watchUntil) return;
    const t = setInterval(load, 2000);
    return () => clearInterval(t);
  }, [anyRunning, watchUntil, load]);

  // Returns what to tell the owner: shown next to the button they pressed.
  async function refresh(url: string, what: string): Promise<string> {
    const res = await fetch(url, { method: "POST" });
    const body = await res.json().catch(() => ({}));
    if (res.ok) {
      setWatchUntil(Date.now() + 30_000);
      return `Refreshing ${what}…`;
    }
    return body.error ?? "Couldn't start the refresh.";
  }

  async function toggle(s: Source) {
    await fetch(`/api/v1/sources/${s.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ enabled: !s.enabled }),
    });
    await load();
  }

  if (!sources) return <p>Loading…</p>;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <button
          className="rounded-md border px-3 py-2"
          onClick={async () => setMessage(await refresh("/api/v1/sources/refresh-all", "all sources"))}
        >
          Refresh all
        </button>
        <p aria-live="polite" className="text-sm">
          {message}
        </p>
      </div>

      {sources.length === 0 && <p>No sources yet. Add one below.</p>}
      <ul className="flex flex-col gap-3">
        {sources.map((s) => (
          <SourceCard
            key={s.id}
            s={s}
            people={people}
            onSaved={load}
            onRefresh={() => refresh(`/api/v1/sources/${s.id}/refresh`, s.name)}
            onToggle={() => toggle(s)}
          />
        ))}
      </ul>

      <AddSource creds={creds} people={people} onAdded={load} />
    </div>
  );
}

function SourceCard({
  s,
  people,
  onSaved,
  onRefresh,
  onToggle,
}: {
  s: Source;
  people: Person[];
  onSaved: () => void;
  onRefresh: () => Promise<string>;
  onToggle: () => void;
}) {
  const [runs, setRuns] = useState<Run[] | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [entryOpen, setEntryOpen] = useState(false);
  const [mappingOpen, setMappingOpen] = useState(false);
  const failed = s.lastRun?.status === "failed";
  const status = s.running ? "Syncing…" : failed ? "Failed" : s.lastRun ? "OK" : "Not synced yet";
  const tooSoon = !!s.nextRefreshAt && new Date(s.nextRefreshAt) > new Date();
  const historyOpen = runs !== null;
  const loadRuns = useCallback(async () => {
    const res = await fetch(`/api/v1/sources/${s.id}/runs`);
    setRuns(res.ok ? (await res.json()).runs : []);
  }, [s.id]);
  // Once the run starts, the status says "Syncing…" instead.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (s.running) setMessage(null);
  }, [s.running]);
  // An open history follows new runs as they start and finish.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (historyOpen) void loadRuns();
  }, [historyOpen, loadRuns, s.lastRun?.id, s.lastRun?.status, s.running]);
  return (
    <li
      data-testid="source"
      className={`flex flex-col gap-1 rounded-lg border p-3 text-sm ${failed ? "border-red-700" : "border-neutral-200 dark:border-neutral-800"}`}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-base font-semibold">{s.name}</h2>
        <span className={failed ? "font-medium text-red-700 dark:text-red-400" : ""}>
          {failed && "⚠ "}
          {status}
          {!s.enabled && " · switched off"}
        </span>
      </div>
      <div className="text-neutral-600 dark:text-neutral-400">
        {KIND_LABEL[s.kind] ?? s.kind} ·{" "}
        {NO_ACCOUNT.includes(s.kind) ? "public pages" : (s.credentialLabel ?? "no account")} · default
        category {label(s.categoryMapping.default)}
        {people.length > 1 && ` · ${ownerNames(s.categoryMapping.owners, people)}'s`}
      </div>
      {s.kind === "gmail" && (
        <div className="text-neutral-600 dark:text-neutral-400">
          Reads only:{" "}
          {[
            ...((s.config as { senders?: string[] }).senders ?? []),
            ...((s.config as { labels?: string[] }).labels ?? []).map((l) => `label ${l}`),
          ].join(", ")}{" "}
          ·{" "}
          <a href="/settings/suggestions" className="underline">
            suggestions
          </a>
        </div>
      )}
      {failed && s.lastRun?.errorMessage && (
        <p className="text-red-700 dark:text-red-400" data-testid="source-error">
          {s.lastRun.errorMessage}
        </p>
      )}
      <div>
        Last synced {fmt(s.lastSuccessAt)}
        {s.lastRun?.status === "succeeded" &&
          ` · ${s.lastRun.added} added, ${s.lastRun.changed} changed, ${s.lastRun.cancelled} cancelled`}
      </div>
      <div className="flex flex-wrap gap-2">
        <button
          className="rounded border px-2 py-1 disabled:opacity-50"
          onClick={async () => {
            setMessage(null);
            setMessage(await onRefresh());
          }}
          disabled={s.running || !s.enabled}
          title={tooSoon ? `Next refresh after ${fmt(s.nextRefreshAt)}` : undefined}
        >
          Refresh
        </button>
        <button className="rounded border px-2 py-1" onClick={onToggle}>
          {s.enabled ? "Switch off" : "Switch on"}
        </button>
        <button
          className="rounded border px-2 py-1"
          aria-expanded={mappingOpen}
          onClick={() => setMappingOpen(!mappingOpen)}
        >
          Categories and owners
        </button>
        {s.kind === "tennis_tc" && (
          <button
            className="rounded border px-2 py-1"
            aria-expanded={entryOpen}
            onClick={() => setEntryOpen(!entryOpen)}
          >
            Tournament entries
          </button>
        )}
        <button
          className="rounded border px-2 py-1"
          aria-expanded={historyOpen}
          onClick={() => (historyOpen ? setRuns(null) : void loadRuns())}
        >
          History
        </button>
      </div>
      {message && (
        <p role="status" data-testid="refresh-message">
          {message}
        </p>
      )}
      {tooSoon && !s.running && (
        <p className="text-neutral-600 dark:text-neutral-400">
          The next refresh is possible after {fmt(s.nextRefreshAt)}.
        </p>
      )}
      {entryOpen && <EntryForm s={s} onSaved={() => setEntryOpen(false)} />}
      {mappingOpen && (
        <MappingForm
          s={s}
          people={people}
          onSaved={() => {
            setMappingOpen(false);
            onSaved();
          }}
        />
      )}
      {runs && (
        <table className="mt-2 w-full text-left text-xs">
          <caption className="sr-only">Run history for {s.name}</caption>
          <thead>
            <tr>
              <th>Started</th>
              <th>Took</th>
              <th>Status</th>
              <th>+ / ~ / ×</th>
            </tr>
          </thead>
          <tbody>
            {runs.map((r) => (
              <tr key={r.id}>
                <td>{fmt(r.startedAt)}</td>
                <td>
                  {r.finishedAt
                    ? `${Math.round((+new Date(r.finishedAt) - +new Date(r.startedAt)) / 1000)} s`
                    : "…"}
                </td>
                <td title={r.errorMessage ?? undefined}>
                  {r.status} ({r.trigger})
                </td>
                <td>
                  {r.added} / {r.changed} / {r.cancelled}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </li>
  );
}

// Whose events, by default; none means the primary person.
function ownerNames(ids: string[] | undefined, people: Person[]) {
  const named = people.filter((p) => ids?.includes(p.id));
  return (named.length ? named : people.filter((p) => p.isPrimary)).map((p) => p.name).join(" and ");
}

function OwnerChoice({ people, owners }: { people: Person[]; owners?: string[] }) {
  if (people.length < 2) return null;
  const checked = owners?.length ? owners : people.filter((p) => p.isPrimary).map((p) => p.id);
  return (
    <fieldset className="flex flex-wrap items-center gap-3">
      <legend className="float-left mr-2">Whose events</legend>
      {people.map((p) => (
        <label key={p.id} className="flex items-center gap-1">
          <input type="checkbox" name="owner" value={p.id} defaultChecked={checked.includes(p.id)} />
          {p.name}
        </label>
      ))}
    </fieldset>
  );
}

// Just the primary person is saved as none, so events keep their hash and a
// save doesn't rewrite every event at the next sync.
function chosenOwners(f: FormData, people: Person[]) {
  const ids = f.getAll("owner").map(String);
  const primary = people.find((p) => p.isPrimary)?.id;
  return ids.length === 1 && ids[0] === primary ? [] : ids;
}

const RULES_HELP = "Rules (one per line: words in the title = category, attendance or person)";

// A source's default category and owners, and its title rules (ACT-1,
// owner 2026-09-28). Synced events pick up a change at the next sync.
function MappingForm({ s, people, onSaved }: { s: Source; people: Person[]; onSaved: () => void }) {
  const [error, setError] = useState<string | null>(null);
  const m = s.categoryMapping;
  return (
    <form
      aria-label="Categories and owners"
      className="mt-2 flex flex-col gap-2 rounded border border-dashed p-2"
      onSubmit={async (ev) => {
        ev.preventDefault();
        const f = new FormData(ev.currentTarget);
        const { rules, errors } = textToRules(String(f.get("rules") ?? ""), people);
        if (errors.length) return setError(errors.join(" "));
        if (people.length > 1 && f.getAll("owner").length === 0)
          return setError("Pick whose events these are.");
        const owners = chosenOwners(f, people);
        const res = await fetch(`/api/v1/sources/${s.id}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ categoryMapping: { default: f.get("category"), owners, rules } }),
        });
        if (!res.ok) return setError((await res.json().catch(() => ({}))).error ?? "Couldn't save.");
        setError(null);
        onSaved();
      }}
    >
      <label className="flex flex-col">
        Default category
        <select name="category" defaultValue={m.default} className="rounded border px-2 py-1">
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {label(c)}
            </option>
          ))}
        </select>
      </label>
      <OwnerChoice people={people} owners={m.owners} />
      <label className="flex flex-col">
        {RULES_HELP}
        <textarea
          name="rules"
          rows={4}
          className="rounded border px-2 py-1 font-mono text-xs"
          defaultValue={rulesToText(m.rules, people)}
        />
      </label>
      <p className="text-neutral-600 dark:text-neutral-400">
        Changes reach the calendar at this source&apos;s next sync. Events you changed by hand keep your
        choice.
      </p>
      {error && <p className="text-red-700 dark:text-red-400">{error}</p>}
      <button className="self-start rounded border px-2 py-1">Save</button>
    </form>
  );
}

// Tournament entries (TEN-9): where home is, how far he'll travel and which
// events are his. The Thursday job needs the postal code; the rest have
// defaults.
function EntryForm({ s, onSaved }: { s: Source; onSaved: () => void }) {
  const e = s.config?.entry ?? {};
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      aria-label="Tournament entry settings"
      className="mt-2 flex flex-col gap-2 rounded border border-dashed p-2"
      onSubmit={async (ev) => {
        ev.preventDefault();
        const f = new FormData(ev.currentTarget);
        const entry = {
          homePostalCode: String(f.get("homePostalCode") ?? "").trim() || undefined,
          maxDriveMinutes: Number(f.get("maxDriveMinutes")) || undefined,
          include: String(f.get("include") ?? "").trim() || undefined,
          prefer: String(f.get("prefer") ?? "").trim(),
          exclude: String(f.get("exclude") ?? "").trim(),
          autoEnter: f.get("autoEnter") === "on",
        };
        const res = await fetch(`/api/v1/sources/${s.id}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ config: { entry } }),
        });
        if (!res.ok) return setError((await res.json().catch(() => ({}))).error ?? "Couldn't save.");
        setError(null);
        onSaved();
      }}
    >
      <p className="text-neutral-600 dark:text-neutral-400">
        Thursdays at noon the app looks for U10 tournaments open for entry near home and picks his event;
        Fridays at 10:00 it reads the acceptance lists; on draw days it checks for his draw every hour.
      </p>
      <label className="flex items-start gap-2">
        <input name="autoEnter" type="checkbox" defaultChecked={e.autoEnter !== false} className="mt-1" />
        <span>
          Enter him on the site automatically, with the Tennis Canada login on the Accounts page. Entries
          where the site asks for payment show as &quot;Payment required&quot; on the Tennis page for you to
          pay.
        </span>
      </label>
      <label className="flex flex-col">
        Home postal code
        <input
          name="homePostalCode"
          required
          defaultValue={e.homePostalCode ?? ""}
          autoComplete="postal-code"
          className="rounded border px-2 py-1"
          placeholder="A1A 1A1"
        />
      </label>
      <label className="flex flex-col">
        Longest drive (minutes)
        <input
          name="maxDriveMinutes"
          type="number"
          min={15}
          max={600}
          defaultValue={e.maxDriveMinutes ?? 120}
          className="rounded border px-2 py-1"
        />
      </label>
      <label className="flex flex-col">
        Event name has one of (comma-separated)
        <input name="include" defaultValue={e.include ?? "orange"} className="rounded border px-2 py-1" />
      </label>
      <label className="flex flex-col">
        If several fit, prefer
        <input name="prefer" defaultValue={e.prefer ?? "u9"} className="rounded border px-2 py-1" />
      </label>
      <label className="flex flex-col">
        Never events with
        <input
          name="exclude"
          defaultValue={e.exclude ?? "girl, women, double"}
          className="rounded border px-2 py-1"
        />
      </label>
      {error && <p className="text-red-700 dark:text-red-400">{error}</p>}
      <button className="self-start rounded border px-2 py-1">Save</button>
    </form>
  );
}

function AddSource({
  creds,
  people,
  onAdded,
}: {
  creds: Credential[];
  people: Person[];
  onAdded: () => void;
}) {
  const [kind, setKind] = useState<Kind>("ical");
  const [credentialId, setCredentialId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const usable = creds.filter((c) =>
    kind === "gmail"
      ? c.provider === "google" && !!c.scopes?.includes(GMAIL_SCOPE)
      : kind === "google_calendar"
        ? c.provider === "google"
        : kind === "commit_swim" || kind === "veracross"
          ? c.provider === kind && c.kind === "password"
          : c.kind === "secret_url",
  );
  const cred = usable.find((c) => c.id === credentialId) ?? usable[0];
  const calendars = cred?.meta?.calendars ?? [];

  return (
    <form
      className="flex flex-col gap-2 rounded-lg border border-dashed p-3 text-sm"
      aria-labelledby="add-source"
      onSubmit={async (e) => {
        e.preventDefault();
        // Keep the form: React clears currentTarget once the handler awaits.
        const form = e.currentTarget;
        const f = new FormData(form);
        const { rules, errors } = textToRules(String(f.get("rules") ?? ""), people);
        if (errors.length) return setError(errors.join(" "));
        const owners = chosenOwners(f, people);
        const res = await fetch("/api/v1/sources", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            kind,
            name: f.get("name"),
            credentialId: NO_ACCOUNT.includes(kind) ? undefined : cred?.id,
            config:
              kind === "google_calendar"
                ? { calendarId: f.get("calendarId") }
                : kind === "tennis_tc"
                  ? { profileUrl: f.get("profileUrl") }
                  : kind === "school_dates"
                    ? { pageUrl: f.get("pageUrl"), exclude: f.get("exclude") || undefined }
                    : kind === "veracross"
                      ? {
                          portalUrl: f.get("portalUrl"),
                          studentFirstName: f.get("studentFirstName") || undefined,
                        }
                      : kind === "gmail"
                        ? { senders: splitList(f.get("senders")), labels: splitList(f.get("labels")) }
                        : {},
            categoryMapping: { default: f.get("category"), owners, rules },
          }),
        });
        if (!res.ok)
          return setError((await res.json().catch(() => ({}))).error ?? "Couldn't add the source.");
        setError(null);
        form.reset();
        onAdded();
      }}
    >
      <h2 id="add-source" className="text-base font-semibold">
        Add a source
      </h2>
      <label className="flex flex-col">
        Type
        <select
          value={kind}
          onChange={(e) => setKind(e.target.value as typeof kind)}
          className="rounded border px-2 py-1"
        >
          <option value="ical">Calendar feed (TeamSnap, Spordle, other iCal link)</option>
          <option value="google_calendar">Google Calendar</option>
          <option value="commit_swim">Commit Swimming (meets and results)</option>
          <option value="tennis_tc">Tennis Canada (draws, matches and results)</option>
          <option value="school_dates">School key dates (public web page)</option>
          <option value="veracross">Veracross (daily schedule)</option>
          <option value="gmail">Coach and club emails (Gmail, suggestions to approve)</option>
        </select>
      </label>
      <label className="flex flex-col">
        Name
        <input name="name" required className="rounded border px-2 py-1" placeholder="e.g. Soccer team" />
      </label>
      {kind === "school_dates" ? (
        <>
          <label className="flex flex-col">
            Link of the school&apos;s key dates page
            <input
              name="pageUrl"
              type="url"
              required
              className="rounded border px-2 py-1"
              placeholder="https://…/calendar"
            />
          </label>
          <label className="flex flex-col">
            Leave out items containing (comma-separated)
            <input name="exclude" className="rounded border px-2 py-1" placeholder="e.g. Sr. School Only" />
          </label>
        </>
      ) : kind === "tennis_tc" ? (
        <label className="flex flex-col">
          His profile link on tc.tournamentsoftware.com
          <input
            name="profileUrl"
            type="url"
            required
            className="rounded border px-2 py-1"
            placeholder="https://tc.tournamentsoftware.com/player-profile/…"
          />
        </label>
      ) : usable.length === 0 ? (
        <p>
          First add {ACCOUNT_NOUN[kind][0]} on the{" "}
          <a className="underline" href="/settings/accounts">
            Accounts page
          </a>
          .
        </p>
      ) : (
        <label className="flex flex-col">
          {ACCOUNT_NOUN[kind][1]}
          <select
            value={cred?.id}
            onChange={(e) => setCredentialId(e.target.value)}
            className="rounded border px-2 py-1"
          >
            {usable.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
        </label>
      )}
      {kind === "gmail" && (
        <>
          <label className="flex flex-col">
            Senders to read (one per line; *@club.ca for a whole club)
            <textarea
              name="senders"
              rows={3}
              className="rounded border px-2 py-1 font-mono text-xs"
              placeholder={"*@teamsnap.com\ncoach@club.ca"}
            />
          </label>
          <label className="flex flex-col">
            Gmail labels to read (comma-separated)
            <input name="labels" className="rounded border px-2 py-1" placeholder="e.g. Jayden" />
          </label>
          <p className="text-neutral-600 dark:text-neutral-400">
            Only these emails are read. Each becomes suggestions you approve or reject; nothing is added to
            the calendar by itself.
          </p>
        </>
      )}
      {kind === "veracross" && (
        <>
          <label className="flex flex-col">
            Parent portal link
            <input
              name="portalUrl"
              type="url"
              required
              className="rounded border px-2 py-1"
              placeholder="https://portals.veracross.com/…/parent"
            />
          </label>
          <label className="flex flex-col">
            Student&apos;s first name (if the login has more than one child)
            <input name="studentFirstName" className="rounded border px-2 py-1" />
          </label>
        </>
      )}
      {kind === "google_calendar" && cred && (
        <label className="flex flex-col">
          Calendar
          <select name="calendarId" required className="rounded border px-2 py-1">
            {calendars.map((c) => (
              <option key={c.id} value={c.id}>
                {c.summary}
                {c.primary ? " (primary)" : ""}
              </option>
            ))}
          </select>
        </label>
      )}
      <label className="flex flex-col">
        Default category
        <select
          key={kind}
          name="category"
          defaultValue={DEFAULT_CATEGORY[kind]}
          className="rounded border px-2 py-1"
        >
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {label(c)}
            </option>
          ))}
        </select>
      </label>
      <OwnerChoice key={`owners-${kind}`} people={people} />
      <label className="flex flex-col">
        {RULES_HELP}
        <textarea
          key={kind}
          name="rules"
          rows={4}
          className="rounded border px-2 py-1 font-mono text-xs"
          defaultValue={
            kind === "google_calendar"
              ? rulesToText(HOUSEHOLD_RULES)
              : kind === "school_dates"
                ? rulesToText(SCHOOL_DATE_RULES)
                : ""
          }
        />
      </label>
      {error && <p className="text-red-700 dark:text-red-400">{error}</p>}
      <button
        type="submit"
        className="self-start rounded bg-blue-700 px-3 py-1 text-white"
        disabled={usable.length === 0 && !NO_ACCOUNT.includes(kind)}
      >
        Add source
      </button>
    </form>
  );
}
