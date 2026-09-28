"use client";

import { useState } from "react";

// Home time zone (CAL-9): every time on the site is shown in it.
// `zones` comes from the server so the options hydrate identically; the
// browser's Intl zone list can differ from Node's.
export function TimeZoneSetting({ initial, zones }: { initial: string; zones: string[] }) {
  const [value, setValue] = useState(initial);
  const [saved, setSaved] = useState<string | null>(null);
  return (
    <form
      className="flex flex-wrap items-end gap-2"
      onSubmit={async (e) => {
        e.preventDefault();
        const res = await fetch("/api/v1/settings", {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ homeTimeZone: value }),
        });
        setSaved(res.ok ? "Saved." : "Couldn't save that time zone.");
      }}
    >
      <label className="flex flex-col">
        Home time zone
        <select value={value} onChange={(e) => setValue(e.target.value)} className="rounded border px-2 py-1">
          {zones.map((z) => (
            <option key={z}>{z}</option>
          ))}
        </select>
      </label>
      <button className="rounded border px-3 py-1" type="submit">
        Save
      </button>
      <span aria-live="polite">{saved}</span>
    </form>
  );
}
