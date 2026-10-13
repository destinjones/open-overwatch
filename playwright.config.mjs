// End-to-end browser tests (e2e/*.spec.mjs): every page in headless Chromium against the local helper (serve.js), with
// the live feeds stubbed (e2e/support/net.mjs). `npm run e2e`; docs/TESTING.md has the rest. Not part of `node --test`.
import { defineConfig, devices } from '@playwright/test';
import { existsSync } from 'node:fs';
import { chromium } from '@playwright/test';

const PORT = +(process.env.OO_E2E_PORT || 8805);
const CI = !!process.env.CI;
// Playwright's own Chromium when it is installed (CI: `npx playwright install chromium`); otherwise the installed Edge,
// so a Windows checkout runs the suite without a browser download. OO_E2E_CHANNEL=chrome|msedge picks one.
const channel = process.env.OO_E2E_CHANNEL || (existsSync(chromium.executablePath()) ? undefined : 'msedge');
// Software WebGL (SwiftShader) by default: the same pixels on a laptop and on GitHub's GPU-less runner, so the picture
// checks can be tight. OO_E2E_GPU=1 uses the GPU instead (faster globe, but no picture checks).
const gl = process.env.OO_E2E_GPU ? ['--ignore-gpu-blocklist'] : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'];

export default defineConfig({
  testDir: 'e2e',
  testMatch: /.*\.spec\.mjs$/,
  outputDir: 'e2e/.results',
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: true,
  workers: process.env.OO_E2E_WORKERS ? +process.env.OO_E2E_WORKERS : CI ? 2 : 3,
  retries: CI ? 1 : 0,
  forbidOnly: CI,
  reporter: CI ? [['list'], ['html', { open: 'never', outputFolder: 'e2e/.report' }], ['github']] : [['list']],
  use: {
    baseURL: `http://localhost:${PORT}/`,
    channel,
    launchOptions: { args: [...gl, '--disable-features=PaintHolding'] },
    locale: 'en-US',
    timezoneId: 'UTC',
    colorScheme: 'dark',
    serviceWorkers: 'block',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'desktop', use: { viewport: { width: 1366, height: 820 } }, testIgnore: /phone\.spec/ },
    // a phone: Pixel 7 size, touch, mobile user agent (Chromium has no iPhone engine; brand/tools/webkit_journey.mjs is Safari)
    { name: 'phone', use: { ...devices['Pixel 7'] }, testMatch: /phone\.spec\.mjs$/ },
  ],
  webServer: {
    command: 'node serve.js',
    env: { OW_PORT: String(PORT), OW_NO_OPEN: '1' },
    url: `http://localhost:${PORT}/index.html`,
    reuseExistingServer: !CI,
    timeout: 30_000,
  },
});
