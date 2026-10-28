"use client";

import { useState } from "react";

// Home's address (intent 0027, TRF-R2): where "Time to leave" starts from
// when a phone hasn't shared its place. Empty clears it.
export function HomeAddressSetting({ initial }: { initial: string | null }) {
  const [value, setValue] = useState(initial ?? "");
  const [saved, setSaved] = useState<string | null>(null);
  return (
    <form
      className="flex flex-wrap items-end gap-2"
      onSubmit={async (e) => {
        e.preventDefault();
        const res = await fetch("/api/v1/settings", {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ homeAddress: value }),
        });
        setSaved(res.ok ? "Saved." : "Couldn't save that address.");
      }}
    >
      <label className="flex min-w-64 flex-1 flex-col">
        Home address, for Time to leave
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          maxLength={300}
          autoComplete="street-address"
          className="rounded border px-2 py-1"
        />
      </label>
      <button className="rounded border px-3 py-1" type="submit">
        Save
      </button>
      <span aria-live="polite">{saved}</span>
    </form>
  );
}
