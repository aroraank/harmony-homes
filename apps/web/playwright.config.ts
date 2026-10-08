import { defineConfig, devices } from '@playwright/test';

// Happy path against a running app + Supabase project:
//   E2E_BASE_URL=http://localhost:5173 E2E_ADMIN_USER=admin E2E_ADMIN_PASSWORD=... npm run test:e2e
export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  retries: 0,
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:5173',
    ...devices['Pixel 7'],
    launchOptions: process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : undefined,
    trace: 'retain-on-failure',
  },
});
