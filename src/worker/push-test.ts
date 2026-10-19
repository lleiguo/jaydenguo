import { eq } from "drizzle-orm";
import { users } from "@db/schema";
import { notify } from "../server/push/notify";
import type { JobContext } from "./context";

// One test notification (intent 0023, NTF-1): to every signed-in phone, or
// only that parent's with `push:test <email>`. Proves the APNs key works;
// the worker logs how many phones it reached.
export async function pushTestJob(args: string[], ctx: JobContext) {
  const db = await ctx.db();
  const email = args[0]?.trim().toLowerCase();
  let userId: string | undefined;
  if (email) {
    const [user] = await db.select({ id: users.id }).from(users).where(eq(users.email, email));
    if (!user) throw new Error("No such user");
    userId = user.id;
  }
  const now = new Date();
  const id = await notify(
    db,
    {
      kind: "sync_failed",
      dedupKey: `push_test:${now.toISOString().slice(0, 16)}:${userId ?? "all"}`,
      title: "Test notification",
      body: "Notifications from the hub reach this phone.",
      target: "settings/notifications",
    },
    { log: ctx.log, now, userId },
  );
  ctx.log("push test", { id });
}
