package assessment

import (
	"encoding/json"
	"os"
	"slices"
	"testing"

	"github.com/iambenzo/otel-semconv-compliance/pkg/finding"
	"github.com/iambenzo/otel-semconv-compliance/pkg/identity"
)

func localTargetInfo(t *testing.T) []map[string]string {
	t.Helper()
	raw, err := os.ReadFile("../../testdata/fixtures/local/prometheus/target-info-series.json")
	if err != nil {
		t.Fatal(err)
	}
	var response struct {
		Data []map[string]string `json:"data"`
	}
	if err := json.Unmarshal(raw, &response); err != nil {
		t.Fatal(err)
	}
	for _, labels := range response.Data {
		delete(labels, "__name__")
	}
	return response.Data
}

func metricFinding(result Result, owner finding.Owner, observed string) (finding.Finding, bool) {
	for _, ranked := range result.Findings {
		if ranked.Owner == owner && (ranked.Observed == observed || ranked.Signal == finding.SignalMetrics && ranked.Scope == "" && slices.Contains(ranked.Metrics, observed)) {
			return ranked.Finding, true
		}
	}
	return finding.Finding{}, false
}

func Test_Assess_metricsFromLocalFixtures(t *testing.T) {
	targets := append(localTargetInfo(t), map[string]string{"job": "integrations/old", "net_host_name": "h", "http_scheme": "http"})
	inventory := Inventory{Metrics: []MetricDatasource{{
		UID:        "prom",
		TargetInfo: targets,
		Owners: []MetricOwner{
			{Metric: "http_server_request_duration_seconds_bucket", Labels: map[string]string{"job": "shop/checkout"}, Series: 40},
			{Metric: "http_server_duration_milliseconds_bucket", Labels: map[string]string{"job": "shop/checkout"}, Series: 10},
			{Metric: "http_server_request_duration_milliseconds_bucket", Labels: map[string]string{"job": "payments"}, Series: 10},
			{Metric: "http_server_requests_total", Labels: map[string]string{"job": "payments"}, Series: 2},
			{Metric: "checkout_orders_total", Labels: map[string]string{"job": "shop/checkout"}, Series: 1},
			{Metric: "process_memory_usage_bytes", Labels: map[string]string{"job": "unknown_service:python"}, Series: 1},
			{Metric: "process_memory_usage_bytes", Labels: map[string]string{"job": "unknown_service:python", "instance": "b"}, Series: 1},
			{Metric: "node_cpu_seconds_total", Labels: map[string]string{"job": "node-via-otelcol-otlp"}, Series: 8},
			{Metric: "otelcol_exporter_sent_spans_total", Labels: map[string]string{"job": "otelcol"}, Series: 3},
			{Metric: "job:http_requests:rate5m", Labels: map[string]string{"job": "shop/checkout"}, Series: 1},
			{Metric: "target_info", Labels: map[string]string{"job": "shop/checkout"}, Series: 1},
		},
	}}}

	result := newAssessor(t).Assess(inventory, scoringDefaults)

	checkout := finding.Owner{Kind: finding.OwnerService, Namespace: "shop", Name: "checkout"}
	payments := finding.Owner{Kind: finding.OwnerService, Name: "payments"}
	python := finding.Owner{Kind: finding.OwnerService, Name: "unknown_service:python"}
	node := finding.Owner{Kind: finding.OwnerSource, Name: "node-via-otelcol-otlp"}
	pipeline := finding.Owner{Kind: finding.OwnerPipeline, Name: collectorScrapePipeline}

	tests := []struct {
		owner    finding.Owner
		observed string
		want     finding.Type
	}{
		{checkout, "http_server_request_duration_seconds_bucket", finding.TypeConformant},
		{checkout, "http_server_duration_milliseconds_bucket", finding.TypeDeprecated},
		{payments, "http_server_request_duration_milliseconds_bucket", finding.TypeUnitMismatch},
		{payments, "http_server_requests_total", finding.TypeNotInRegistry},
		{checkout, "checkout_orders_total", finding.TypeCustom},
		{python, "unknown_service:python", finding.TypeSDKDefaultServiceName},
		{node, "node_cpu_seconds_total", finding.TypeCustom},
		{pipeline, "net_host_name", finding.TypeDeprecated},
		{pipeline, "server_address", finding.TypeConformant},
	}
	for _, tt := range tests {
		t.Run(tt.owner.Name+"/"+tt.observed, func(t *testing.T) {
			got, found := metricFinding(result, tt.owner, tt.observed)
			if !found || got.Type != tt.want {
				t.Fatalf("got %+v (found %v), want %s", got, found, tt.want)
			}
		})
	}

	for _, excluded := range []string{"otelcol_exporter_sent_spans_total", "job:http_requests:rate5m", "target_info"} {
		for _, ranked := range result.Findings {
			if ranked.Observed == excluded {
				t.Errorf("reclassified metric %s produced finding %+v", excluded, ranked.Finding)
			}
		}
	}

	defaults := 0
	for _, ranked := range result.Findings {
		if ranked.Type == finding.TypeSDKDefaultServiceName {
			defaults++
			if ranked.Volume != 2 {
				t.Errorf("identity finding volume = %v, want both rows summed", ranked.Volume)
			}
		}
	}
	if defaults != 1 {
		t.Errorf("sdk default findings = %d, want one per owner", defaults)
	}

	introduced, _ := metricFinding(result, pipeline, "net_host_name")
	if !introduced.PipelineIntroduced || introduced.Expected != "server.address" {
		t.Errorf("receiver finding = %+v", introduced)
	}

	origins := map[finding.Owner]identity.Origin{}
	for _, attribution := range result.Metrics {
		origins[attribution.Owner] = attribution.Origin.Origin
	}
	if origins[checkout] != identity.OriginSDK || origins[node] != identity.OriginCollectorScraped {
		t.Errorf("origins = %+v", origins)
	}

	for _, row := range result.Signals {
		if row.Signal == finding.SignalMetrics && row.Scores.NamingStable.Denominator != 3 {
			t.Errorf("stack metrics naming_stable = %+v, want three service names (sources and pipelines excluded)", row.Scores.NamingStable)
		}
	}
}

