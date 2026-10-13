import argparse
import json
import re
import subprocess
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

WINDOW_SECONDS = 24 * 3600
TEMPO_SEARCH_LIMIT = 20
LOKI_SAMPLE_LIMIT = 20

REDACTIONS = [
    (re.compile(r"ip-10-\d+-\d+-\d+"), "ip-<redacted>"),
    (re.compile(r"\b10\.\d+\.\d+\.\d+\b"), "10.<redacted>"),
    (re.compile(r"\b10-\d+-\d+-\d+\b"), "10-<redacted>"),
    (re.compile(r"\b172\.(1[6-9]|2\d|3[01])\.\d+\.\d+\b"), "172.<redacted>"),
    (re.compile(r"EC2AMAZ-[A-Z0-9]+"), "<windows-host>"),
    (re.compile(r"psql-[a-z0-9-]+"), "<postgres-host>"),
    (re.compile(r"aks-([a-z]+)-\d+-vmss\d*"), r"aks-\1-<node>"),
    (re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?=/resourceGroups)"), "<subscription-id>"),
    (re.compile(r"<user>"), "<user>"),
    (re.compile(r"\b\d{12}\b"), "<account-id>"),
]

TARGETS = {
    "cloud": {
        "prometheus": "grafanacloud-prom",
        "loki": "grafanacloud-logs",
        "tempo": "grafanacloud-traces",
        "owner_metric": "http_server_request_duration_seconds_bucket",
        "loki_service": "integrations/db-o11y",
    },
    "local": {
        "base_url": "http://localhost:13000",
        "prometheus": "prom",
        "loki": "loki",
        "tempo": "tempo",
        "owner_metric": "http_server_request_duration_seconds_bucket",
        "loki_service": "checkout",
    },
}

OWNER_BATCH = [
    "http_server_request_duration_seconds_bucket",
    "http_server_duration_milliseconds_bucket",
    "gen_ai_client_token_usage_bucket",
    "process_memory_usage_bytes",
    "target_info",
]


def proxy_path(datasource, path, params):
    query = urllib.parse.urlencode(params, doseq=True)
    return f"/api/datasources/proxy/uid/{datasource}{path}" + (f"?{query}" if query else "")


def fetch_cloud(path, headers):
    command = ["gcx", "--context", "cloud", "api", path, "-X", "GET", "-o", "json"]
    for name, value in headers.items():
        command += ["-H", f"{name}: {value}"]
    result = subprocess.run(command, capture_output=True, text=True, check=True)
    return result.stdout


def fetch_local(base_url, path, headers):
    request = urllib.request.Request(base_url + path, headers=headers, method="GET")
    with urllib.request.urlopen(request, timeout=60) as response:
        return response.read().decode()


def redact(text):
    for pattern, replacement in REDACTIONS:
        text = pattern.sub(replacement, text)
    return text


def blank_log_lines(document):
    for stream in document.get("data", {}).get("result", []):
        stream["values"] = [[entry[0], "<line>", *entry[2:]] for entry in stream.get("values", [])]
    return document


POST_PROCESSORS = {"loki/sample-categorized.json": blank_log_lines}


def requests_for(target, start, end):
    prom, loki, tempo = target["prometheus"], target["loki"], target["tempo"]
    window = f"{WINDOW_SECONDS}s"
    owners_query = (
        "count by (__name__, job, instance, service_name, service_namespace) "
        f'(last_over_time({{__name__=~"{"|".join(OWNER_BATCH)}"}}[{window}]))'
    )
    collectors_query = (
        "count by (job, instance, collector_id, pod, workload, receiver, component_path, component_id) "
        f'(last_over_time({{__name__=~"otelcol_receiver_accepted_.+|alloy_build_info"}}[{window}]))'
    )
    owner_selector = f'{target["owner_metric"]}{{job!=""}}'
    loki_selector = f'{{service_name="{target["loki_service"]}"}}'
    nanos = lambda seconds: str(seconds * 1_000_000_000)
    return {
        "prometheus/metric-names.json": (proxy_path(prom, "/api/v1/label/__name__/values", {"start": start, "end": end}), {}),
        "prometheus/target-info-series.json": (proxy_path(prom, "/api/v1/series", {"match[]": "target_info", "start": start, "end": end}), {}),
        "prometheus/owners-count.json": (proxy_path(prom, "/api/v1/query", {"query": owners_query, "time": end}), {}),
        "prometheus/owner-label-names.json": (proxy_path(prom, "/api/v1/labels", {"match[]": owner_selector, "start": start, "end": end}), {}),
        "prometheus/collectors.json": (proxy_path(prom, "/api/v1/query", {"query": collectors_query, "time": end}), {}),
        "tempo/tags-resource.json": (proxy_path(tempo, "/api/v2/search/tags", {"scope": "resource", "start": start, "end": end}), {}),
        "tempo/tags-span.json": (proxy_path(tempo, "/api/v2/search/tags", {"scope": "span", "start": start, "end": end}), {}),
        "tempo/service-names.json": (proxy_path(tempo, "/api/v2/search/tag/resource.service.name/values", {"start": start, "end": end}), {}),
        "tempo/search-select-scopes.json": (
            proxy_path(tempo, "/api/search", {
                "q": '{ resource.service.name != "" } | select(instrumentation:name, instrumentation:version)',
                "limit": TEMPO_SEARCH_LIMIT, "spss": 3, "start": start, "end": end,
            }),
            {},
        ),
        "loki/labels.json": (proxy_path(loki, "/loki/api/v1/labels", {"start": nanos(start), "end": nanos(end)}), {}),
        "loki/service-name-values.json": (proxy_path(loki, "/loki/api/v1/label/service_name/values", {"start": nanos(start), "end": nanos(end)}), {}),
        "loki/sample-categorized.json": (
            proxy_path(loki, "/loki/api/v1/query_range", {
                "query": loki_selector, "limit": LOKI_SAMPLE_LIMIT, "start": nanos(start), "end": nanos(end), "direction": "backward",
            }),
            {"X-Loki-Response-Encoding-Flags": "categorize-labels"},
        ),
    }


def capture(name, out_dir):
    target = TARGETS[name]
    end = int(time.time())
    start = end - WINDOW_SECONDS
    destination = out_dir / name
    manifest = {"target": name, "window": {"start": start, "end": end}, "files": {}}
    for relative, (path, headers) in requests_for(target, start, end).items():
        body = fetch_cloud(path, headers) if name == "cloud" else fetch_local(target["base_url"], path, headers)
        document = json.loads(redact(body))
        document = POST_PROCESSORS.get(relative, lambda d: d)(document)
        file_path = destination / relative
        file_path.parent.mkdir(parents=True, exist_ok=True)
        file_path.write_text(json.dumps(document, indent=2, sort_keys=True) + "\n")
        manifest["files"][relative] = {"request": redact(path), "headers": headers}
        print(f"{name}: {relative}", file=sys.stderr)
    (destination / "manifest.json").write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n")


def main():
    parser = argparse.ArgumentParser(description="Capture raw datasource API responses as test fixtures (GET only).")
    parser.add_argument("target", choices=sorted(TARGETS))
    parser.add_argument("--out", type=Path, default=Path("testdata/fixtures"))
    arguments = parser.parse_args()
    capture(arguments.target, arguments.out)


if __name__ == "__main__":
    main()
