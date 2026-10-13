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
| grafana | grafana/grafana:13.2.3 | 13000 | anonymous admin, datasources provisioned |

Emitters (compose profile `emitters`, image built from `./emitter`, Python OTel SDK 1.45.1):

| Service | Route | Resource |
|---|---|---|
| emit-checkout-via-collector | collector plain pipeline | service.name=checkout, namespace=shop, instance=checkout-1 |
| emit-payments-direct | straight to Prometheus/Loki/Tempo OTLP | service.name=payments |
| emit-noname-via-collector | collector plain pipeline | no OTEL_SERVICE_NAME |
| emit-noname-direct | direct | no OTEL_SERVICE_NAME |
| emit-inventory-enriched | collector enriched pipeline (resource_detection + `otelcol.pipeline=enriched`) | service.name=inventory |

## Start

```sh
docker compose up -d
docker compose --profile emitters build
for s in emit-checkout-via-collector emit-payments-direct emit-noname-via-collector emit-noname-direct emit-inventory-enriched; do
  docker compose run --rm -d "$s"
done
./scripts/push-raw.sh
./scripts/translation-matrix.sh
```

`push-raw.sh` sends hand-built OTLP/JSON with no `service.name`, Loki push-API streams with various label sets, and Zipkin spans.
`translation-matrix.sh` hot-reloads prometheus-alt through `NoTranslation`, `UnderscoreEscapingWithoutSuffixes` and `NoUTF8EscapingWithSuffixes`, pushing a probe metric under each (job `probe-<strategy>`), then restores the config.

## Stop

```sh
docker compose down          # keep nothing but the files
docker compose down --rmi local   # also remove the built emitter image
```

## Other contents

| Path | What |
|---|---|
| `weaver/templates/registry/compact2/` | The Weaver template that builds the plugin catalogue (design doc-1, section 3.2). `compact/` is the earlier attributes-and-metrics-only version |
| `weaver/livecheck/` | Crafted Weaver live-check input and its report, the evidence for reusing live-check finding ids |
| `evidence/cloud-raw/` | Raw read-only query dumps from cloud. Ignored by git because they contain real host and account names |

Findings: Backlog doc-3 (local experiments). The other evidence is in doc-2 (cloud), doc-4 (Weaver) and doc-5 (docs).
