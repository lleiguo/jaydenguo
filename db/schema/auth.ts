// Sign-in state (plan M1.1, spec AUTH-1..4, F-14 option A).
import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "./core";

// One row per `__session` cookie. The cookie holds a random token; the row id
// is an HMAC of it, so a database copy can't be replayed as a cookie.
// A row with no user is a pre-login session: it carries the OpenID Connect
// state, nonce and PKCE verifier between the redirect to Google and the
// callback, and is deleted when the callback uses it.
export const sessions = pgTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    userId: uuid("user_id").references(() => users.id),
    loginState: jsonb("login_state").$type<LoginState>(),
    userAgent: text("user_agent"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (t) => [
    index("sessions_user_idx").on(t.userId),
    check("sessions_kind_chk", sql`(${t.userId} is null) <> (${t.loginState} is null)`),
  ],
);

export type LoginState = { state: string; nonce: string; codeVerifier: string; returnTo: string };

// Fixed-window counters for login rate limiting (NFR-2).
export const rateLimits = pgTable(
  "rate_limits",
  {
    key: text("key").notNull(),
    windowStart: timestamp("window_start", { withTimezone: true }).notNull(),
    count: integer("count").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.key, t.windowStart] })],
);
