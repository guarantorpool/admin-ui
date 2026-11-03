import { defineConfig, devices } from '@playwright/test';

// The main flows, against the local backend on a throwaway database (scripts/local-stack.mjs), which the
// global setup starts and the teardown removes. Run with: npm run e2e
const apiPort = Number(process.env.STACK_API_PORT || 8080);

export default defineConfig({
  testDir: 'tests/e2e',
  globalSetup: './tests/e2e/global-setup.ts',
  // the flows share one backend and its email log, so they run one at a time
  workers: 1,
  fullyParallel: false,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:3001',
    trace: 'retain-on-failure',
    timezoneId: 'Europe/London'
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] }, grepInvert: /@phone/ },
    { name: 'phone', use: { ...devices['Pixel 7'] }, grep: /@phone|@shots/ }
  ],
  webServer: {
    // the production build, on 3001 because invitation and reset links point there
    command: 'npx vite build --mode e2e && npx vite preview --mode e2e --port 3001 --strictPort',
    url: 'http://localhost:3001',
    timeout: 180_000,
    reuseExistingServer: false,
    env: { VITE_API_BASE_URL: `http://localhost:${apiPort}/api`, VITE_APP_ENV: 'local', VITE_IDLE_LOCK_MINUTES: '5' }
  }
});
