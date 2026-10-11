"use client";

import { useEffect, useState } from "react";
import { call } from "@/components/calendar/api";
import { CATEGORIES } from "@/domain/constants";
import type { SuggestionView } from "@/server/email/suggestions";

const muted = "text-neutral-600 dark:text-neutral-400";
const field = "rounded border px-2 py-1 dark:bg-neutral-900";

const KIND_LABEL: Record<SuggestionView["kind"], string> = {
  new: "New event",
  change: "Change",
  cancel: "Cancelled",
};

const when = (iso: string, allDay: boolean) =>
  allDay
    ? new Date(iso).toLocaleDateString("en-CA", {
        timeZone: "UTC",
        weekday: "short",
        month: "short",
        day: "numeric",
      })
    : new Date(iso).toLocaleString("en-CA", {
        weekday: "short",
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });

// A field the model had to guess is marked (EML-2).
function Guess({ level }: { level: "high" | "medium" | "low" }) {
  if (level === "high") return null;
  return (
    <span
      className={`ml-1 rounded px-1 text-xs ${level === "low" ? "bg-amber-200 text-amber-950" : "bg-neutral-200 text-neutral-900"}`}
    >
      {level === "low" ? "guess" : "implied"}
    </span>
  );
}

// "Past": cleared because its day is over (intent 0011, TID-2).
const DECIDED_LABEL: Record<string, string> = {
  approved: "✓ Approved",
  rejected: "✗ Rejected",
  expired: "◷ Past",
};

