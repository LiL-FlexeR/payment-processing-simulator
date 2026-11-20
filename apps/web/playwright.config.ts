import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './test',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 45000,
  expect: { timeout: 10000 },
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:3000',
    viewport: { width: 1440, height: 1080 },
    trace: 'off',
    screenshot: 'only-on-failure',
  },
  webServer: [
    {
      command: 'node ../api/dist/main.js',
      url: 'http://127.0.0.1:3102/api/v1/health/ready',
      reuseExistingServer: false,
      timeout: 30000,
      env: { NODE_ENV: 'test' },
    },
    {
      command: 'npm run dev -- --webpack',
      url: 'http://localhost:3000',
      reuseExistingServer: false,
      timeout: 60000,
      env: { NODE_ENV: 'development' },
    },
  ],
});
