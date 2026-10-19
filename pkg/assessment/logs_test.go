package assessment

import (
	"encoding/json"
	"os"
	"testing"

	"github.com/iambenzo/grot-weaver/pkg/finding"
	"github.com/iambenzo/grot-weaver/pkg/identity"
)

func localLokiKeys(t *testing.T) (metadata, stream []string) {
	t.Helper()
	read := func(name string, target any) {
		raw, err := os.ReadFile("../../testdata/fixtures/local/loki/" + name)
		if err != nil {
			t.Fatal(err)
		}
		if err := json.Unmarshal(raw, target); err != nil {
			t.Fatal(err)
		}
	}
	var fields struct {
		Fields []struct {
			Label   string   `json:"label"`
			Parsers []string `json:"parsers"`
		} `json:"fields"`
	}
	read("detected-fields-checkout.json", &fields)
	for _, field := range fields.Fields {
		if len(field.Parsers) == 0 {
			metadata = append(metadata, field.Label)
		}
	}
	var series struct {
		Data []map[string]string `json:"data"`
	}
	read("series-checkout.json", &series)
	for key := range series.Data[0] {
		stream = append(stream, key)
	}
	return metadata, stream
}

func Test_Assess_logsFromLocalFixtures(t *testing.T) {
	metadata, stream := localLokiKeys(t)
	inventory := Inventory{Logs: []LogDatasource{{UID: "loki", Services: []LogService{
		{ServiceName: "checkout", ServiceNamespace: "shop", StreamLabels: stream, MetadataKeys: metadata, KeysMethod: MethodDetectedFields, OTLPMarkers: []string{"scope_name", "severity_number"}, ScopeNames: []string{"semconv.emitter.logs"}, Volume: 80},
		{ServiceName: "integrations/db-o11y", StreamLabels: []string{"job", "server_id"}, MetadataKeys: []string{"op"}, KeysMethod: MethodSample, Volume: 5},
		{ServiceName: "unknown_service", MetadataKeys: []string{"http_method"}, Volume: 2},
	}}}}

	result := newAssessor(t).Assess(inventory, scoringDefaults)

	checkout := finding.Owner{Kind: finding.OwnerService, Namespace: "shop", Name: "checkout"}
	tests := []struct {
		observed string
		want     finding.Type
		expected string
	}{
		{"http_method", finding.TypeDeprecated, "http.request.method"},
		{"http_request_method", finding.TypeConformant, "http.request.method"},
		{"code_file_path", finding.TypeConformant, "code.file.path"},
		{"deployment_environment_name", finding.TypeConformant, "deployment.environment.name"},
		{"order_id", finding.TypeCustom, ""},
	}
	for _, tt := range tests {
		t.Run(tt.observed, func(t *testing.T) {
			got, found := metricFinding(result, checkout, tt.observed)
			if !found || got.Type != tt.want || got.Expected != tt.expected || got.Signal != finding.SignalLogs {
				t.Fatalf("got %+v (found %v), want %s %q", got, found, tt.want, tt.expected)
			}
			if got.Library == nil || got.Library.Name != "semconv.emitter.logs" {
				t.Errorf("library = %+v", got.Library)
			}
		})
	}
	for _, structural := range []string{"trace_id", "span_id", "severity_number", "observed_timestamp", "flags", "detected_level", "scope_name", "service_name"} {
		if _, found := metricFinding(result, checkout, structural); found {
			t.Errorf("structural key %s produced a finding", structural)
		}
	}

	sources := map[string]identity.Source{}
	for _, attribution := range result.Logs {
		sources[attribution.Owner.Name] = attribution.Source
	}
	if sources["integrations/db-o11y"] != identity.SourceLogServiceNameDerived || sources["unattributed"] != identity.SourceLokiFallback {
		t.Errorf("log attribution sources = %+v", sources)
	}
	unattributed := finding.Owner{Kind: finding.OwnerUnattributed, Name: "unattributed"}
	if kept, found := metricFinding(result, unattributed, "http_method"); !found || kept.Type != finding.TypeDeprecated {
		t.Errorf("unattributed logs dropped their findings: %+v", kept)
	}
}
