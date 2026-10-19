import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';

const GRAFANA = process.env.GRAFANA_URL ?? 'http://localhost:13000';
const APP = `${GRAFANA}/a/iambenzo-semconvcompliance-app`;
const RUNS = Number(process.env.RUNS ?? 3);
const requestPath = process.argv[2];

if (!requestPath) {
  console.error('usage: node dev/scripts/measure-render.mjs <gzipped score request>');
  console.error(
    'write one with: SCALE_SCORE_REQUEST_OUT=<path> go test ./pkg/assessment/ -run Test_WriteScoreRequestAtTheServiceLimit'
  );
  process.exit(1);
}

const scoreRequest = readFileSync(requestPath);
const pages = [
  { name: 'overview', url: `${APP}/overview?from=now-1h&to=now`, ready: 'data-testid overview-services' },
  {
    name: 'service',
    url: `${APP}/service?from=now-1h&to=now&service=svc-0&namespace=team-0`,
    ready: 'data-testid service-findings-table',
  },
];

async function signIn(context) {
  const page = await context.newPage();
  await page.goto(`${GRAFANA}/login`);
  await page.locator('input[name="user"]').fill('admin');
  await page.locator('input[name="password"]').fill('admin');
  const signedIn = page.waitForResponse(
    (response) => response.url().endsWith('/login') && response.request().method() === 'POST'
  );
  await page.locator('button[type="submit"]').click();
  if (!(await signedIn).ok()) {
    throw new Error('sign-in failed');
  }
  await page.close();
}

async function measure(browser, target) {
  const context = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
  await signIn(context);
  const page = await context.newPage();
  await page.addInitScript(() => {
    window.__longTasks = [];
    new PerformanceObserver((list) =>
      window.__longTasks.push(...list.getEntries().map((entry) => entry.duration))
    ).observe({
      type: 'longtask',
      buffered: true,
    });
  });
  let scoreCalls = 0;
  await page.route('**/resources/score', async (route) => {
    scoreCalls++;
    await route.continue({ postData: scoreRequest });
  });
  const cdp = await context.newCDPSession(page);
  await cdp.send('Performance.enable');
  const started = Date.now();
  await page.goto(target.url);
  await page.getByTestId(target.ready).first().waitFor({ timeout: 120_000 });
  await page.waitForLoadState('networkidle');
  const renderMs = Date.now() - started;
  const { metrics } = await cdp.send('Performance.getMetrics');
  const heapMb = metrics.find((metric) => metric.name === 'JSHeapUsedSize').value / 2 ** 20;
  const longTasks = await page.evaluate(() => window.__longTasks);
  await context.close();
  return {
    renderMs,
    heapMb,
    longestTaskMs: Math.max(0, ...longTasks),
    longTasksMs: longTasks.reduce((total, duration) => total + duration, 0),
    scoreCalls,
  };
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

const browser = await chromium.launch();
for (const target of pages) {
  const runs = [];
  for (let run = 0; run < RUNS; run++) {
    runs.push(await measure(browser, target));
  }
  const summary = Object.fromEntries(
    ['renderMs', 'heapMb', 'longestTaskMs', 'longTasksMs', 'scoreCalls'].map((key) => [
      key,
      Math.round(median(runs.map((entry) => entry[key]))),
    ])
  );
  console.log(target.name, JSON.stringify(summary));
}
await browser.close();
