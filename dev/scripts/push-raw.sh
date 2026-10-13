#!/usr/bin/env bash
set -euo pipefail
PROM=${PROM:-http://localhost:19090}
PROMALT=${PROMALT:-http://localhost:19091}
LOKI=${LOKI:-http://localhost:13100}
TEMPO_OTLP=${TEMPO_OTLP:-http://localhost:24318}
ZIPKIN=${ZIPKIN:-http://localhost:19411}
NOW_NS=$(python3 -c 'import time;print(time.time_ns())')
START_NS=$((NOW_NS-60000000000))
TRACE_ID=$(python3 -c 'import secrets;print(secrets.token_hex(16))')
SPAN_ID=$(python3 -c 'import secrets;print(secrets.token_hex(8))')

metrics_payload() {
cat <<JSON
{"resourceMetrics":[{"resource":{"attributes":[{"key":"host.name","value":{"stringValue":"raw-host"}}]},
 "scopeMetrics":[{"scope":{"name":"raw.scope","version":"9.9"},"metrics":[
  {"name":"raw.requests","unit":"{request}","sum":{"aggregationTemporality":2,"isMonotonic":true,"dataPoints":[{"asInt":"5","startTimeUnixNano":"$START_NS","timeUnixNano":"$NOW_NS","attributes":[{"key":"http.method","value":{"stringValue":"GET"}}]}]}},
  {"name":"raw.temperature","unit":"Cel","gauge":{"dataPoints":[{"asDouble":21.5,"timeUnixNano":"$NOW_NS"}]}}]}]}]}
JSON
}

echo "raw OTLP metrics without service.name -> prometheus, prometheus-alt"
metrics_payload | curl -sS -o /dev/null -w '%{http_code}\n' -H 'Content-Type: application/json' --data-binary @- "$PROM/api/v1/otlp/v1/metrics"
metrics_payload | curl -sS -o /dev/null -w '%{http_code}\n' -H 'Content-Type: application/json' --data-binary @- "$PROMALT/api/v1/otlp/v1/metrics"

echo "raw OTLP logs without service.name -> loki"
curl -sS -o /dev/null -w '%{http_code}\n' -H 'Content-Type: application/json' "$LOKI/otlp/v1/logs" --data-binary @- <<JSON
{"resourceLogs":[{"resource":{"attributes":[{"key":"host.name","value":{"stringValue":"raw-host"}}]},"scopeLogs":[{"scope":{"name":"raw.scope"},"logRecords":[{"timeUnixNano":"$NOW_NS","severityText":"WARN","severityNumber":13,"body":{"stringValue":"raw otlp log no service.name"},"attributes":[{"key":"http.method","value":{"stringValue":"GET"}}]}]}]}]}
JSON

echo "raw OTLP span without service.name -> tempo"
curl -sS -o /dev/null -w '%{http_code}\n' -H 'Content-Type: application/json' "$TEMPO_OTLP/v1/traces" --data-binary @- <<JSON
{"resourceSpans":[{"resource":{"attributes":[{"key":"host.name","value":{"stringValue":"raw-host"}}]},"scopeSpans":[{"scope":{"name":"raw.scope"},"spans":[{"traceId":"$TRACE_ID","spanId":"$SPAN_ID","name":"raw-span","kind":2,"startTimeUnixNano":"$START_NS","endTimeUnixNano":"$NOW_NS","attributes":[{"key":"http.method","value":{"stringValue":"GET"}}]}]}]}]}
JSON
echo "raw trace id: $TRACE_ID"

push_loki() {
  local stream_json=$1 line=$2
  curl -sS -o /dev/null -w '%{http_code}\n' -H 'Content-Type: application/json' "$LOKI/loki/api/v1/push" \
    --data-binary "{\"streams\":[{\"stream\":$stream_json,\"values\":[[\"$NOW_NS\",\"$line\"]]}]}"
}
echo "loki push API streams"
push_loki '{"job":"legacy-batch"}' 'level=info msg=\"job only\"'
push_loki '{"app":"legacy-web"}' 'level=error msg=\"app only\"'
push_loki '{"foo":"bar"}' 'msg=\"no service-ish label\"'
push_loki '{"service_name":"explicit-svc","job":"ignored-job"}' 'explicit service_name'
push_loki '{"job":"ns/legacy-ns-job"}' 'job with namespace prefix'
push_loki '{"container":"c1","app":"a1"}' 'container and app'

ZTRACE=$(python3 -c 'import secrets;print(secrets.token_hex(16))')
ZTS=$((NOW_NS/1000))
echo "zipkin spans (with and without localEndpoint.serviceName)"
curl -sS -o /dev/null -w '%{http_code}\n' -H 'Content-Type: application/json' "$ZIPKIN/api/v2/spans" --data-binary @- <<JSON
[{"traceId":"$ZTRACE","id":"$(python3 -c 'import secrets;print(secrets.token_hex(8))')","name":"zipkin-get","kind":"SERVER","timestamp":$ZTS,"duration":1500,"localEndpoint":{"serviceName":"zipkin-svc","ipv4":"10.0.0.1"},"tags":{"http.method":"GET","http.path":"/z"}},
 {"traceId":"$ZTRACE","id":"$(python3 -c 'import secrets;print(secrets.token_hex(8))')","name":"zipkin-noname","kind":"CLIENT","timestamp":$ZTS,"duration":700,"tags":{"http.method":"POST"}}]
JSON
echo "zipkin trace id: $ZTRACE"
