package assessment

import (
	"encoding/json"
	"os"
	"testing"

	"github.com/prometheus/otlptranslator"

	"github.com/iambenzo/otel-semconv-compliance/pkg/nameindex"
)

func fixtureNames(t *testing.T, target string) []string {
	t.Helper()
	raw, err := os.ReadFile("../../testdata/fixtures/" + target + "/prometheus/metric-names.json")
	if err != nil {
		t.Fatal(err)
	}
	var response struct {
		Data []string `json:"data"`
	}
	if err := json.Unmarshal(raw, &response); err != nil {
		t.Fatal(err)
	}
	return response.Data
}

func Test_detectStrategy(t *testing.T) {
	assessor := newAssessor(t)
	tests := []struct {
		name          string
		datasource    MetricDatasource
		want          nameindex.Strategy
		overridden    bool
		unitCheckable bool
	}{
		{name: "cloud is the default suffix strategy", datasource: MetricDatasource{UID: "cloud", Names: fixtureNames(t, "cloud")}, want: otlptranslator.UnderscoreEscapingWithSuffixes, unitCheckable: true},
		{name: "utf8 with suffixes", datasource: MetricDatasource{UID: "u", Names: []string{"http.server.request.duration_seconds_bucket", "process.memory.usage_bytes"}}, want: otlptranslator.NoUTF8EscapingWithSuffixes, unitCheckable: true},
		{name: "without suffixes", datasource: MetricDatasource{UID: "oss", Names: []string{"http_server_request_duration_bucket", "process_memory_usage", "jvm_class_loaded"}}, want: otlptranslator.UnderscoreEscapingWithoutSuffixes},
		{name: "no translation", datasource: MetricDatasource{UID: "utf8", Names: []string{"http.server.request.duration_bucket", "process.memory.usage", "jvm.class.loaded"}}, want: otlptranslator.NoTranslation},
		{name: "empty falls back to the default with nothing to check", datasource: MetricDatasource{UID: "empty"}, want: otlptranslator.UnderscoreEscapingWithSuffixes},
		{name: "admin override wins", datasource: MetricDatasource{UID: "o", Names: fixtureNames(t, "cloud"), StrategyOverride: otlptranslator.UnderscoreEscapingWithoutSuffixes}, want: otlptranslator.UnderscoreEscapingWithoutSuffixes, overridden: true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := assessor.detectStrategy(tt.datasource)
			if got.Strategy != tt.want || got.Overridden != tt.overridden || got.UnitCheckable != tt.unitCheckable || got.Mixed {
				t.Errorf("got %+v, want %s overridden=%v unit=%v", got, tt.want, tt.overridden, tt.unitCheckable)
			}
		})
	}
}

func Test_Assess_reportsAMixedStoreHonestly(t *testing.T) {
	result := newAssessor(t).Assess(Inventory{Metrics: []MetricDatasource{{UID: "prom", Names: fixtureNames(t, "local")}}}, scoringDefaults)

	if len(result.Datasources) != 1 {
		t.Fatalf("datasources = %+v", result.Datasources)
	}
	local := result.Datasources[0]
	if !local.Mixed || !local.UnitCheckable || local.Evidence.Suffixed == 0 || local.Evidence.UTF8 == 0 {
		t.Errorf("local store (OTLP push plus UTF-8 scrape) = %+v, want mixed with checkable units", local)
	}
}

func Test_Inventory_Validate_rejectsUnknownStrategy(t *testing.T) {
	inventory := Inventory{Metrics: []MetricDatasource{{UID: "p", StrategyOverride: "Sideways"}}}
	if err := inventory.Validate(); err == nil {
		t.Error("expected an error for an unknown strategy")
	}
}

func Test_preferStrategy_breaksTiesWithTheDetectedStrategy(t *testing.T) {
	first := nameindex.MetricForm{Strategies: []nameindex.Strategy{otlptranslator.NoTranslation}}
	second := nameindex.MetricForm{Strategies: []nameindex.Strategy{otlptranslator.UnderscoreEscapingWithoutSuffixes}}
	first.Metric.Name, second.Metric.Name = "a", "b"
	match := nameindex.MetricMatch{Matched: true, Form: &first, Alternatives: []nameindex.MetricForm{second}}

	got := preferStrategy(match, otlptranslator.UnderscoreEscapingWithoutSuffixes)

	if got.Form.Metric.Name != "b" || len(got.Alternatives) != 1 || got.Alternatives[0].Metric.Name != "a" {
		t.Errorf("got %+v", got)
	}
}