func identityTargets(series []map[string]string) identity.TargetIndex {
	return identity.NewTargetIndex(series)
}

func Test_Assess_metricLibraries(t *testing.T) {
	inventory := Inventory{Metrics: []MetricDatasource{{
		UID: "prom",
		TargetInfo: []map[string]string{
			{"job": "shop/checkout", "telemetry_sdk_name": "opentelemetry", "telemetry_sdk_language": "python", "telemetry_sdk_version": "1.45.1"},
		},
		Owners: []MetricOwner{
			{Metric: "http_server_request_duration_seconds_bucket", Labels: map[string]string{"job": "shop/checkout", "otel_scope_name": "opentelemetry.instrumentation.flask", "otel_scope_version": "0.56b0"}, Series: 3},
			{Metric: "process_memory_usage_bytes", Labels: map[string]string{"job": "shop/checkout"}, Series: 1},
		},
	}}}

	result := newAssessor(t).Assess(inventory, scoringDefaults)

	checkout := finding.Owner{Kind: finding.OwnerService, Namespace: "shop", Name: "checkout"}
	scoped, _ := metricFinding(result, checkout, "http_server_request_duration_seconds_bucket")
	if scoped.Library == nil || scoped.Library.Name != "opentelemetry.instrumentation.flask" || scoped.Library.Version != "0.56b0" || scoped.Library.Confidence != "high" {
		t.Errorf("scoped library = %+v", scoped.Library)
	}
	unscoped, _ := metricFinding(result, checkout, "process_memory_usage_bytes")
	if unscoped.Library != nil {
		t.Errorf("library without scope labels = %+v, want unknown", unscoped.Library)
	}
	if len(result.Metrics) != 1 || result.Metrics[0].SDK != (identity.SDK{Name: "opentelemetry", Language: "python", Version: "1.45.1"}) {
		t.Errorf("attribution SDK = %+v", result.Metrics)
	}
}

func Test_Assess_histogramPartsCountAsOneName(t *testing.T) {
	owner := map[string]string{"job": "shop/checkout"}
	inventory := Inventory{Metrics: []MetricDatasource{{
		UID:        "prom",
		TargetInfo: []map[string]string{{"job": "shop/checkout", "telemetry_sdk_name": "opentelemetry"}},
		Owners: []MetricOwner{
			{Metric: "http_client_request_duration_milliseconds_bucket", Labels: owner, Series: 10},
			{Metric: "http_client_request_duration_milliseconds_sum", Labels: owner, Series: 1},
			{Metric: "http_client_request_duration_milliseconds_count", Labels: owner, Series: 1},
			{Metric: "shop_latency_bucket", Labels: owner, Series: 4},
			{Metric: "shop_latency_count", Labels: owner, Series: 1},
		},
	}}}

	result := newAssessor(t).Assess(inventory, scoringDefaults)

	checkout := finding.Owner{Kind: finding.OwnerService, Namespace: "shop", Name: "checkout"}
	mismatches, customs := 0, 0
	for _, ranked := range result.Findings {
		switch ranked.Type {
		case finding.TypeUnitMismatch:
			mismatches++
			if ranked.Volume != 12 || len(ranked.Metrics) != 3 || ranked.Observed != "http_client_request_duration_milliseconds" {
				t.Errorf("unit mismatch = %+v, want one finding over all three parts", ranked.Finding)
			}
		case finding.TypeCustom:
			customs++
		}
	}
	if mismatches != 1 || customs != 1 {
		t.Errorf("mismatches %d customs %d, want 1 and 1", mismatches, customs)
	}
	for _, row := range result.Owners {
		if row.Owner == checkout && row.Signal == finding.SignalMetrics && (row.Scores.NamingStable.Denominator != 1 || row.Scores.Custom != 1) {
			t.Errorf("scores = %+v, want one stable name and one custom", row.Scores)
		}
	}
}

func Test_Assess_receiverCopiesStillRaiseScrapeLabels(t *testing.T) {
	inventory := Inventory{Metrics: []MetricDatasource{{
		UID: "prom",
		TargetInfo: []map[string]string{{
			"job":                 "integrations/db-o11y",
			"instance":            "host-a",
			"service_name":        "integrations/db-o11y",
			"service_instance_id": "host-a",
			"net_host_name":       "host-a",
			"http_scheme":         "http",
		}},
		Owners: []MetricOwner{{Metric: "pg_up", Labels: map[string]string{"job": "integrations/db-o11y", "instance": "host-a"}, Series: 1}},
	}}}

	result := newAssessor(t).Assess(inventory, scoringDefaults)

	pipeline := finding.Owner{Kind: finding.OwnerPipeline, Name: collectorScrapePipeline}
	for observed, expected := range map[string]string{"net_host_name": "server.address", "http_scheme": "url.scheme"} {
		introduced, found := metricFinding(result, pipeline, observed)
		if !found || !introduced.PipelineIntroduced || introduced.Expected != expected {
			t.Errorf("%s: got %+v (found %v), want pipeline_introduced with %s", observed, introduced, found, expected)
		}
	}
	for _, attribution := range result.Metrics {
		if attribution.Origin.Origin != identity.OriginCollectorScraped {
			t.Errorf("origin for %+v = %s, want collector_scraped", attribution.Owner, attribution.Origin.Origin)
		}
	}
}
