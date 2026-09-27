import { createDb, createPool, type Db, type PoolHandle } from "../server/db/client";
import { log } from "../server/log";
import { helpText, jobs, parseCommand } from "./jobs";

async function main() {
  const command = parseCommand(process.argv.slice(2));
  if (command.kind === "help") {
    console.log(`Usage: worker <job> [args]\n\nJobs:\n${helpText()}`);
    return;
  }
  if (command.kind === "error") {
    log(command.message, {}, "ERROR");
    process.exitCode = 2;
    return;
  }
  let pool: PoolHandle | undefined;
  let db: Db | undefined;
  const started = Date.now();
  log("job started", { job: command.name });
  try {
    await jobs[command.name].run(command.args, {
      log,
      db: async () => {
        pool ??= await createPool();
        db ??= createDb(pool.pool);
        return db;
      },
    });
    log("job finished", { job: command.name, ms: Date.now() - started });
  } finally {
    await pool?.close();
  }
}

main()
  .catch((err: unknown) => {
    log("job failed", { job: process.argv[2], error: err }, "ERROR");
    process.exitCode = 1;
  })
  // A Cloud Run job only finishes when the process exits. Exit explicitly so
  // a forgotten timer or open handle in any library can't keep a finished
  // job running until its timeout.
  .finally(() => process.exit());
