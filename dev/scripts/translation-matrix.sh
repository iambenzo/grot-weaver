#!/usr/bin/env bash
set -euo pipefail
PROMALT=${PROMALT:-http://localhost:19091}
CONFIG=$(dirname "$0")/../config/prometheus-alt.yml
ORIGINAL=$(cat "$CONFIG")
trap 'printf "%s\n" "$ORIGINAL" > "$CONFIG"; curl -s -X POST "$PROMALT/-/reload"' EXIT

push_probe() {
  local service=$1 now start
  now=$(python3 -c 'import time;print(time.time_ns())'); start=$((now-60000000000))
  curl -sS -o /dev/null -w "push $service %{http_code}\n" -H 'Content-Type: application/json' "$PROMALT/api/v1/otlp/v1/metrics" --data-binary @- <<JSON
{"resourceMetrics":[{"resource":{"attributes":[{"key":"service.name","value":{"stringValue":"$service"}}]},
 "scopeMetrics":[{"scope":{"name":"probe.scope"},"metrics":[
  {"name":"http.server.request.duration","unit":"s","histogram":{"aggregationTemporality":2,"dataPoints":[{"count":"1","sum":0.2,"bucketCounts":["1","0"],"explicitBounds":[0.5],"startTimeUnixNano":"$start","timeUnixNano":"$now","attributes":[{"key":"http.request.method","value":{"stringValue":"GET"}}]}]}},
  {"name":"probe.events","unit":"{event}","sum":{"aggregationTemporality":2,"isMonotonic":true,"dataPoints":[{"asInt":"3","startTimeUnixNano":"$start","timeUnixNano":"$now"}]}},
  {"name":"probe.utilization","unit":"1","gauge":{"dataPoints":[{"asDouble":0.4,"timeUnixNano":"$now"}]}}]}]}]}
JSON
}

for strategy in NoTranslation UnderscoreEscapingWithoutSuffixes; do
  printf "%s\n" "$ORIGINAL" | sed "s/translation_strategy: .*/translation_strategy: $strategy/" > "$CONFIG"
  curl -s -X POST "$PROMALT/-/reload"
  push_probe "probe-$strategy"
done
printf "%s\n" "$ORIGINAL" | sed "s/translation_strategy: .*/translation_strategy: NoUTF8EscapingWithSuffixes/" > "$CONFIG"
curl -s -X POST "$PROMALT/-/reload"
push_probe "probe-NoUTF8EscapingWithSuffixes"
