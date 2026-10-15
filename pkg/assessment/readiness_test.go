package assessment

import (
	"slices"
	"testing"

	"github.com/iambenzo/otel-semconv-compliance/pkg/finding"
	"github.com/iambenzo/otel-semconv-compliance/pkg/product"
	"github.com/iambenzo/otel-semconv-compliance/pkg/scoring"
)

var checkout = finding.Owner{Kind: finding.OwnerService, Namespace: "shop", Name: "checkout"}

var testProduct = product.Product{ID: "test", Name: "Test", Requirements: []product.Requirement{
	{Signal: finding.SignalTraces, Attribute: "service.name", Level: product.LevelRequired},
	{Signal: finding.SignalTraces, Attribute: "service.namespace", Level: product.LevelRequired},
	{Signal: finding.SignalTraces, Attribute: "deployment.environment.name", Alternatives: []string{"deployment.environment"}, Level: product.LevelRequired},
	{Signal: finding.SignalTraces, Attribute: "k8s.pod.name", Level: product.LevelRecommended},
	{Signal: finding.SignalMetrics, Attribute: "service.instance.id", Level: product.LevelRequired},
}}

func readinessOf(t *testing.T, rows []ProductReadiness, owner finding.Owner, signal finding.Signal, productID string) ProductReadiness {
	t.Helper()
	for _, row := range rows {
		if row.Owner == owner && row.Signal == signal && row.Product == productID {
			return row
		}
	}
	t.Fatalf("no %s readiness for %+v on %s in %+v", productID, owner, signal, rows)
	return ProductReadiness{}
}

func Test_resourceCollector_readiness(t *testing.T) {
	cases := []struct {
		name               string
		service            TraceService
		wantRatio          scoring.Ratio
		wantMissing        []string
		wantUnknown        []string
		wantRecommendedGap []string
	}{
		{
			name:      "fully ready, with the deprecated environment name as a fallback",
			service:   TraceService{ServiceName: "checkout", ServiceNamespace: "shop", ResourceKeys: []KeyObservation{{Key: "deployment.environment"}, {Key: "k8s.pod.name"}}},
			wantRatio: scoring.Ratio{Numerator: 3, Denominator: 3}, wantMissing: []string{}, wantUnknown: []string{}, wantRecommendedGap: []string{},
		},
		{
			name:      "partially ready",
			service:   TraceService{ServiceName: "checkout", ServiceNamespace: "shop", ResourceKeys: []KeyObservation{{Key: "service.name"}}},
			wantRatio: scoring.Ratio{Numerator: 2, Denominator: 3}, wantMissing: []string{"deployment.environment.name"}, wantUnknown: []string{}, wantRecommendedGap: []string{"k8s.pod.name"},
		},
		{
			name:      "unknown attributes are left out of the ratio",
			service:   TraceService{ServiceName: "checkout", ServiceNamespace: "shop"},
			wantRatio: scoring.Ratio{Numerator: 2, Denominator: 2}, wantMissing: []string{}, wantUnknown: []string{"deployment.environment.name"}, wantRecommendedGap: []string{},
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			var collector resourceCollector
			collector.observe(checkout, finding.SignalTraces, traceResource(tc.service))

			row := readinessOf(t, collector.readiness([]product.Product{testProduct}), checkout, finding.SignalTraces, "test")

			if row.Readiness != tc.wantRatio {
				t.Errorf("readiness = %+v, want %+v", row.Readiness, tc.wantRatio)
			}
			if !slices.Equal(row.Missing, tc.wantMissing) || !slices.Equal(row.Unknown, tc.wantUnknown) || !slices.Equal(row.MissingRecommended, tc.wantRecommendedGap) {
				t.Errorf("missing %v unknown %v recommended gap %v", row.Missing, row.Unknown, row.MissingRecommended)
			}
		})
	}
}

func Test_resourceCollector_readinessIsNotCheckableWhenEveryRequirementIsUnknown(t *testing.T) {
	var collector resourceCollector
	collector.observe(checkout, finding.SignalMetrics, metricResource(checkout, map[string]string{"job": "shop/checkout"}, nil, nil))

	row := readinessOf(t, collector.readiness([]product.Product{testProduct}), checkout, finding.SignalMetrics, "test")

	if _, defined := row.Readiness.Value(); defined {
		t.Errorf("readiness = %+v, want no value", row.Readiness)
	}
	if !slices.Equal(row.Unknown, []string{"service.instance.id"}) {
		t.Errorf("unknown = %v", row.Unknown)
	}
}

func Test_resourceCollector_readinessSkipsSignalsWithoutRequirementsAndNonServiceOwners(t *testing.T) {
	var collector resourceCollector
	collector.observe(checkout, finding.SignalLogs, logResource(LogService{ServiceName: "checkout", SampledLines: 1}))
	collector.observe(finding.Owner{Kind: finding.OwnerPipeline, Name: "otelcol"}, finding.SignalTraces, traceResource(TraceService{ServiceName: "otelcol"}))

	if rows := collector.readiness([]product.Product{testProduct}); len(rows) != 0 {
		t.Errorf("rows = %+v, want none", rows)
	}
}

func Test_Assess_readinessLeavesEveryScoreUnchanged(t *testing.T) {
	inventory := Inventory{Traces: []TraceDatasource{{UID: "tempo", Services: []TraceService{
		{ServiceName: "cart", SpanCount: 5, ResourceKeys: []KeyObservation{{Key: "service.name"}, {Key: "service.instance.id"}, {Key: "deployment.environment.name"}}},
	}}}}
	cart := finding.Owner{Kind: finding.OwnerService, Name: "cart"}

	result := newAssessor(t).Assess(inventory, scoringDefaults)

	kg := readinessOf(t, result.Readiness, cart, finding.SignalTraces, "knowledge-graph")
	if kg.Readiness != (scoring.Ratio{Numerator: 2, Denominator: 2}) {
		t.Errorf("knowledge graph readiness = %+v, want 2/2", kg)
	}
	if !slices.Equal(kg.MissingRecommended, []string{"service.namespace", "k8s.cluster.name", "k8s.namespace.name", "k8s.pod.name", "k8s.node.name"}) {
		t.Errorf("knowledge graph recommended gap = %v", kg.MissingRecommended)
	}
	classic := readinessOf(t, result.Readiness, cart, finding.SignalTraces, "application-observability")
	if classic.Readiness != (scoring.Ratio{Numerator: 1, Denominator: 3}) || !slices.Equal(classic.Missing, []string{"deployment.environment", "telemetry.sdk.name"}) {
		t.Errorf("classic readiness = %+v, want 1/3 with only deployment.environment.name not counting", classic)
	}
	for _, row := range result.Owners {
		if row.Owner == cart && row.Signal == finding.SignalTraces && row.Scores.RequiredResource != (scoring.Ratio{Numerator: 3, Denominator: 4}) {
			t.Errorf("required_resource = %+v, want 3/4 from the four defaults only", row.Scores.RequiredResource)
		}
	}
}
