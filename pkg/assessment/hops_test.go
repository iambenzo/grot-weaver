package assessment

import (
	"encoding/json"
	"os"
	"strings"
	"testing"

	"github.com/iambenzo/otel-semconv-compliance/pkg/finding"
	"github.com/iambenzo/otel-semconv-compliance/pkg/identity"
)

func cloudCollectors(t *testing.T) []Collector {
	t.Helper()
	raw, err := os.ReadFile("../../testdata/fixtures/cloud/prometheus/collectors.json")
	if err != nil {
		t.Fatal(err)
	}
	var response struct {
		Data struct {
			Result []struct {
				Metric map[string]string `json:"metric"`
			} `json:"result"`
		} `json:"data"`
	}
	if err := json.Unmarshal(raw, &response); err != nil {
		t.Fatal(err)
	}
	rows := make([]map[string]string, 0, len(response.Data.Result))
	for _, sample := range response.Data.Result {
		rows = append(rows, sample.Metric)
	}
	return collectorsFrom(rows)
}

func Test_hopCandidates_nameAffinityOnCloudCollectors(t *testing.T) {
	collectors := cloudCollectors(t)
	weather := finding.Owner{Kind: finding.OwnerService, Namespace: "shop-demo", Name: "weather-app"}

	candidates := hopCandidates(hopContext{owner: weather, origin: identity.OriginSDK}, collectors, nil)

	if len(candidates) == 0 || !strings.Contains(strings.Join(candidates[0].Reasons, " "), "shop_ecs_weather_app") {
		t.Fatalf("candidates = %+v, want a name-affinity match on the shop_ecs_weather_app pipeline", candidates)
	}
}

func Test_hopCandidates(t *testing.T) {
	collectors := []Collector{
		{ID: "alloy-receiver-1", Pod: "k8s-monitoring-alloy-receiver-1", Components: []string{"otlp/application_observability.feature/otelcol.receiver.otlp.receiver"}},
		{ID: "ecs-collector", Components: []string{"/remotecfg/shop_checkout_pipeline.default"}},
	}
	checkout := finding.Owner{Kind: finding.OwnerService, Namespace: "shop", Name: "checkout"}

	tests := []struct {
		name         string
		context      hopContext
		mappings     []PipelineMapping
		wantFirst    string
		wantReason   string
		wantNoResult bool
	}{
		{name: "admin mapping takes precedence", context: hopContext{owner: checkout}, mappings: []PipelineMapping{{Match: "shop/*", Pipeline: "edge-gateway"}}, wantFirst: "edge-gateway", wantReason: "admin mapping"},
		{name: "host.name is a collector pod", context: hopContext{owner: checkout, target: map[string]string{"host_name": "k8s-monitoring-alloy-receiver-1"}}, wantFirst: "alloy-receiver-1", wantReason: "host.name"},
		{name: "component name mentions the service", context: hopContext{owner: checkout}, wantFirst: "ecs-collector", wantReason: "mentions checkout"},
		{name: "collector-scraped source", context: hopContext{owner: finding.Owner{Kind: finding.OwnerSource, Name: "node"}, origin: identity.OriginCollectorScraped}, wantFirst: collectorScrapePipeline, wantReason: "scrape-target labels"},
		{name: "short names do not match by affinity", context: hopContext{owner: finding.Owner{Kind: finding.OwnerService, Name: "app"}}, wantNoResult: true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			candidates := hopCandidates(tt.context, collectors, tt.mappings)
			if tt.wantNoResult {
				if len(candidates) != 0 {
					t.Fatalf("candidates = %+v, want none", candidates)
				}
				return
			}
			if len(candidates) == 0 || candidates[0].Pipeline != tt.wantFirst || !strings.Contains(strings.Join(candidates[0].Reasons, " "), tt.wantReason) {
				t.Errorf("candidates = %+v, want %s first with reason %q", candidates, tt.wantFirst, tt.wantReason)
			}
		})
	}
}

func Test_Assess_reportsHopsPerService(t *testing.T) {
	inventory := Inventory{
		PipelineMappings: []PipelineMapping{{Match: "payments", Pipeline: "payments-gateway"}},
		Traces:           []TraceDatasource{{UID: "tempo", Services: []TraceService{{ServiceName: "payments"}}}},
		Metrics: []MetricDatasource{{
			UID:        "prom",
			TargetInfo: []map[string]string{{"job": "shop/checkout", "telemetry_sdk_name": "opentelemetry", "host_name": "alloy-a"}},
			Owners:     []MetricOwner{{Metric: "process_memory_usage_bytes", Labels: map[string]string{"job": "shop/checkout"}, Series: 1}},
			Collectors: []map[string]string{{"collector_id": "alloy-a", "job": "integrations/alloy"}},
		}},
	}

	result := newAssessor(t).Assess(inventory, scoringDefaults)

	byOwner := map[string]ServiceHops{}
	for _, hops := range result.Hops {
		byOwner[hops.Owner.Name] = hops
	}
	if byOwner["payments"].Candidates[0].Pipeline != "payments-gateway" {
		t.Errorf("payments hops = %+v", byOwner["payments"])
	}
	if byOwner["checkout"].Candidates[0].Pipeline != "alloy-a" {
		t.Errorf("checkout hops = %+v", byOwner["checkout"])
	}
}

func Test_Inventory_Validate_pipelineMappings(t *testing.T) {
	for _, mapping := range []PipelineMapping{{Match: "", Pipeline: "x"}, {Match: "[", Pipeline: "x"}, {Match: "a", Pipeline: ""}} {
		if err := (Inventory{PipelineMappings: []PipelineMapping{mapping}}).Validate(); err == nil {
			t.Errorf("mapping %+v should be rejected", mapping)
		}
	}
}
