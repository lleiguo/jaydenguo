import { listSessions } from "@/server/auth/session";
import { requirePageSession } from "@/server/auth/current";
import { getDb } from "@/server/db";
import { SignOutEverywhere } from "@/components/sign-out-everywhere";

export default async function SettingsPage() {
  const session = await requirePageSession();
  const devices = await listSessions(await getDb(), session);
  return (
    <main className="flex flex-col gap-6">
      <h1 className="text-xl font-semibold">Settings</h1>
      <section aria-labelledby="account" className="flex flex-col gap-3">
        <h2 id="account" className="font-semibold">
          Account
        </h2>
        <p>Signed in as {session.email}</p>
        <h3 className="font-medium">Signed-in devices ({devices.length})</h3>
        <ul className="flex flex-col gap-1 text-sm">
          {devices.map((d, i) => (
            <li key={i}>
              {d.current ? "This device" : (d.userAgent ?? "Unknown device")} — signed in{" "}
              {d.createdAt.toISOString().slice(0, 10)}
            </li>
          ))}
        </ul>
        <div className="flex flex-wrap gap-3">
          <form action="/auth/signout" method="post">
            <button className="rounded-md border px-4 py-2" type="submit">
              Sign out
            </button>
          </form>
          <SignOutEverywhere />
        </div>
      </section>
    </main>
  );
}
