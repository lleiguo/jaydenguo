// Settings shared by the Playwright config and the tests.
export const E2E_PORT = Number(process.env.E2E_PORT ?? 3100);
export const APP_URL = `http://127.0.0.1:${E2E_PORT}`;
export const AUTH_SECRET = "e2e-auth-secret";
export const OWNER = "owner@example.test";
// Also allow-listed, one per Playwright project: for tests that revoke all of
// a user's sessions, so they can't sign out tests running in parallel.
export const PROJECTS = ["desktop", "phone"] as const;
export const soleOwner = (project: string) => `owner-${project}@example.test`;
export const INTRUDER = "intruder@example.test";
