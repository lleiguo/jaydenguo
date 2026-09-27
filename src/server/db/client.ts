import { Connector, AuthTypes, IpAddressTypes } from "@google-cloud/cloud-sql-connector";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "@db/schema";

export type PoolHandle = {
  pool: pg.Pool;
  // Ends the pool and anything keeping the process alive (the Cloud SQL
  // connector's certificate refresh timer). Worker jobs must call this or
  // their process never exits.
  close: () => Promise<void>;
};

// Local and CI use DATABASE_URL. On Cloud Run, INSTANCE_CONNECTION_NAME is set
// and the Cloud SQL connector signs in with the service account's IAM
// identity, so there is no database password anywhere (plan M0.6).
export async function createPool(): Promise<PoolHandle> {
  const instance = process.env.INSTANCE_CONNECTION_NAME;
  if (!instance) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL or INSTANCE_CONNECTION_NAME must be set");
    const pool = new pg.Pool({ connectionString: url, max: 5 });
    return { pool, close: () => pool.end() };
  }
  const connector = new Connector();
  const options = await connector.getOptions({
    instanceConnectionName: instance,
    ipType: IpAddressTypes.PUBLIC,
    authType: AuthTypes.IAM,
  });
  const pool = new pg.Pool({
    ...options,
    user: requireEnv("DB_IAM_USER"),
    database: requireEnv("DB_NAME"),
    max: 5,
  });
  return {
    pool,
    close: async () => {
      try {
        await pool.end();
      } finally {
        connector.close();
      }
    },
  };
}

export function createDb(pool: pg.Pool) {
  return drizzle(pool, { schema });
}

export type Db = ReturnType<typeof createDb>;
// A transaction handle; most helpers accept either.
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
export type DbOrTx = Db | Tx;

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} must be set`);
  return value;
}
