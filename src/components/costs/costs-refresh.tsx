"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { call } from "@/components/calendar/api";

// COST-5: read the billing export now instead of waiting for the daily run.
export function CostsRefresh({ configured }: { configured: boolean }) {
  const router = useRouter();
  const [message, setMessage] = useState<string | null>(null);
  if (!configured) return null;
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <button
        type="button"
        className="rounded border px-3 py-1"
        onClick={async () => {
          try {
            await call("/api/v1/costs/refresh");
            setMessage("Reading the bill. This takes a minute.");
            setTimeout(() => router.refresh(), 60_000);
          } catch (err) {
            setMessage((err as Error).message);
          }
        }}
      >
        ↻ Refresh
      </button>
      {message && <span role="status">{message}</span>}
    </div>
  );
}
