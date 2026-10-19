import { execFile } from 'child_process';
import fs from 'fs';
import path from 'path';
import { promisify } from 'util';
import { ProxyGet } from '../../src/datasources/proxy';
import { createLimiter } from '../../src/datasources/limiter';
import { withLists } from '../../src/api/score';
import { SpanGroupRule } from '../../src/api/catalogue';
import { Product } from '../../src/api/products';
import { AssessmentResult } from '../../src/api/types';
import { Inventory } from '../../src/inventory/types';
import { assessStack } from '../../src/assessment/stackAssessment';

const run = promisify(execFile);
const LOCAL_GRAFANA = 'http://localhost:13000';
const PLUGIN_RESOURCES = `${LOCAL_GRAFANA}/api/plugins/benburbage-semconvcompliance-app/resources`;
const OUTPUT_DIR = path.resolve(__dirname, '../evidence/cloud-raw');
const WINDOW_SECONDS = Number(process.env.VALIDATE_WINDOW_DAYS ?? 1) * 24 * 3600;
const GCX_MAX_BUFFER_BYTES = 256 * 1024 * 1024;
const COOKIE_JAR = process.env.LOCAL_GRAFANA_COOKIES ?? '';
const GCX_CONTEXT = process.env.GCX_CONTEXT ?? '';

const DATASOURCES = {
  metrics: [{ uid: 'grafanacloud-prom', type: 'prometheus', name: 'grafanacloud-prom' }],
  traces: [{ uid: 'grafanacloud-traces', type: 'tempo', name: 'grafanacloud-traces' }],
  logs: [{ uid: 'grafanacloud-logs', type: 'loki', name: 'grafanacloud-logs' }],
};

const cloudGet: ProxyGet = async <T>(
  uid: string,
  requestPath: string,
  params: Record<string, string>,
  headers: Record<string, string> = {}
) => {
  const query = new URLSearchParams(params).toString();
  const proxyPath = `/api/datasources/proxy/uid/${encodeURIComponent(uid)}${requestPath}${query ? `?${query}` : ''}`;
  const args = ['--context', GCX_CONTEXT, 'api', proxyPath, '-X', 'GET', '-o', 'json'];
  for (const [name, value] of Object.entries(headers)) {
    args.push('-H', `${name}: ${value}`);
  }
  try {
    const { stdout } = await run('gcx', args, { maxBuffer: GCX_MAX_BUFFER_BYTES });
    return JSON.parse(stdout) as T;
  } catch (error) {
    const failure = error as { stderr?: string; stdout?: string; code?: unknown };
    const output = [failure.stdout, failure.stderr, failure.code].filter(Boolean).join(' ').trim() || String(error);
    const status = /\b([45]\d\d)\b/.exec(output)?.[1];
    throw { status: status ? Number(status) : undefined, data: output.slice(0, 300) };
  }
};

const localSession = createLimiter(1);

async function curlLocal<T>(resource: string, body?: unknown): Promise<T> {
  const session = ['-s', '-f', '-b', COOKIE_JAR, '-c', COOKIE_JAR];
  const { stdout } = await localSession(async () => {
    await run('curl', [...session, '-X', 'POST', `${LOCAL_GRAFANA}/api/user/auth-tokens/rotate`]);
    return run('curl', [...session, ...bodyArgs(resource, body), `${PLUGIN_RESOURCES}/${resource}`], {
      maxBuffer: GCX_MAX_BUFFER_BYTES,
    });
  });
  return JSON.parse(stdout) as T;
}

function bodyArgs(resource: string, body: unknown): string[] {
  if (body === undefined) {
    return [];
  }
  const bodyFile = path.join(OUTPUT_DIR, `request-${resource.replace(/\//g, '-')}.json`);
  fs.writeFileSync(bodyFile, JSON.stringify(body));
  return ['-H', 'Content-Type: application/json', '--data-binary', `@${bodyFile}`];
}

const describeWhenEnabled = COOKIE_JAR && GCX_CONTEXT ? describe : describe.skip;

describeWhenEnabled('Grafana Cloud end to end (read-only)', () => {
  it(
    'collects through gcx GETs and scores on the local backend',
    async () => {
      fs.mkdirSync(OUTPUT_DIR, { recursive: true });
      const endSeconds = Math.floor(Date.now() / 1000);
      const window = { startSeconds: endSeconds - WINDOW_SECONDS, endSeconds };
      let inventory: Inventory | undefined;

      const assessment = await assessStack(
        DATASOURCES,
        window,
        {},
        {
          get: cloudGet,
          limit: createLimiter(8),
          spanGroupRules: () => curlLocal<SpanGroupRule[]>('catalogue/span-groups'),
          renamedAttributes: () => curlLocal<Record<string, string[]>>('catalogue/renamed-attributes'),
          products: () => curlLocal<Product[]>('products'),
          namesNeedingLabels: async (names) =>
            (await curlLocal<{ needs_labels: string[] }>('catalogue/metric-matches', { names })).needs_labels,
          score: async (collected, volumeWeighted) => {
            inventory = collected;
            return withLists(
              await curlLocal<AssessmentResult>('score', { inventory: collected, volume_weighted: volumeWeighted })
            );
          },
        }
      );

      fs.writeFileSync(path.join(OUTPUT_DIR, 'e2e-inventory.json'), JSON.stringify(inventory, null, 1));
      fs.writeFileSync(path.join(OUTPUT_DIR, 'e2e-assessment.json'), JSON.stringify(assessment, null, 1));
      expect(assessment.result.semconv_version).toBeTruthy();
    },
    30 * 60 * 1000
  );
});
