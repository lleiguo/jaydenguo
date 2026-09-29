import os from "node:os";
import path from "node:path";
import { defineConfig, devices } from "@playwright/test";
import { APP_URL, AUTH_SECRET, E2E_PORT, OWNER, PROJECTS, soleOwner } from "./tests/e2e/support/env";
import { FAKE_COMMIT_PORT } from "./tests/e2e/support/fake-commit-port";
import { FAKE_OIDC_PORT } from "./tests/e2e/support/fake-oidc-port";
import { FAKE_TC_PORT } from "./tests/e2e/support/fake-tc-port";
import { FAKE_VERACROSS_PORT } from "./tests/e2e/support/fake-veracross-port";

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
      // Stands in for Commit Swimming (tests/e2e/support/fake-commit.ts).
      command: "pnpm exec tsx tests/e2e/support/fake-commit.ts",
      url: `http://127.0.0.1:${FAKE_COMMIT_PORT}/sign-in`,
      reuseExistingServer: !process.env.CI,
    },
    {
      // Stands in for the Tennis Canada tournament site (tests/e2e/support/fake-tc.ts).
      command: "pnpm exec tsx tests/e2e/support/fake-tc.ts",
      url: `http://127.0.0.1:${FAKE_TC_PORT}/player-profile/x`,
      reuseExistingServer: !process.env.CI,
    },
    {
      // Stands in for a Veracross parent portal that asks for a sign-in code
      // (tests/e2e/support/fake-veracross.ts).
      command: "pnpm exec tsx tests/e2e/support/fake-veracross.ts",
      url: `http://127.0.0.1:${FAKE_VERACROSS_PORT}/login`,
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
        GOOGLE_API_BASE: `http://127.0.0.1:${FAKE_OIDC_PORT}`,
        CLASSROOM_API_BASE: `http://127.0.0.1:${FAKE_OIDC_PORT}`,
        PHOTOS_PICKER_BASE: `http://127.0.0.1:${FAKE_OIDC_PORT}`,
        // Video reviews run with stand-in models, not Vertex AI.
        VIDEO_LLM: "fake",
        // Playback copies (intent 0003) go to a local folder, not a bucket.
        MEDIA_DIR: path.join(os.tmpdir(), "jaydenguo-e2e-media"),
        // Email suggestions likewise (plan M5.8).
        EMAIL_LLM: "fake",
        // Jobs the site starts run as local processes of the built worker.
        WORKER_COMMAND: `node ${path.resolve("dist/worker.mjs")}`,
        COMMIT_SWIM_BASE_URL: `http://127.0.0.1:${FAKE_COMMIT_PORT}`,
        TENNIS_TC_BASE_URL: `http://127.0.0.1:${FAKE_TC_PORT}`,
        VERACROSS_BASE_URL: `http://127.0.0.1:${FAKE_VERACROSS_PORT}`,
        // The fixture's "today", between his quarter final and semi final.
        TENNIS_TC_NOW: "2024-09-28T16:00:00Z",
        // The fake site needs no politeness gap between requests.
        FETCH_MIN_GAP_MS: "0",
      },
    },
  ],
});