export function SuggestionList() {
  const [items, setItems] = useState<SuggestionView[] | null>(null);
  const [decided, setDecided] = useState<SuggestionView[]>([]);
  const [message, setMessage] = useState<string | null>(null);

  // Bumped after each decision to load the lists again.
  const [version, setVersion] = useState(0);
  useEffect(() => {
    const load = async () => {
      const [p, d] = await Promise.all([
        fetch("/api/v1/suggestions").then((r) => r.json()),
        fetch("/api/v1/suggestions?status=decided").then((r) => r.json()),
      ]);
      setItems(p.suggestions);
      setDecided(d.suggestions);
    };
    void load();
  }, [version]);

  if (!items) return <p className={muted}>Loading…</p>;
  return (
    <div className="flex flex-col gap-4">
      <p aria-live="polite" className="min-h-5 text-sm">
        {message}
      </p>
      {items.length === 0 ? (
        <p className={muted}>
          Nothing to review. To read coach and club emails, add a &quot;Coach and club emails&quot; source on
          the{" "}
          <a href="/settings/sources" className="underline">
            Sources page
          </a>
          .
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {items.map((s) => (
            <SuggestionCard
              key={s.id}
              s={s}
              onDone={async (text) => {
                setMessage(text);
                setVersion((v) => v + 1);
              }}
            />
          ))}
        </ul>
      )}
      {decided.length > 0 && (
        <details>
          <summary className="cursor-pointer text-sm">Recently decided</summary>
          <ul className="mt-2 flex flex-col gap-1 text-sm">
            {decided.map((s) => (
              <li key={s.id}>
                {DECIDED_LABEL[s.status] ?? s.status}: {KIND_LABEL[s.kind]} “{s.extracted.title}” from{" "}
                {s.from}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function SuggestionCard({ s, onDone }: { s: SuggestionView; onDone: (message: string) => Promise<void> }) {
  const [error, setError] = useState<string | null>(null);
  const c = s.confidence;
  const e = s.extracted;
  return (
    <li
      data-testid="suggestion"
      className="flex flex-col gap-2 rounded-md border border-neutral-200 p-3 text-sm dark:border-neutral-800"
    >
      <div className="flex flex-wrap items-baseline gap-x-2">
        <span className="font-semibold">{KIND_LABEL[s.kind]}</span>
        {s.kind !== "new" && s.target && (
          <span>
            of “{s.target.title}”, {when(s.target.start, s.target.allDay)}
          </span>
        )}
        <Guess level={c.overall} />
      </div>
      {s.similar && (
        <p data-testid="similar" className="font-medium text-amber-700 dark:text-amber-400">
          Already on the calendar: “{s.similar.title}”, {when(s.similar.start, s.similar.allDay)}
        </p>
      )}
      <blockquote className="border-l-4 border-neutral-300 pl-2 italic dark:border-neutral-700">
        {s.quote}
      </blockquote>
      <p className={muted}>
        {s.sourceName} · from {s.from}: “{s.subject}” ·{" "}
        <a href={s.messageUrl} target="_blank" rel="noreferrer noopener" className="underline">
          open in Gmail
        </a>
      </p>
      <form
        className="flex flex-col gap-2"
        onSubmit={async (ev) => {
          ev.preventDefault();
          const f = new FormData(ev.currentTarget);
          try {
            await call(
              `/api/v1/suggestions/${s.id}/approve`,
              "POST",
              s.kind === "cancel"
                ? undefined
                : {
                    title: String(f.get("title")),
                    date: String(f.get("date")),
                    startTime: String(f.get("startTime") ?? "") || null,
                    endTime: String(f.get("endTime") ?? "") || null,
                    location: String(f.get("location") ?? "") || null,
                    category: String(f.get("category")),
                  },
            );
            await onDone(
              s.kind === "cancel"
                ? `Skipped “${s.target?.title}” on the calendar.`
                : s.kind === "change"
                  ? `Moved “${s.target?.title}”.`
                  : `Added “${f.get("title")}” to the calendar.`,
            );
          } catch (err) {
            setError((err as Error).message);
          }
        }}
      >
        {s.kind !== "cancel" && (
          <div className="flex flex-wrap gap-2">
            <label className="flex min-w-48 flex-1 flex-col">
              <span>
                Title
                <Guess level={c.title} />
              </span>
              <input name="title" defaultValue={e.title} required className={field} />
            </label>
            <label className="flex flex-col">
              <span>
                Date
                <Guess level={c.date} />
              </span>
              <input name="date" type="date" defaultValue={e.date ?? ""} required className={field} />
            </label>
            <label className="flex flex-col">
              <span>
                From
                <Guess level={c.time} />
              </span>
              <input name="startTime" type="time" defaultValue={e.startTime ?? ""} className={field} />
            </label>
            <label className="flex flex-col">
              To
              <input name="endTime" type="time" defaultValue={e.endTime ?? ""} className={field} />
            </label>
            {s.kind === "new" && (
              <>
                <label className="flex min-w-48 flex-1 flex-col">
                  <span>
                    Place
                    <Guess level={c.location} />
                  </span>
                  <input name="location" defaultValue={e.location ?? ""} className={field} />
                </label>
                <label className="flex flex-col">
                  Category
                  <select name="category" defaultValue={e.category} className={field}>
                    {CATEGORIES.map((cat) => (
                      <option key={cat} value={cat}>
                        {cat.replace("_", " ")}
                      </option>
                    ))}
                  </select>
                </label>
              </>
            )}
            {s.kind === "change" && <input type="hidden" name="category" value={e.category} />}
          </div>
        )}
        {s.kind === "new" && !e.startTime && (
          <p className={muted}>No time given: it will be an all-day event.</p>
        )}
        {error && (
          <p role="alert" className="text-red-700 dark:text-red-400">
            {error}
          </p>
        )}
        <div className="flex gap-2">
          <button type="submit" className="rounded bg-blue-700 px-3 py-1 text-white">
            {s.kind === "cancel"
              ? "Approve: skip it"
              : s.kind === "change"
                ? "Approve: move it"
                : "Approve: add it"}
          </button>
          <button
            type="button"
            className="rounded border px-3 py-1"
            onClick={async () => {
              try {
                await call(`/api/v1/suggestions/${s.id}/reject`);
                await onDone("Rejected.");
              } catch (err) {
                setError((err as Error).message);
              }
            }}
          >
            Reject
          </button>
        </div>
      </form>
    </li>
  );
}
