import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { chromium } from 'playwright';

const GRAFANA = process.env.GRAFANA_URL ?? 'http://localhost:13000';
const APP = `${GRAFANA}/a/iambenzo-semconvcompliance-app`;
const RUNS = Number(process.env.RUNS ?? 3);
const requestPath = process.argv[2];
const LARGE_STACK_SERVICES = 1001;
const SLOW_DATASOURCE_MS = 3000;

if (!requestPath) {
  console.error('usage: [LARGE_STACK=1] node dev/scripts/measure-render.mjs <gzipped score request>');
  console.error(
    'LARGE_STACK=1 makes Tempo report 1001 services and slows the other datasources, so Tempo answers first and the scan is large enough to skip partial scores'
  );
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
  if (process.env.LARGE_STACK) {
    await page.route(/\/api\/datasources\/proxy\/uid\/(?!tempo\/)/, async (route) => {
      await new Promise((resolve) => setTimeout(resolve, SLOW_DATASOURCE_MS));
      await route.continue();
    });
    await page.route('**/api/datasources/proxy/uid/tempo/**', (route) => {
      const services = route.request().url().includes('/tag/resource.service.name/values')
        ? Array.from({ length: LARGE_STACK_SERVICES }, (_, index) => ({ value: `svc-${index}` }))
        : [];
      return route.fulfill({ json: { tagValues: services, scopes: [], traces: [], series: [] } });
    });
  }
  let fullScoreCalls = 0;
  await page.route('**/resources/score', async (route) => {
    scoreCalls++;
    if (process.env.LARGE_STACK && !includesLargeStack(route.request().postDataBuffer())) {
      await route.continue();
      return;
    }
    fullScoreCalls++;
    await route.continue({ postData: scoreRequest });
  });
  const cdp = await context.newCDPSession(page);
  await cdp.send('Performance.enable');
  const started = Date.now();
  await page.goto(target.url);
  await page.getByTestId(target.ready).first().waitFor({ timeout: 120_000 });
  await page.waitForLoadState('networkidle', { timeout: 180_000 });
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
    fullScoreCalls,
  };
}

function includesLargeStack(body) {
  const { inventory } = JSON.parse(gunzipSync(body).toString());
  return inventory.traces.some((datasource) => datasource.services.length >= LARGE_STACK_SERVICES);
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
    ['renderMs', 'heapMb', 'longestTaskMs', 'longTasksMs', 'scoreCalls', 'fullScoreCalls'].map((key) => [
      key,
      Math.round(median(runs.map((entry) => entry[key]))),
    ])
  );
  console.log(target.name, JSON.stringify(summary));
}
await browser.close();
