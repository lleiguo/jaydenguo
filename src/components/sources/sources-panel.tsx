"use client";

import { useCallback, useEffect, useState } from "react";
import { CATEGORIES } from "@/domain/constants";
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
  categoryMapping: { default: string; rules?: { match: string; category?: string; attendance?: string }[] };
  lastSuccessAt: string | null;
  lastRun: Run | null;
  running: boolean;
  nextRefreshAt: string | null;
};
type EntrySettings = {
  homePostalCode?: string;
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
};

type Kind = "google_calendar" | "ical" | "commit_swim" | "tennis_tc" | "school_dates";
const KIND_LABEL: Record<Kind, string> = {
  google_calendar: "Google Calendar",
  ical: "Calendar feed",
  commit_swim: "Commit Swimming",
  tennis_tc: "Tennis Canada tournaments",
  school_dates: "School key dates",
};
// Kinds that read public pages and need no account.
const NO_ACCOUNT: Kind[] = ["tennis_tc", "school_dates"];
const ACCOUNT_NOUN: Record<Kind, [string, string]> = {
  google_calendar: ["a Google account", "Google account"],
  ical: ["a private calendar link", "Calendar link"],
  commit_swim: ["a Commit Swimming login", "Commit Swimming login"],
  tennis_tc: ["", ""],
  school_dates: ["", ""],
};
const DEFAULT_CATEGORY: Record<Kind, string> = {
  google_calendar: "other",
  ical: "soccer",
  commit_swim: "swimming",
  tennis_tc: "tennis",
  school_dates: "school_class",
};

const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : "never");
const label = (c: string) => c.replace("_", " ");

export function SourcesPanel() {
  const [sources, setSources] = useState<Source[] | null>(null);
  const [creds, setCreds] = useState<Credential[]>([]);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [s, c] = await Promise.all([fetch("/api/v1/sources"), fetch("/api/v1/credentials")]);
    if (s.ok) setSources((await s.json()).sources);
    if (c.ok) setCreds((await c.json()).credentials);
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

  async function refresh(url: string, what: string) {
    const res = await fetch(url, { method: "POST" });
    const body = await res.json().catch(() => ({}));
    if (res.ok) {
      setMessage(`Refreshing ${what}…`);
      setWatchUntil(Date.now() + 30_000);
    } else {
      setMessage(body.error ?? "Couldn't start the refresh.");
    }
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
          onClick={() => refresh("/api/v1/sources/refresh-all", "all sources")}
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
            onRefresh={() => refresh(`/api/v1/sources/${s.id}/refresh`, s.name)}
            onToggle={() => toggle(s)}
          />
        ))}
      </ul>

      <AddSource creds={creds} onAdded={load} />
    </div>
  );
}

function SourceCard({ s, onRefresh, onToggle }: { s: Source; onRefresh: () => void; onToggle: () => void }) {
  const [runs, setRuns] = useState<Run[] | null>(null);
  const [entryOpen, setEntryOpen] = useState(false);
  const failed = s.lastRun?.status === "failed";
  const status = s.running ? "Syncing…" : failed ? "Failed" : s.lastRun ? "OK" : "Not synced yet";
  const tooSoon = !!s.nextRefreshAt && new Date(s.nextRefreshAt) > new Date();
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
      </div>
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
          onClick={onRefresh}
          disabled={s.running || !s.enabled}
          title={tooSoon ? `Next refresh after ${fmt(s.nextRefreshAt)}` : undefined}
        >
          Refresh
        </button>
        <button className="rounded border px-2 py-1" onClick={onToggle}>
          {s.enabled ? "Switch off" : "Switch on"}
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
          aria-expanded={runs !== null}
          onClick={async () => {
            if (runs) return setRuns(null);
            const res = await fetch(`/api/v1/sources/${s.id}/runs`);
            setRuns(res.ok ? (await res.json()).runs : []);
          }}
        >
          History
        </button>
      </div>
      {entryOpen && <EntryForm s={s} onSaved={() => setEntryOpen(false)} />}
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
        Thursdays at noon the app looks for Rookie tournaments open for entry near home and picks his event;
        Fridays at 10:00 it reads the acceptance lists; on draw days it checks for his draw every hour.
      </p>
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
          defaultValue={e.exclude ?? "girl, women, double, mixed"}
          className="rounded border px-2 py-1"
        />
      </label>
      {error && <p className="text-red-700 dark:text-red-400">{error}</p>}
      <button className="self-start rounded border px-2 py-1">Save</button>
    </form>
  );
}

function AddSource({ creds, onAdded }: { creds: Credential[]; onAdded: () => void }) {
  const [kind, setKind] = useState<Kind>("ical");
  const [credentialId, setCredentialId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const usable = creds.filter((c) =>
    kind === "google_calendar"
      ? c.provider === "google"
      : kind === "commit_swim"
        ? c.provider === "commit_swim" && c.kind === "password"
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
        const { rules, errors } = textToRules(String(f.get("rules") ?? ""));
        if (errors.length) return setError(errors.join(" "));
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
                    : {},
            categoryMapping: { default: f.get("category"), rules },
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
      <label className="flex flex-col">
        Rules (one per line: words in the title = category or attendance)
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
