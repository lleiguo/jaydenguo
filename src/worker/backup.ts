import type { JobContext } from "./context";

// Nightly database export (plan M1.13, spec NFR-3): Cloud SQL writes a
// compressed SQL dump to the backup bucket, whose retention policy keeps
// every export for a year. This job starts the export and waits for it, so
// a failure fails the job and the owner is emailed (infra/alerts.tf).

export type Fetcher = (
  url: string,
  init?: { method?: string; body?: string },
) => Promise<{ status: number; json: () => Promise<unknown> }>;

type Operation = {
  name: string;
  status: "PENDING" | "RUNNING" | "DONE";
  error?: { errors?: { message?: string }[] };
};

const API = "https://sqladmin.googleapis.com/v1";

export function exportRequest(connectionName: string, database: string, bucket: string, now: Date) {
  const [project, , instance] = connectionName.split(":");
  if (!project || !instance)
    throw new Error("INSTANCE_CONNECTION_NAME must look like project:region:instance");
  const stamp = now.toISOString().replace(/[-:]/g, "").slice(0, 13); // YYYYMMDDTHHMM
  const uri = `gs://${bucket}/sql/${database}-${stamp}.sql.gz`;
  return {
    url: `${API}/projects/${project}/instances/${instance}/export`,
    body: { exportContext: { kind: "sql#exportContext", fileType: "SQL", uri, databases: [database] } },
    operationsUrl: (name: string) => `${API}/projects/${project}/operations/${name}`,
    uri,
  };
}

async function googleFetcher(): Promise<Fetcher> {
  const { GoogleAuth } = await import("google-auth-library");
  const client = await new GoogleAuth({
    scopes: ["https://www.googleapis.com/auth/cloud-platform"],
  }).getClient();
  return async (url, init) => {
    const res = await client.request({
      url,
      method: (init?.method ?? "GET") as "GET" | "POST",
      data: init?.body ? JSON.parse(init.body) : undefined,
      validateStatus: () => true,
    });
    return { status: res.status, json: async () => res.data };
  };
}

export async function runBackup(
  ctx: Pick<JobContext, "log">,
  opts: { fetch?: Fetcher; now?: Date; pollMs?: number; timeoutMs?: number } = {},
) {
  const bucket = process.env.BACKUP_BUCKET;
  const connection = process.env.INSTANCE_CONNECTION_NAME;
  const database = process.env.DB_NAME ?? "hub";
  if (!bucket || !connection) throw new Error("BACKUP_BUCKET and INSTANCE_CONNECTION_NAME must be set");
  const fetcher = opts.fetch ?? (await googleFetcher());
  const req = exportRequest(connection, database, bucket, opts.now ?? new Date());

  const started = await fetcher(req.url, { method: "POST", body: JSON.stringify(req.body) });
  let op = (await started.json()) as Operation;
  if (started.status >= 300) throw new Error(`export request refused (${started.status})`);
  ctx.log("backup started", { uri: req.uri, operation: op.name });

  const deadline = Date.now() + (opts.timeoutMs ?? 25 * 60_000);
  while (op.status !== "DONE") {
    if (Date.now() > deadline) throw new Error("backup export timed out");
    await new Promise((r) => setTimeout(r, opts.pollMs ?? 10_000));
    op = (await (await fetcher(req.operationsUrl(op.name))).json()) as Operation;
  }
  if (op.error) throw new Error(`backup export failed: ${op.error.errors?.map((e) => e.message).join("; ")}`);
  ctx.log("backup finished", { uri: req.uri });
  return req.uri;
}

export async function backupJob(_args: string[], ctx: JobContext) {
  await runBackup(ctx);
}
