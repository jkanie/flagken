import { defineConfig, devices } from '@playwright/test';

const port = Number(process.env.FLAGKEN_E2E_PORT ?? 3999);
// A pre-installed Chromium can be used instead of a downloaded one (set FLAGKEN_CHROMIUM to its path).
const executablePath = process.env.FLAGKEN_CHROMIUM || undefined;

export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/global-setup.ts',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    trace: 'retain-on-failure',
    launchOptions: executablePath ? { executablePath } : {},
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } } },
    // Phone width: every page is checked with axe and for sideways scrolling.
    {
      name: 'phone',
      use: { ...devices['Desktop Chrome'], viewport: { width: 390, height: 844 }, hasTouch: true },
      testMatch: /a11y\.spec\.ts/,
    },
  ],
});
