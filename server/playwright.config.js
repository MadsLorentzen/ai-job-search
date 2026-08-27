import { defineConfig, devices } from '@playwright/test';
import os from 'node:os';
import path from 'node:path';

const PORT = 3211;
const PASSWORD = 'e2e-test-password';

export default defineConfig({
  testDir: './e2e',
  timeout: 90_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['list']] : [['list']],

  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure'
  },

  projects: [{
    name: 'chromium',
    use: {
      ...devices['Desktop Chrome'],
      // Honour a pre-installed browser when the environment provides one
      // (CI installs its own; some sandboxes ship a build that does not match
      // the version this Playwright release would download).
      ...(process.env.CHROMIUM_PATH ? { launchOptions: { executablePath: process.env.CHROMIUM_PATH } } : {})
    }
  }],

  // Each run gets a throwaway database, and AI_PROVIDER=none keeps the tests
  // offline and deterministic regardless of what is configured on the host.
  webServer: {
    command: 'node src/index.js',
    url: `http://127.0.0.1:${PORT}/api/health`,
    reuseExistingServer: false,
    timeout: 30_000,
    env: {
      PORT: String(PORT),
      APP_PASSWORD: PASSWORD,
      AI_PROVIDER: 'none',
      LOG_LEVEL: 'warn',
      DATABASE_FILE: path.join(os.tmpdir(), `jobsearch-e2e-${Date.now()}.db`)
    }
  }
});
