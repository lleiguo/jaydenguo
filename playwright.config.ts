import { defineConfig, devices } from "@playwright/test";
import { APP_URL, AUTH_SECRET, E2E_PORT, OWNER, PROJECTS, soleOwner } from "./tests/e2e/support/env";
import { FAKE_OIDC_PORT } from "./tests/e2e/support/fake-oidc-port";

// Cloud sessions ship a pre-installed Chromium; CI installs its own.
const executablePath = process.env.PW_CHROMIUM_PATH || undefined;

export default defineConfig({
  testDir: "tests/e2e",
  globalSetup: "./tests/e2e/support/global-setup.ts",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: process.env.CI ? "github" : "list",
  use: { baseURL: APP_URL, launchOptions: { executablePath } },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "phone", use: { ...devices["Pixel 7"] } },
  ],
  webServer: [
    {
      // Stands in for Google sign-in (see tests/e2e/support/fake-oidc.ts).
      command: "pnpm exec tsx tests/e2e/support/fake-oidc.ts",
      url: `http://127.0.0.1:${FAKE_OIDC_PORT}/.well-known/openid-configuration`,
      reuseExistingServer: !process.env.CI,
    },
    {
      command: `PORT=${E2E_PORT} HOSTNAME=127.0.0.1 node .next/standalone/server.js`,
      url: `${APP_URL}/api/healthz`,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
      env: {
        APP_URL,
        AUTH_SECRET,
        ALLOWED_EMAILS: [OWNER, ...PROJECTS.map(soleOwner)].join(","),
        GOOGLE_CLIENT_ID: "e2e-client",
        GOOGLE_CLIENT_SECRET: "e2e-client-secret",
        OIDC_ISSUER: `http://127.0.0.1:${FAKE_OIDC_PORT}`,
      },
    },
  ],
});
