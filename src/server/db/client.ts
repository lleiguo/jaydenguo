import { Connector, AuthTypes, IpAddressTypes } from "@google-cloud/cloud-sql-connector";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "../../../db/schema";

// Local and CI use DATABASE_URL. On Cloud Run, INSTANCE_CONNECTION_NAME is set
// and the Cloud SQL connector signs in with the service account's IAM
// identity, so there is no database password anywhere (plan M0.6).
export async function createPool(): Promise<pg.Pool> {
  const instance = process.env.INSTANCE_CONNECTION_NAME;
  if (!instance) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL or INSTANCE_CONNECTION_NAME must be set");
    return new pg.Pool({ connectionString: url, max: 5 });
  }
  const connector = new Connector();
  const options = await connector.getOptions({
    instanceConnectionName: instance,
    ipType: IpAddressTypes.PUBLIC,
    authType: AuthTypes.IAM,
  });
  return new pg.Pool({
    ...options,
    user: requireEnv("DB_IAM_USER"),
    database: requireEnv("DB_NAME"),
    max: 5,
  });
}

export function createDb(pool: pg.Pool) {
  return drizzle(pool, { schema });
}

export type Db = ReturnType<typeof createDb>;

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} must be set`);
  return value;
}
