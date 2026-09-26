// Worker job registry. Cloud Run jobs run the same image with the job name
// as the argument, e.g. `node worker.js migrate` (plan M0.7).
import { runMigrations } from "../server/db/migrate";

export type JobContext = { log: (msg: string, fields?: Record<string, unknown>) => void };
export type Job = { description: string; run: (args: string[], ctx: JobContext) => Promise<void> };

export const jobs: Record<string, Job> = {
  migrate: {
    description: "Apply pending database migrations",
    run: async (_args, ctx) => {
      await runMigrations();
      ctx.log("migrations applied");
    },
  },
  noop: {
    description: "Do nothing; used to check the worker image starts",
    run: async (_args, ctx) => ctx.log("noop"),
  },
};

export type ParsedCommand =
  { kind: "run"; name: string; args: string[] } | { kind: "help" } | { kind: "error"; message: string };

export function parseCommand(argv: string[]): ParsedCommand {
  const [name, ...args] = argv;
  if (!name || name === "help" || name === "--help") return { kind: "help" };
  if (!Object.hasOwn(jobs, name)) return { kind: "error", message: `Unknown job: ${name}` };
  return { kind: "run", name, args };
}

export function helpText(): string {
  return Object.entries(jobs)
    .map(([name, job]) => `  ${name.padEnd(12)} ${job.description}`)
    .join("\n");
}
