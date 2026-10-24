"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { Person } from "@/domain/people";

// People whose events the calendar holds (owner, 2026-09-28). The calendar
// shows a chip for each; the first is the person the site is about.
export function PeopleSetting({ initial }: { initial: (Person & { emails: string[] })[] }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const send = async (url: string, method: string, body?: unknown) => {
    setError(null);
    const res = await fetch(url, {
      method,
      headers: body ? { "content-type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      setError((await res.json().catch(() => ({}))).error ?? "Couldn't save.");
      return false;
    }
    router.refresh();
    return true;
  };
  return (
    <div className="flex flex-col gap-2 text-sm">
      <ul className="flex flex-col gap-2" data-testid="people">
        {initial.map((p) => (
          <li key={p.id} className="flex flex-col gap-1">
            <form
              className="flex flex-wrap items-center gap-2"
              aria-label={`Rename ${p.name}`}
              onSubmit={async (e) => {
                e.preventDefault();
                await send(`/api/v1/people/${p.id}`, "PATCH", {
                  name: new FormData(e.currentTarget).get("name"),
                });
              }}
            >
              <input
                name="name"
                required
                maxLength={40}
                defaultValue={p.name}
                aria-label="Name"
                className="rounded border px-2 py-1"
              />
              <button className="rounded border px-2 py-1" type="submit">
                Rename
              </button>
              {p.isPrimary ? (
                <span className="text-neutral-600 dark:text-neutral-400">
                  the site is about them; events with no owner are theirs
                </span>
              ) : (
                <button
                  type="button"
                  className="rounded border border-red-700 px-2 py-1 text-red-700 dark:text-red-400"
                  onClick={() => {
                    if (
                      confirm(`Remove ${p.name}? Events that were only theirs become ${initial[0]?.name}'s.`)
                    )
                      void send(`/api/v1/people/${p.id}`, "DELETE");
                  }}
                >
                  Remove
                </button>
              )}
            </form>
            <form
              className="flex flex-wrap items-center gap-2"
              aria-label={`${p.name}'s Google email`}
              onSubmit={async (e) => {
                e.preventDefault();
                const raw = String(new FormData(e.currentTarget).get("emails") ?? "");
                await send(`/api/v1/people/${p.id}/emails`, "POST", {
                  emails: raw.split(/[\s,]+/).filter(Boolean),
                });
              }}
            >
              <input
                name="emails"
                type="text"
                inputMode="email"
                autoComplete="off"
                defaultValue={p.emails.join(", ")}
                placeholder="Google email (optional)"
                aria-label="Google email"
                className="min-w-64 rounded border px-2 py-1"
              />
              <button className="rounded border px-2 py-1" type="submit">
                Save email
              </button>
            </form>
          </li>
        ))}
      </ul>
      <form
        className="flex flex-wrap items-center gap-2"
        aria-label="Add a person"
        onSubmit={async (e) => {
          e.preventDefault();
          const form = e.currentTarget;
          if (await send("/api/v1/people", "POST", { name: new FormData(form).get("name") })) form.reset();
        }}
      >
        <input
          name="name"
          required
          maxLength={40}
          placeholder="Name"
          aria-label="New person's name"
          className="rounded border px-2 py-1"
        />
        <button className="rounded border px-3 py-1" type="submit">
          Add person
        </button>
      </form>
      {error && (
        <p role="alert" className="text-red-700 dark:text-red-400">
          {error}
        </p>
      )}
    </div>
  );
}
