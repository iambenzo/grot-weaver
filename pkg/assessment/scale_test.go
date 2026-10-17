package assessment

import (
	"bytes"
	"compress/gzip"
	"encoding/json"
	"fmt"
	"testing"

	"github.com/iambenzo/otel-semconv-compliance/pkg/finding"
)

func inventoryAtServiceLimit() Inventory {
	keys := make([]KeyObservation, 0, 60)
	for index := range 40 {
		keys = append(keys, KeyObservation{Key: fmt.Sprintf("app.custom_%d", index)})
	}
	keys = append(keys, KeyObservation{Key: "http.method"}, KeyObservation{Key: "http.request.method"}, KeyObservation{Key: "service.name"})
	traces := make([]TraceService, 0, MaxServicesPerTrace)
	logs := make([]LogService, 0, MaxLogServices)
	for index := range MaxServicesPerTrace {
		name := fmt.Sprintf("svc-%d", index)
		namespace := fmt.Sprintf("team-%d", index%50)
		traces = append(traces, TraceService{ServiceName: name, ServiceNamespace: namespace, SpanCount: float64(index + 1), ResourceKeys: keys[:20], SpanKeys: keys})
		logs = append(logs, LogService{ServiceName: name, ServiceNamespace: namespace, StreamLabels: []string{"service_name", "service_namespace"}, MetadataKeys: []string{"trace_id", "span_id", "severity_number"}, KeysMethod: MethodDetectedFields, Volume: float64(index + 1)})
	}
	return Inventory{
		Window: Window{Start: 1, End: 2},
		Traces: []TraceDatasource{{UID: "tempo", Services: traces}},
		Logs:   []LogDatasource{{UID: "loki", Services: logs}},
	}
}

func Test_Assess_scoresAnInventoryAtTheServiceLimit(t *testing.T) {
	inventory := inventoryAtServiceLimit()
	if err := inventory.Validate(); err != nil {
		t.Fatalf("validate: %v", err)
	}

	result := newAssessor(t).Assess(inventory, scoringDefaults)

	if len(result.Attributions) != MaxServicesPerTrace || len(result.Logs) != MaxLogServices {
		t.Errorf("attributions = %d traces and %d logs, want %d each", len(result.Attributions), len(result.Logs), MaxServicesPerTrace)
	}
	if got, ok := findingFor(result, "svc-0", "http.method"); !ok || got.Type != finding.TypeDeprecated {
		t.Errorf("svc-0 http.method finding = %+v, found %v, want deprecated", got, ok)
	}
	if len(result.Owners) < 2*MaxServicesPerTrace {
		t.Errorf("owner score rows = %d, want one per service and signal", len(result.Owners))
	}
}

func Benchmark_Assess_atTheServiceLimit(b *testing.B) {
	inventory := inventoryAtServiceLimit()
	assessor := newAssessor(b)
	var result Result
	for b.Loop() {
		result = assessor.Assess(inventory, scoringDefaults)
	}
	encoded, err := json.Marshal(result)
	if err != nil {
		b.Fatal(err)
	}
	var zipped bytes.Buffer
	writer := gzip.NewWriter(&zipped)
	_, _ = writer.Write(encoded)
	_ = writer.Close()
	b.ReportMetric(float64(len(result.Findings)), "findings")
	b.ReportMetric(float64(len(encoded))/(1<<20), "result-MB")
	b.ReportMetric(float64(zipped.Len())/(1<<10), "gzipped-KB")
}
