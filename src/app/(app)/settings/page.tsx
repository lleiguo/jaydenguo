import { listSessions } from "@/server/auth/session";
import { requirePageSession } from "@/server/auth/current";
import { getDb } from "@/server/db";
import { SignOutEverywhere } from "@/components/sign-out-everywhere";
import { TimeZoneSetting } from "@/components/time-zone-setting";
import { CalendarCopySetting } from "@/components/calendar-copy-setting";
import { HouseholdSyncSetting } from "@/components/household-sync-setting";
import { PeopleSetting } from "@/components/people-setting";
import { listPeople } from "@/server/people";
import { getHomeTimeZone } from "@/server/settings";

export default async function SettingsPage() {
  const session = await requirePageSession();
  const db = await getDb();
  const devices = await listSessions(db, session);
  const homeTimeZone = await getHomeTimeZone(db);
  const people = await listPeople(db);
  // Keep the saved zone selectable even if this runtime's list lacks it.
  const zones = Intl.supportedValuesOf("timeZone");
  if (!zones.includes(homeTimeZone)) zones.unshift(homeTimeZone);
  return (
    <main className="flex flex-col gap-6">
      <section aria-labelledby="general" className="flex flex-col gap-3">
        <h2 id="general" className="font-semibold">
          General
        </h2>
        <TimeZoneSetting initial={homeTimeZone} zones={zones} />
      </section>
      <section aria-labelledby="people" className="flex flex-col gap-3">
        <h2 id="people" className="font-semibold">
          People
        </h2>
        <p className="text-sm">
          Whose events are on the calendar. Each event belongs to one or more of them, and only the same
          person&apos;s events clash.
        </p>
        <PeopleSetting initial={people} />
      </section>
      <section aria-labelledby="household-sync" className="flex flex-col gap-3">
        <h2 id="household-sync" className="font-semibold">
          Household calendar, both ways
        </h2>
        <HouseholdSyncSetting />
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
              {d.current
                ? "This device"
                : d.kind === "device"
                  ? `iPhone app — ${d.deviceName ?? "unnamed phone"}`
                  : (d.userAgent ?? "Unknown device")}{" "}
              — signed in {d.createdAt.toISOString().slice(0, 10)}
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
