import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'e2e',
  timeout: 90_000,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : undefined,
  use: {
    baseURL: 'http://localhost:4173/',
    viewport: { width: 1400, height: 850 },
    trace: 'off',
  },
  webServer: {
    command: `npx vite preview --port 4173 --strictPort --outDir ${process.env.E2E_DIST ?? 'dist'}`,
    url: 'http://localhost:4173/',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
