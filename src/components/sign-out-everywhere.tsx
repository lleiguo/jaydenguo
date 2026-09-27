"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function SignOutEverywhere() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  async function run() {
    if (!confirm("Sign out on every device, including this one?")) return;
    setBusy(true);
    await fetch("/api/v1/sessions/revoke-all", { method: "POST" });
    router.replace("/login");
  }
  return (
    <button className="rounded-md border border-red-700 px-4 py-2 text-red-700" onClick={run} disabled={busy}>
      Sign out everywhere
    </button>
  );
}
