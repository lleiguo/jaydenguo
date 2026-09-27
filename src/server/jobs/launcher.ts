import { spawn } from "node:child_process";

// Starts worker jobs from the web app (plan M1.5): on Cloud Run, a new
// execution of the `worker` job with the job name and arguments as overrides;
// locally, a child process running the same worker program.
export interface JobLauncher {
  start(args: string[]): Promise<void>;
}

class CloudRunLauncher implements JobLauncher {
  constructor(private readonly jobName: string) {}

  async start(args: string[]) {
    const { JobsClient } = await import("@google-cloud/run");
    const client = new JobsClient();
    try {
      // Don't wait for the execution to finish; the job records its own
      // progress in the database.
      await client.runJob({ name: this.jobName, overrides: { containerOverrides: [{ args }] } });
    } finally {
      await client.close();
    }
  }
}

class LocalLauncher implements JobLauncher {
  constructor(private readonly command: string) {}

  async start(args: string[]) {
    const [bin, ...base] = this.command.split(" ").filter(Boolean);
    const child = spawn(bin, [...base, ...args], { stdio: "inherit", detached: true, env: process.env });
    child.unref();
  }
}

export function defaultLauncher(): JobLauncher {
  const job = process.env.WORKER_JOB;
  if (job) return new CloudRunLauncher(job);
  return new LocalLauncher(process.env.WORKER_COMMAND ?? "pnpm exec tsx src/worker/main.ts");
}
