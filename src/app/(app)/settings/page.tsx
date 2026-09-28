import { listSessions } from "@/server/auth/session";
import { requirePageSession } from "@/server/auth/current";
import { getDb } from "@/server/db";
import { SignOutEverywhere } from "@/components/sign-out-everywhere";
import { TimeZoneSetting } from "@/components/time-zone-setting";
import { CalendarCopySetting } from "@/components/calendar-copy-setting";
import { getHomeTimeZone } from "@/server/settings";

export default async function SettingsPage() {
  const session = await requirePageSession();
  const db = await getDb();
  const devices = await listSessions(db, session);
  const homeTimeZone = await getHomeTimeZone(db);
  return (
    <main className="flex flex-col gap-6">
      <section aria-labelledby="general" className="flex flex-col gap-3">
        <h2 id="general" className="font-semibold">
          General
        </h2>
        <TimeZoneSetting initial={homeTimeZone} />
      </section>
      <section aria-labelledby="calendar-copy" className="flex flex-col gap-3">
        <h2 id="calendar-copy" className="font-semibold">
          Copy to Google Calendar
        </h2>
        <CalendarCopySetting />
      </section>
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
