package finding

import (
	"testing"

	"github.com/iambenzo/otel-semconv-compliance/pkg/catalogue"
	"github.com/iambenzo/otel-semconv-compliance/pkg/nameindex"
)

func Test_Classifier_Misplacement(t *testing.T) {
	loaded := embeddedCatalogue(t)
	classifier := NewClassifier(loaded)
	index := nameindex.NewAttributeIndex(loaded, nil)

	tests := []struct {
		name      string
		key       string
		scope     catalogue.RenameScope
		signal    Signal
		misplaced bool
	}{
		{name: "span attribute sent on the resource", key: "http.request.method", scope: catalogue.ScopeResources, signal: SignalTraces, misplaced: true},
		{name: "entity attribute sent on spans", key: "k8s.pod.name", scope: catalogue.ScopeSpans, signal: SignalTraces, misplaced: true},
		{name: "span attribute on spans", key: "http.request.method", scope: catalogue.ScopeSpans, signal: SignalTraces},
		{name: "entity attribute on the resource", key: "k8s.pod.name", scope: catalogue.ScopeResources, signal: SignalTraces},
		{name: "attribute used on both sides", key: "cloud.region", scope: catalogue.ScopeSpans, signal: SignalTraces},
		{name: "custom key", key: "acme.thing", scope: catalogue.ScopeResources, signal: SignalTraces},
		{name: "metrics are never judged", key: "k8s.pod.name", scope: catalogue.ScopeSpans, signal: SignalMetrics},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			classified := classifier.Attribute(Observation{Owner: checkout, Signal: tt.signal}, index.Match(tt.key, nameindex.Context{Scope: tt.scope}), tt.scope)

			misplaced, found := classifier.Misplacement(classified)

			if found != tt.misplaced {
				t.Fatalf("misplaced = %v (%+v), want %v", found, misplaced, tt.misplaced)
			}
			if found && (misplaced.Type != TypeMisplacedAttribute || misplaced.Level != LevelImprovement || misplaced.Note == "" || misplaced.Expected != tt.key) {
				t.Errorf("finding = %+v", misplaced)
			}
		})
	}
}
