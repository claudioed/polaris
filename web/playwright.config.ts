import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "tests/e2e",
  globalSetup: "tests/e2e/global-setup.ts",
  // One shared stack (postgres + API + edge) drives every test sequentially.
  workers: 1,
  fullyParallel: false,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
});
