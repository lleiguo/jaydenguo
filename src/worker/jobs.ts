// Worker job registry. Cloud Run jobs run the same image with the job name
// as the argument, e.g. `node worker.js migrate` (plan M0.7).
import { runMigrations } from "../server/db/migrate";
import { backupJob } from "./backup";
import type { JobContext } from "./context";
import { removeCredentialJob, rotateKeysJob, testCredentialJob } from "./credentials";
import { seedJob } from "./seed";
import { senderCheckJob } from "./sender-check";
import { smokeJob, syncJob } from "./sync";
import { tennisAcceptanceJob, tennisCheckJob, tennisDrawWatchJob, tennisEnterJob } from "./tennis-entries";
import { videoReviewJob } from "./video/review";
import { assistantActionsJob } from "./assistant-actions";
import { assistantEmailJob } from "./assistant-email";
import { calendarCopyJob } from "./calendar-copy";
import { costsSyncJob } from "./costs";
import { householdSyncJob } from "./household-sync";

export type { JobContext } from "./context";
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
  "credential:test": {
    description: "Test a stored login or link: credential:test <id>",
    run: testCredentialJob,
  },
  "credential:remove": {
    description: "Revoke and delete an OAuth credential: credential:remove <id>",
    run: removeCredentialJob,
  },
  sync: {
    description: "Sync sources: sync <source-id | all | household> [manual | scheduled]",
    run: syncJob,
  },
  "gmail:check": {
    description: "Which allowed email senders had no email lately: gmail:check <source-id>",
    run: senderCheckJob,
  },
  smoke: {
    description: "Live check of one source without saving: smoke <source-id>",
    run: smokeJob,
  },
  "tennis:enter": {
    description: "Find tournaments open for entry near home and enter him (Thursday)",
    run: tennisEnterJob,
  },
  "tennis:acceptance": {
    description: "Read acceptance lists: main draw or reserve (Friday)",
    run: tennisAcceptanceJob,
  },
  "tennis:check": {
    description: "Quick check of his entries, lists and draws (pull to refresh): tennis:check <check id>",
    run: tennisCheckJob,
  },
  "tennis:draw-watch": {
    description: "Look for his draws this week; sync once out (hourly on draw days)",
    run: tennisDrawWatchJob,
  },
  "video:review": {
    description: "Fetch a linked video and review it: video:review <id>",
    run: (args, ctx) => videoReviewJob(args, ctx),
  },
  "assistant:actions": {
    description: "Write what Cookie added to the household Google Calendar, and take back what was undone",
    run: assistantActionsJob,
  },
  "assistant:email": {
    description:
      "Find the email a parent asked Cookie about and write her summary: assistant:email <read-id>",
    run: assistantEmailJob,
  },
  "calendar:copy": {
    description: "Copy the calendar to the Jayden (hub) Google Calendar: calendar:copy [delete]",
    run: calendarCopyJob,
  },
  "household:sync": {
    description: "Write the hub's events into the household Google Calendar (intent 0020)",
    run: householdSyncJob,
  },
  "costs:sync": {
    description: "Read the last 35 days of the Cloud Billing export (daily)",
    run: costsSyncJob,
  },
  backup: {
    description: "Export the database to the backup bucket (nightly)",
    run: backupJob,
  },
  seed: {
    description: "Load a fake season for local development (refuses to run on Cloud Run)",
    run: seedJob,
  },
  "rotate-keys": {
    description: "Re-wrap every credential data key with the current KMS key version",
    run: (args, ctx) => rotateKeysJob(args, ctx),
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
    .map(([name, job]) => `  ${name.padEnd(18)} ${job.description}`)
    .join("\n");
}
