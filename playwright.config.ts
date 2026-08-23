import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  globalSetup: "./tests/e2e/global-setup.ts",
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? [["line"], ["html", { open: "never" }]] : "list",
  timeout: 30_000,
  expect: {
    timeout: 5_000,
  },
  use: {
    ...devices["Desktop Firefox"],
    headless: true,
    locale: "ru-RU",
    timezoneId: "Europe/Helsinki",
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "firefox",
      use: { browserName: "firefox" },
    },
  ],
  outputDir: "test-results/playwright",
});
