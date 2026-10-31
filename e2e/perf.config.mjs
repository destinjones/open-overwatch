// Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).
// The performance run (e2e/perf.spec.mjs), apart from the browser tests: `npx playwright test -c e2e/perf.config.mjs`.
// Meant for GitHub Actions (.github/workflows/perf.yml), never the owner's PC. One test per page and profile, measured
// one at a time (one worker: two software-WebGL pages at once would measure each other). Writes
// e2e/.results/perf/<page>-<profile>.json; e2e/perf-report.mjs turns those into the report and checks the budgets.
// OO_PERF_PAGES=globe,map picks pages; OO_PERF_IDLE_S / OO_PERF_LOOP_S shorten the 2-minute leak checks;
// OO_PERF_PROFILE=0 skips the CPU-profile pass.
import { defineConfig, devices } from '@playwright/test';

process.env.OO_PERF ||= '1';   // e2e/perf.spec.mjs skips itself without it (so the plain `npx playwright test` leaves it out)
const PORT = +(process.env.OO_E2E_PORT || 8805);
// Software WebGL (SwiftShader), as in the browser tests: GitHub's runners have no GPU. See docs/PERFORMANCE.md for how
// that skews the numbers (GPU-bound frames look far worse than on a phone's GPU; CPU-side jank shows up as it is).
const gl = process.env.OO_E2E_GPU ? ['--ignore-gpu-blocklist'] : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'];

export default defineConfig({
  testDir: '.',
  testMatch: /perf\.spec\.mjs$/,
  outputDir: '.results/perf-pw',
  timeout: 75 * 60_000,
  expect: { timeout: 15_000 },
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${PORT}/`,
    launchOptions: { args: [...gl, '--disable-features=PaintHolding'] },
    locale: 'en-US',
    timezoneId: 'UTC',
    colorScheme: 'dark',
    serviceWorkers: 'block',
    trace: 'off',
    screenshot: 'off',
  },
  projects: [
    { name: 'perf-desktop', use: { viewport: { width: 1366, height: 820 } } },
    // a Pixel-class phone: Pixel 7 screen, touch and user agent; the spec slows its CPU 4× (CDP), as a mid-range Android
    { name: 'perf-phone', use: { ...devices['Pixel 7'] } },
  ],
  webServer: {
    command: 'node serve.js',
    cwd: '..',
    env: { OW_PORT: String(PORT), OW_NO_OPEN: '1' },
    url: `http://localhost:${PORT}/index.html`,
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
