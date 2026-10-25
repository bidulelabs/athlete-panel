import { defineConfig, devices } from '@playwright/test';

// The server must already be built and running against isolated synthetic storage.
// Deliberately never start an application with inherited production configuration.
const baseURL = process.env.PLAYWRIGHT_BASE_URL;
if (!baseURL) throw new Error('Set PLAYWRIGHT_BASE_URL to an explicitly isolated synthetic server.');
if (!['localhost', '127.0.0.1', '[::1]'].includes(new URL(baseURL).hostname)) {
  throw new Error('Browser tests only run against a loopback synthetic instance.');
}

export default defineConfig({
  testDir: './tests/e2e',
  globalSetup: './tests/e2e/setup.ts',
  fullyParallel: false,
  workers: 1,
  timeout: 40_000,
  expect: { timeout: 8_000 },
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['html', { outputFolder: '.runtime/playwright-report', open: 'never' }]],
  outputDir: '.runtime/playwright-results',
  use: { baseURL, timezoneId: 'Europe/Paris', trace: 'retain-on-failure', screenshot: 'only-on-failure', video: 'off' },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 1000 } } },
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
  ],
});
