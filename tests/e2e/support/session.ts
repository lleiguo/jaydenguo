import type { BrowserContext } from "@playwright/test";
import pg from "pg";
import { newSessionToken, sessionIdFor, SESSION_COOKIE } from "../../../src/server/auth/tokens";
import { APP_URL, AUTH_SECRET } from "./env";

// Creates a session row directly, as a finished Google sign-in would, and
// puts its cookie in the browser. The e2e suite runs against the production
// build, which has no sign-in shortcut.
export async function signInAs(context: BrowserContext, email: string): Promise<string> {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  try {
    const { rows } = await pool.query<{ id: string }>(
      `insert into users (email) values ($1)
       on conflict (email) do update set email = excluded.email returning id`,
      [email],
    );
    const token = newSessionToken();
    await pool.query(
      `insert into sessions (id, user_id, expires_at, user_agent) values ($1, $2, now() + interval '1 day', 'e2e')`,
      [sessionIdFor(token, AUTH_SECRET), rows[0].id],
    );
    await context.addCookies([
      { name: SESSION_COOKIE, value: token, url: APP_URL, httpOnly: true, sameSite: "Lax" },
    ]);
    return token;
  } finally {
    await pool.end();
  }
}
