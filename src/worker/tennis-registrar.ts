import { and, desc, eq } from "drizzle-orm";
import { credentials } from "@db/schema";
import { tennisBaseUrl } from "../adapters/tennis-tc";
import { TcLoginError, tcRegistrarClient } from "../adapters/tennis-tc/registrar";
import type { Db } from "../server/db/client";
import type { Logger } from "../server/log";
import { manualRegistrar, type Registrar } from "../server/tennis/entries";
import { openCredential } from "./credentials";

// The registrar the Thursday job uses (plan M3b.6): the site's entry form
// with the stored Tennis Canada login, unless the owner switched automatic
// entry off on the Tennis source or no login is stored.

type EntryConfig = { entry?: { autoEnter?: boolean } };

export async function tennisRegistrar(db: Db, source: { config: unknown }, log: Logger): Promise<Registrar> {
  if ((source.config as EntryConfig | null)?.entry?.autoEnter === false) return manualRegistrar;
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
  return {
    async enter(e) {
      if (loginProblem) return { result: "unavailable", note: loginProblem };
      try {
        if (!client) {
          const opened = await openCredential(db, cred.id, "tennis entry");
          if (!opened.username) {
            loginProblem = "Add the Tennis Canada username on the Accounts page.";
            return { result: "unavailable", note: loginProblem };
          }
          client = tcRegistrarClient(tennisBaseUrl(), opened.username, opened.secret);
        }
        const outcome = await client.enter({ tournamentId: e.tournamentId, eventName: e.eventName });
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
