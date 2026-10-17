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
			name:      "unknown attributes with nothing missing make the signal not checkable",
			service:   TraceService{ServiceName: "checkout", ServiceNamespace: "shop"},
			wantRatio: scoring.Ratio{}, wantMissing: []string{}, wantUnknown: []string{"deployment.environment.name"}, wantRecommendedGap: []string{},
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

func serviceSignalOf(t *testing.T, services []ServiceReadiness, owner finding.Owner, signal finding.Signal, productID string) SignalReadiness {
	t.Helper()
	for _, service := range services {
		if service.Kind != owner.Kind || service.Name != owner.Name || service.Product != productID {
			continue
		}
		for _, candidate := range service.Signals {
			if candidate.Signal == signal {
				return candidate
			}
		}
	}
	t.Fatalf("no %s readiness for %+v on %s in %+v", productID, owner, signal, services)
	return SignalReadiness{}
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

	kg := serviceSignalOf(t, result.Readiness, cart, finding.SignalTraces, "knowledge-graph")
	if kg.Readiness != (scoring.Ratio{Numerator: 2, Denominator: 2}) {
		t.Errorf("knowledge graph readiness = %+v, want 2/2", kg)
	}
	if !slices.Equal(kg.MissingRecommended, []string{"service.namespace", "k8s.cluster.name", "k8s.namespace.name", "k8s.pod.name", "k8s.node.name"}) {
		t.Errorf("knowledge graph recommended gap = %v", kg.MissingRecommended)
	}
	classic := serviceSignalOf(t, result.Readiness, cart, finding.SignalTraces, "application-observability")
	if classic.Readiness != (scoring.Ratio{Numerator: 1, Denominator: 3}) || !slices.Equal(classic.Missing, []string{"deployment.environment", "telemetry.sdk.name"}) {
		t.Errorf("classic readiness = %+v, want 1/3 with only deployment.environment.name not counting", classic)
	}
	for _, row := range result.Owners {
		if row.Owner == cart && row.Signal == finding.SignalTraces && row.Scores.RequiredResource != (scoring.Ratio{Numerator: 3, Denominator: 4}) {
			t.Errorf("required_resource = %+v, want 3/4 from the four defaults only", row.Scores.RequiredResource)
		}
	}
}

func Test_resourceCollector_readinessOnMetricSeriesFlags(t *testing.T) {
	metricsProduct := product.Product{ID: "test", Name: "Test", Requirements: []product.Requirement{
		{Signal: finding.SignalMetrics, Attribute: "deployment.environment.name", Alternatives: []string{"deployment.environment"}, Level: product.LevelRequired},
	}}
	checked := []string{"deployment.environment.name", "deployment.environment"}
	cases := []struct {
		name            string
		labels          map[string]string
		checkedOnSeries []string
		wantPresent     []string
		wantMissing     []string
		wantUnknown     []string
	}{
		{
			name:            "both names checked and neither flagged",
			labels:          map[string]string{"job": "shop/checkout"},
			checkedOnSeries: checked,
			wantPresent:     []string{}, wantMissing: []string{"deployment.environment.name"}, wantUnknown: []string{},
		},
		{
			name:            "only the current name checked and not flagged",
			labels:          map[string]string{"job": "shop/checkout"},
			checkedOnSeries: checked[:1],
			wantPresent:     []string{}, wantMissing: []string{}, wantUnknown: []string{"deployment.environment.name"},
		},
		{
			name:            "the deprecated name flagged on the series",
			labels:          map[string]string{"job": "shop/checkout", "semconv_has_deployment_environment": "1"},
			checkedOnSeries: checked,
			wantPresent:     []string{"deployment.environment.name"}, wantMissing: []string{}, wantUnknown: []string{},
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			var collector resourceCollector
			collector.observe(checkout, finding.SignalMetrics, metricResource(checkout, tc.labels, nil, tc.checkedOnSeries))

			row := readinessOf(t, collector.readiness([]product.Product{metricsProduct}), checkout, finding.SignalMetrics, "test")

			if !slices.Equal(row.Present, tc.wantPresent) || !slices.Equal(row.Missing, tc.wantMissing) || !slices.Equal(row.Unknown, tc.wantUnknown) {
				t.Errorf("present %v missing %v unknown %v", row.Present, row.Missing, row.Unknown)
			}
		})
	}
}

