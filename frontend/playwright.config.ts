import { defineConfig } from '@playwright/test';

// Browser tests of the real workflow. They start their own API on a throw-away database (backend `npm run e2e:server`,
// dropped on exit) and the Vite dev server in front of it, so nothing here touches the development data.
// They use the Chrome installed on the machine; set E2E_BROWSER=chromium to use Playwright's own download instead.
const API_PORT = 3101;
const WEB_PORT = 5201;
const chrome = process.env.E2E_BROWSER !== 'chromium';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${WEB_PORT}`,
    ...(chrome ? { channel: 'chrome' } : {}),
    trace: 'retain-on-failure',
  },
  webServer: [
    {
      command: 'npm run e2e:server',
      cwd: '../backend',
      url: `http://localhost:${API_PORT}/api/v1/health`,
      timeout: 180_000,
      reuseExistingServer: false,
      env: { E2E_API_PORT: String(API_PORT) },
    },
    {
      command: `npx vite --port ${WEB_PORT} --strictPort`,
      url: `http://localhost:${WEB_PORT}`,
      reuseExistingServer: false,
      env: { API_PROXY_TARGET: `http://localhost:${API_PORT}` },
    },
  ],
});
