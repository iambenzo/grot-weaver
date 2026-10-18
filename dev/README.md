# Dev stack: local LGTM for OTel semconv experiments

Backends (host ports chosen to avoid clashing with an existing otel-lgtm on 3000/4317/4318/9090):

| Service | Image | Host port | Notes |
|---|---|---|---|
| prometheus | prom/prometheus:v3.15.0 | 19090 | OTLP receiver, `UnderscoreEscapingWithSuffixes`; scrapes itself, node-exporter, otelcol:8888 |
| prometheus-alt | prom/prometheus:v3.15.0 | 19091 | OTLP receiver, `NoUTF8EscapingWithSuffixes`, `type-and-unit-labels`, `promote_scope_metadata`, `keep_identifying_resource_attributes` |
| loki | grafana/loki:3.7.8 | 13100 | defaults (OTLP on `/otlp`, structured metadata on) |
| tempo | grafana/tempo:2.10.8 | 13200 (API), 24318 (OTLP HTTP), 19411 (Zipkin) | local-blocks enabled for TraceQL metrics |
| otelcol | otel/opentelemetry-collector-contrib:0.162.0 | 14318 (plain OTLP HTTP), 15318 (enriched pipeline), 18888 (self-metrics) | |
| node-exporter | prom/node-exporter:v1.12.1 | 19100 | non-OTel scrape source |
| grafana | plugin dev image (`.config/Dockerfile`, grafana-enterprise 13.2.3) | 13000, 2345 (delve) | started from the repo-root `docker-compose.yaml`, which includes this stack; loads the plugin from `dist/` and provisions these datasources from `provisioning/datasources/dev.yaml` |

Emitters (compose profile `emitters`, image built from `./emitter`, Python OTel SDK 1.45.1):

| Service | Route | Resource |
|---|---|---|
| emit-checkout-via-collector | collector plain pipeline | service.name=checkout, namespace=shop, instance=checkout-1 |
| emit-payments-direct | straight to Prometheus/Loki/Tempo OTLP | service.name=payments |
| emit-noname-via-collector | collector plain pipeline | no OTEL_SERVICE_NAME |
| emit-noname-direct | direct | no OTEL_SERVICE_NAME |
| emit-inventory-enriched | collector enriched pipeline (resource_detection + `otelcol.pipeline=enriched`) | service.name=inventory |

## Start

Run everything from the repo root, so Grafana, the backends and the emitters share one compose project and network:

```sh
npm run build
go run github.com/magefile/mage@v1.17.2 build:linuxARM64
docker compose up -d --build
docker compose --profile emitters build
for s in emit-checkout-via-collector emit-payments-direct emit-noname-via-collector emit-noname-direct emit-inventory-enriched; do
  docker compose run --rm -d "$s"
done
./dev/scripts/push-raw.sh
./dev/scripts/translation-matrix.sh
```

Each emitter sends telemetry for 60 seconds (`RUN_SECONDS`) and exits. Rerun the loop for fresh data, for example when the overview shows nothing for a recent time range.

Do not run `docker compose` from `dev/` while the root stack is up: it starts a separate project (`semconv-lab`) on its own network, where emitters cannot reach the root stack's collector and the backend ports clash.

`push-raw.sh` sends hand-built OTLP/JSON with no `service.name`, Loki push-API streams with various label sets, and Zipkin spans.
`translation-matrix.sh` hot-reloads prometheus-alt through `NoTranslation`, `UnderscoreEscapingWithoutSuffixes` and `NoUTF8EscapingWithSuffixes`, pushing a probe metric under each (job `probe-<strategy>`), then restores the config.

## Stop

```sh
docker compose down          # from the repo root
docker image rm semconv-emitter:local   # also remove the built emitter image
```

## Other contents

The Weaver template that builds the plugin catalogue now lives in `catalogue/templates/`. Regenerate the catalogue with `go run ./cmd/catalogue-gen` from the repo root (Docker required; `-semconv v1.44.0` pins a release).

| Path | What |
|---|---|
| `weaver/livecheck/` | Crafted Weaver live-check input and its report, the evidence for reusing live-check finding ids |
| `evidence/cloud-raw/` | Raw read-only query dumps from cloud. Ignored by git because they contain real host and account names |

Findings: Backlog doc-3 (local experiments). The other evidence is in doc-2 (cloud), doc-4 (Weaver) and doc-5 (docs).

## Test fixtures

`testdata/fixtures/{local,cloud}/` holds raw datasource API responses, fetched through Grafana's datasource proxy, the same way the plugin frontend fetches them. Each target has a `manifest.json` that records the request, the headers and the 24h window.

```sh
python3 -I dev/scripts/capture_fixtures.py local   # needs the stack and emitters running
python3 -I dev/scripts/capture_fixtures.py cloud   # read-only: GET requests through gcx --context cloud
```

The script redacts host, account, subscription and user names, and replaces Loki log lines with `<line>`. Check new captures before committing them.


## End-to-end validation on cloud

`dev/validate/cloud.validate.test.ts` runs the plugin's own collectors against cloud and scores the result on the local backend. Every cloud request is a `gcx --context cloud api ... -X GET`, and nothing is written to cloud. It needs the dev stack running and a local Grafana session cookie:

```sh
J=$PWD/dev/evidence/cloud-raw/local-cookies.txt
curl -s -c $J -H 'Content-Type: application/json' -d '{"user":"admin","password":"admin"}' localhost:13000/login
VALIDATE_WINDOW_DAYS=30 LOCAL_GRAFANA_COOKIES=$J npx jest --ci --rootDir . --testMatch '<rootDir>/dev/validate/**/*.test.ts' --forceExit
```

The inventory and assessment are written to `dev/evidence/cloud-raw/` (git-ignored, because they contain real names). Without `LOCAL_GRAFANA_COOKIES` the suite is skipped. Grafana rotates session tokens from the client, so the suite calls `POST /api/user/auth-tokens/rotate` before each local request and writes the new cookie back to the jar. One login keeps working across runs; log in again only if a run fails with 401.
