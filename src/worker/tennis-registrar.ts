import { and, desc, eq } from "drizzle-orm";
import { credentials } from "@db/schema";
import { tennisBaseUrl } from "../adapters/tennis-tc";
import { TcLoginError, tcRegistrarClient } from "../adapters/tennis-tc/registrar";
import type { Db } from "../server/db/client";
import type { Logger } from "../server/log";
import { manualRegistrar, type Registrar } from "../server/tennis/entries";
import { openCredential } from "./credentials";

// The registrar the entry jobs use (plan M3b.6): the site's entry form
// with the stored Tennis Canada login, unless the owner switched automatic
// entry off on the Tennis source or no login is stored. With a login it
// also reads his account's "My entries" list.

type EntryConfig = { entry?: { autoEnter?: boolean } };

export async function tennisRegistrar(db: Db, source: { config: unknown }, log: Logger): Promise<Registrar> {
  const [cred] = await db
    .select({ id: credentials.id })
    .from(credentials)
    .where(
      and(
        eq(credentials.provider, "tennis_tc"),
        eq(credentials.kind, "password"),
        eq(credentials.status, "active"),
      ),
    )
    .orderBy(desc(credentials.updatedAt))
    .limit(1);
  if (!cred)
    return {
      enter: async () => ({
        result: "unavailable",
        note: "Add the Tennis Canada login on the Accounts page so the app can enter him.",
      }),
    };
  let client: ReturnType<typeof tcRegistrarClient> | null = null;
  let loginProblem: string | null = null;
  // The signed-in client, or null (with loginProblem set) when it can't be had.
  async function signedIn() {
    if (loginProblem) return null;
    if (!client) {
      const opened = await openCredential(db, cred.id, "tennis entry");
      if (!opened.username) {
        loginProblem = "Add the Tennis Canada username on the Accounts page.";
        return null;
      }
      client = tcRegistrarClient(tennisBaseUrl(), opened.username, opened.secret);
    }
    return client;
  }
  // Reading what he's entered is fine with automatic entry off. Null when
  // it can't be read.
  async function myEntries() {
    try {
      const c = await signedIn();
      return c ? await c.myEntries() : null;
    } catch (err) {
      if (!(err instanceof TcLoginError)) throw err;
      loginProblem = err.message;
      return null;
    }
  }
  if ((source.config as EntryConfig | null)?.entry?.autoEnter === false)
    return { ...manualRegistrar, myEntries };
  return {
    myEntries,
    async enter(e) {
      try {
        const c = await signedIn();
        if (!c) return { result: "unavailable", note: loginProblem! };
        const outcome = await c.enter({ tournamentId: e.tournamentId, eventName: e.eventName });
        log("tennis entry submitted", { tournament: e.tournamentId, result: outcome.result });
        return outcome;
      } catch (err) {
        if (err instanceof TcLoginError) {
          loginProblem = err.message;
          return { result: "unavailable", note: err.message };
        }
        throw err;
      }
    },
  };
}
