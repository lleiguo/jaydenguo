import type { Db } from "../server/db/client";
import type { Logger } from "../server/log";

export type JobContext = {
  log: Logger;
  // Created on first use and closed by the worker when the job ends.
  db: () => Promise<Db>;
};