func Test_Assess_readinessIsNotCheckableWhenNoResourceKeysWereRead(t *testing.T) {
	inventory := Inventory{Traces: []TraceDatasource{{UID: "tempo", Services: []TraceService{
		{ServiceName: "cart", SpanCount: 5},
	}}}}
	cart := finding.Owner{Kind: finding.OwnerService, Name: "cart"}

	result := newAssessor(t).Assess(inventory, scoringDefaults)

	for _, productID := range []string{"application-observability", "knowledge-graph"} {
		row := serviceSignalOf(t, result.Readiness, cart, finding.SignalTraces, productID)
		if _, defined := row.Readiness.Value(); defined {
			t.Errorf("%s readiness = %+v, want not checkable", productID, row)
		}
		if len(row.Unknown) == 0 || len(row.Missing) != 0 {
			t.Errorf("%s missing %v unknown %v", productID, row.Missing, row.Unknown)
		}
	}
}

func Test_serviceReadiness(t *testing.T) {
	alias := finding.Owner{Kind: finding.OwnerService, Name: "checkout"}
	cart := finding.Owner{Kind: finding.OwnerService, Name: "cart"}
	row := func(owner finding.Owner, signal finding.Signal, present, missing, unknown, recommended []string) ProductReadiness {
		return ProductReadiness{
			Key: scoring.Key{Owner: owner, Signal: signal}, Product: "knowledge-graph", ProductName: "Knowledge Graph",
			Present: present, Missing: missing, Unknown: unknown, MissingRecommended: recommended,
		}
	}
	ratio := func(numerator, denominator float64) scoring.Ratio {
		return scoring.Ratio{Numerator: numerator, Denominator: denominator}
	}
	notCheckable := scoring.Ratio{}
	tests := []struct {
		name        string
		rows        []ProductReadiness
		wantSignals map[finding.Signal]scoring.Ratio
		wantOverall scoring.Ratio
	}{
		{name: "fully ready", rows: []ProductReadiness{
			row(checkout, finding.SignalTraces, []string{"service.name", "service.namespace"}, nil, nil, nil),
		}, wantSignals: map[finding.Signal]scoring.Ratio{finding.SignalTraces: ratio(2, 2)}, wantOverall: ratio(2, 2)},
		{name: "partially ready", rows: []ProductReadiness{
			row(checkout, finding.SignalTraces, []string{"service.name", "service.namespace"}, []string{"deployment.environment.name"}, nil, nil),
		}, wantSignals: map[finding.Signal]scoring.Ratio{finding.SignalTraces: ratio(2, 3)}, wantOverall: ratio(2, 3)},
		{name: "every requirement unknown is not checkable", rows: []ProductReadiness{
			row(checkout, finding.SignalMetrics, nil, nil, []string{"service.instance.id"}, nil),
		}, wantSignals: map[finding.Signal]scoring.Ratio{finding.SignalMetrics: notCheckable}, wantOverall: notCheckable},
		{name: "present with unknown and nothing missing is not checkable", rows: []ProductReadiness{
			row(checkout, finding.SignalTraces, []string{"service.name"}, nil, []string{"deployment.environment.name"}, nil),
		}, wantSignals: map[finding.Signal]scoring.Ratio{finding.SignalTraces: notCheckable}, wantOverall: notCheckable},
		{name: "missing and unknown together count the checked attributes", rows: []ProductReadiness{
			row(checkout, finding.SignalTraces, []string{"service.name"}, []string{"service.namespace"}, []string{"deployment.environment.name"}, nil),
		}, wantSignals: map[finding.Signal]scoring.Ratio{finding.SignalTraces: ratio(1, 2)}, wantOverall: ratio(1, 2)},
		{name: "overall sums attribute and signal pairs", rows: []ProductReadiness{
			row(checkout, finding.SignalTraces, []string{"service.name"}, []string{"service.namespace"}, nil, nil),
			row(checkout, finding.SignalLogs, []string{"service.name", "service.namespace"}, nil, nil, nil),
		}, wantSignals: map[finding.Signal]scoring.Ratio{finding.SignalTraces: ratio(1, 2), finding.SignalLogs: ratio(2, 2)}, wantOverall: ratio(3, 4)},
		{name: "overall not checkable when nothing is missing and something is unknown", rows: []ProductReadiness{
			row(checkout, finding.SignalTraces, []string{"service.name"}, nil, nil, nil),
			row(checkout, finding.SignalMetrics, []string{"service.name"}, nil, []string{"service.instance.id"}, nil),
		}, wantSignals: map[finding.Signal]scoring.Ratio{finding.SignalTraces: ratio(1, 1), finding.SignalMetrics: notCheckable}, wantOverall: notCheckable},
		{name: "overall partial when one signal misses and another is unknown", rows: []ProductReadiness{
			row(checkout, finding.SignalTraces, []string{"service.name"}, []string{"service.namespace"}, nil, nil),
			row(checkout, finding.SignalMetrics, []string{"service.name"}, nil, []string{"service.instance.id"}, nil),
		}, wantSignals: map[finding.Signal]scoring.Ratio{finding.SignalTraces: ratio(1, 2), finding.SignalMetrics: notCheckable}, wantOverall: ratio(2, 3)},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			services := serviceReadiness(tt.rows)
			if len(services) != 1 {
				t.Fatalf("services = %+v, want one", services)
			}
			if services[0].Overall != tt.wantOverall {
				t.Errorf("overall = %+v, want %+v", services[0].Overall, tt.wantOverall)
			}
			for signal, want := range tt.wantSignals {
				if got := serviceSignalOf(t, services, checkout, signal, "knowledge-graph").Readiness; got != want {
					t.Errorf("%s = %+v, want %+v", signal, got, want)
				}
			}
		})
	}

	t.Run("a present attribute on one alias wins and recommended gaps must be shared", func(t *testing.T) {
		services := serviceReadiness([]ProductReadiness{
			row(checkout, finding.SignalMetrics, []string{"service.name"}, []string{"service.instance.id"}, nil, []string{"k8s.pod.name"}),
			row(alias, finding.SignalMetrics, []string{"service.instance.id"}, nil, []string{"service.name"}, nil),
		})
		got := serviceSignalOf(t, services, alias, finding.SignalMetrics, "knowledge-graph")
		if !slices.Equal(got.Present, []string{"service.name", "service.instance.id"}) || len(got.Missing) != 0 || len(got.Unknown) != 0 || len(got.MissingRecommended) != 0 || got.Readiness != ratio(2, 2) {
			t.Errorf("merged = %+v", got)
		}
	})

	t.Run("other services stay separate", func(t *testing.T) {
		services := serviceReadiness([]ProductReadiness{
			row(checkout, finding.SignalLogs, []string{"service.name"}, nil, nil, nil),
			row(cart, finding.SignalLogs, nil, []string{"service.name"}, nil, nil),
		})
		if len(services) != 2 || serviceSignalOf(t, services, cart, finding.SignalLogs, "knowledge-graph").Readiness != ratio(0, 1) {
			t.Errorf("services = %+v", services)
		}
	})

	t.Run("a single row is normalised and its input is left untouched", func(t *testing.T) {
		input := row(checkout, finding.SignalTraces, []string{"service.name", "service.name"}, []string{"service.name", "service.namespace"}, nil, []string{"k8s.pod.name", "k8s.pod.name"})
		before := slices.Clone(input.Missing)

		got := serviceSignalOf(t, serviceReadiness([]ProductReadiness{input}), checkout, finding.SignalTraces, "knowledge-graph")

		if !slices.Equal(got.Present, []string{"service.name"}) || !slices.Equal(got.Missing, []string{"service.namespace"}) || !slices.Equal(got.MissingRecommended, []string{"k8s.pod.name"}) {
			t.Errorf("normalised = %+v", got)
		}
		if got.Unknown == nil || got.Readiness != ratio(1, 2) {
			t.Errorf("unknown = %#v, readiness %+v", got.Unknown, got.Readiness)
		}
		if !slices.Equal(input.Missing, before) {
			t.Errorf("input mutated to %v", input.Missing)
		}
	})
}
