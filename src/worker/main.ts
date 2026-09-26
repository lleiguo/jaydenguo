import { helpText, jobs, parseCommand } from "./jobs";

// Structured one-line JSON logs, readable by Cloud Logging.
function log(message: string, fields: Record<string, unknown> = {}) {
  console.log(JSON.stringify({ severity: "INFO", message, ...fields }));
}

async function main() {
  const command = parseCommand(process.argv.slice(2));
  if (command.kind === "help") {
    console.log(`Usage: worker <job> [args]\n\nJobs:\n${helpText()}`);
    return;
  }
  if (command.kind === "error") {
    console.error(JSON.stringify({ severity: "ERROR", message: command.message }));
    process.exitCode = 2;
    return;
  }
  const started = Date.now();
  log("job started", { job: command.name });
  await jobs[command.name].run(command.args, { log });
  log("job finished", { job: command.name, ms: Date.now() - started });
}

main()
  .catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    console.error(JSON.stringify({ severity: "ERROR", message: "job failed", error: message }));
    process.exitCode = 1;
  })
  // A Cloud Run job only finishes when the process exits. Exit explicitly so
  // a forgotten timer or open handle in any library can't keep a finished
  // job running until its timeout.
  .finally(() => process.exit());
