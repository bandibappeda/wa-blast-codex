import { defineConfig, devices } from "@playwright/test";
import { resolve } from "node:path";

const baseURL = process.env.E2E_BASE_URL ?? "http://127.0.0.1:4173";
const apiPort = process.env.E2E_API_PORT ?? "3100";
const databasePath = process.env.E2E_DATABASE_PATH ?? resolve(process.cwd(), "var/e2e/wa-blast.db");
const uploadsPath = process.env.E2E_UPLOADS_PATH ?? resolve(process.cwd(), "var/e2e/uploads");
const gatewayKey = process.env.GATEWAY_ENCRYPTION_KEY ?? Buffer.from(new Uint8Array(32)).toString("base64url");
const e2eEnv = {
  ...process.env,
  APP_ENV: "test",
  APP_ORIGIN: baseURL,
  API_HOST: "127.0.0.1",
  API_PORT: apiPort,
  DATABASE_PATH: databasePath,
  UPLOADS_PATH: uploadsPath,
  GATEWAY_ENCRYPTION_KEY: gatewayKey,
  SESSION_COOKIE_SECURE: "false",
} as Record<string, string>;

export default defineConfig({
  testDir: "./e2e",
  timeout: 90_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: process.env.CI ? [["dot"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command: "bun scripts/e2e-api.ts",
      url: `http://127.0.0.1:${apiPort}/api/health`,
      timeout: 120_000,
      reuseExistingServer: false,
      env: e2eEnv,
    },
    {
      command: "bun --filter @wa-blast/web dev -- --host 127.0.0.1 --port 4173",
      url: baseURL,
      timeout: 120_000,
      reuseExistingServer: false,
      env: e2eEnv,
    },
  ],
});
