import { defineConfig, devices } from '@playwright/test';

/**
 * UI verification against the in-memory mock Supabase (scripts/mock-supabase), seeded by the
 * same synthetic generator. Runs anywhere — no cloud project needed — so every screen can be
 * exercised and axe-checked in the sandbox. Not a substitute for the cloud E2E suite in ./e2e.
 */
const API = 'http://localhost:54399';
export default defineConfig({
  testDir: './e2e-mock',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  workers: 1,
  reporter: [['list']],
  use: { baseURL: 'http://localhost:5174', trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: 'npx tsx ../../scripts/mock-supabase/server.ts --port 54399',
      url: `${API}/__health`,
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      command: 'npx vite --port 5174 --strictPort',
      url: 'http://localhost:5174',
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        VITE_SUPABASE_URL: API,
        VITE_SUPABASE_ANON_KEY: 'mock-anon-key-for-ui-tests-only',
        VITE_APP_ENV: 'development',
      },
    },
  ],
});
