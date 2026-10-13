package assessment

import (
	"encoding/json"
	"errors"
	"os"
	"strings"
	"testing"

	"github.com/iambenzo/otel-semconv-compliance/pkg/catalogue"
	"github.com/iambenzo/otel-semconv-compliance/pkg/finding"
	"github.com/iambenzo/otel-semconv-compliance/pkg/scoring"
)

type tempoTags struct {
	Scopes []struct {
		Name string   `json:"name"`
		Tags []string `json:"tags"`
	} `json:"scopes"`
}

func keysFromFixture(t *testing.T, path string) []KeyObservation {
	t.Helper()
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var tags tempoTags
	if err := json.Unmarshal(raw, &tags); err != nil {
		t.Fatal(err)
	}
	var keys []KeyObservation
	for _, scope := range tags.Scopes {
		for _, tag := range scope.Tags {
			keys = append(keys, KeyObservation{Key: tag})
		}
	}
	return keys
}

func newAssessor(t *testing.T) *Assessor {
	t.Helper()
	loaded, err := catalogue.LoadEmbedded()
	if err != nil {
		t.Fatal(err)
	}
	return NewAssessor(loaded, nil)
}

func findingFor(result Result, owner, observed string) (finding.Finding, bool) {
	for _, ranked := range result.Findings {
		if ranked.Owner.Name == owner && ranked.Observed == observed {
			return ranked.Finding, true
		}
	}
	return finding.Finding{}, false
}

func Test_Assess_localTempoFixture(t *testing.T) {
	inventory := Inventory{Traces: []TraceDatasource{{
		UID: "tempo",
		Services: []TraceService{
			{
				ServiceName: "checkout", ServiceNamespace: "shop", SpanCount: 100,
				ResourceKeys: keysFromFixture(t, "../../testdata/fixtures/local/tempo/tags-resource.json"),
				SpanKeys:     keysFromFixture(t, "../../testdata/fixtures/local/tempo/tags-span.json"),
			},
			{ServiceName: "", SpanCount: 5, SpanKeys: []KeyObservation{{Key: "http.method"}}},
		},
	}}}

	result := newAssessor(t).Assess(inventory, scoringDefaults)

	tests := []struct {
		owner, observed string
		wantType        finding.Type
		wantExpected    string
	}{
		{owner: "checkout", observed: "http.method", wantType: finding.TypeDeprecated, wantExpected: "http.request.method"},
		{owner: "checkout", observed: "http.status_code", wantType: finding.TypeDeprecated, wantExpected: "http.response.status_code"},
		{owner: "checkout", observed: "net.peer.name", wantType: finding.TypeDeprecated},
		{owner: "checkout", observed: "http.request.method", wantType: finding.TypeConformant, wantExpected: "http.request.method"},
		{owner: "checkout", observed: "service.name", wantType: finding.TypeConformant, wantExpected: "service.name"},
		{owner: "checkout", observed: "otelcol.pipeline", wantType: finding.TypeCustom},
		{owner: "unattributed", observed: "", wantType: finding.TypeMissingServiceName},
		{owner: "unattributed", observed: "http.method", wantType: finding.TypeDeprecated, wantExpected: "http.request.method"},
	}
	for _, tt := range tests {
		t.Run(tt.owner+"/"+tt.observed, func(t *testing.T) {
			got, found := findingFor(result, tt.owner, tt.observed)
			if !found {
				t.Fatalf("no finding for %s/%s", tt.owner, tt.observed)
			}
			if got.Type != tt.wantType || got.Expected != tt.wantExpected && tt.wantExpected != "" {
				t.Errorf("got %s expected %q, want %s %q", got.Type, got.Expected, tt.wantType, tt.wantExpected)
			}
		})
	}

	if len(result.Attributions) != 2 || result.SemconvVersion == "" {
		t.Errorf("attributions %+v version %q", result.Attributions, result.SemconvVersion)
	}
	if len(result.Signals) != 1 || result.Signals[0].Signal != finding.SignalTraces {
		t.Errorf("signals = %+v", result.Signals)
	}
	if share := result.Findings[0].ImpactShare; share <= 0 || share > 1 {
		t.Errorf("top impact share = %v", share)
	}
}

func Test_Inventory_Validate(t *testing.T) {
	tooManyKeys := make([]KeyObservation, MaxKeysPerService+1)
	for i := range tooManyKeys {
		tooManyKeys[i] = KeyObservation{Key: "k"}
	}
	tests := []struct {
		name      string
		inventory Inventory
		wantValid bool
	}{
		{name: "empty is valid", inventory: Inventory{}, wantValid: true},
		{name: "window backwards", inventory: Inventory{Window: Window{Start: 10, End: 5}}},
		{name: "datasource without uid", inventory: Inventory{Traces: []TraceDatasource{{}}}},
		{name: "empty key", inventory: Inventory{Traces: []TraceDatasource{{UID: "t", Services: []TraceService{{SpanKeys: []KeyObservation{{}}}}}}}},
		{name: "negative volume", inventory: Inventory{Traces: []TraceDatasource{{UID: "t", Services: []TraceService{{SpanCount: -1}}}}}},
		{name: "too many keys", inventory: Inventory{Traces: []TraceDatasource{{UID: "t", Services: []TraceService{{SpanKeys: tooManyKeys}}}}}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := tt.inventory.Validate()
			if tt.wantValid && err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if !tt.wantValid && !errors.Is(err, ErrInvalidInventory) {
				t.Fatalf("err = %v, want ErrInvalidInventory", err)
			}
		})
	}
}

var scoringDefaults = scoring.Options{}

func Test_Assess_reportsMisplacedAttributesWithoutScoringThem(t *testing.T) {
	inventory := Inventory{Traces: []TraceDatasource{{UID: "tempo", Services: []TraceService{{
		ServiceName:  "checkout",
		ResourceKeys: []KeyObservation{{Key: "http.request.method"}},
	}}}}}

	result := newAssessor(t).Assess(inventory, scoringDefaults)

	var types []finding.Type
	for _, ranked := range result.Findings {
		if ranked.Observed == "http.request.method" {
			types = append(types, ranked.Type)
		}
	}
	if len(types) != 2 || types[0] == types[1] {
		t.Fatalf("types = %v, want conformant and misplaced", types)
	}
	for _, row := range result.Owners {
		if row.Owner.Name == "checkout" && row.Scores.NamingStable.Denominator != 1 {
			t.Errorf("misplaced finding changed the naming score: %+v", row.Scores.NamingStable)
		}
	}
}

func Test_Assess_spanGroupRequirements(t *testing.T) {
	inventory := Inventory{Traces: []TraceDatasource{{UID: "tempo", Services: []TraceService{{
		ServiceName: "checkout",
		SpanGroups: []SpanGroupSample{
			{Group: "span.http.server", Sampled: 4, Present: map[string]int{"http.request.method": 4, "url.path": 4, "url.scheme": 1}},
			{Group: "span.unknown.group", Sampled: 3},
			{Group: "span.db.client", Sampled: 0},
		},
	}}}}}

	result := newAssessor(t).Assess(inventory, scoringDefaults)

	var required, recommended []finding.Finding
	for _, ranked := range result.Findings {
		switch ranked.Type {
		case finding.TypeRequiredAttributeMissing:
			required = append(required, ranked.Finding)
		case finding.TypeRecommendedAttributeAbsent:
			recommended = append(recommended, ranked.Finding)
		}
	}
	if len(required) != 1 || required[0].Expected != "url.scheme" || required[0].Observed != "span.http.server" || required[0].Confidence != "medium" {
		t.Fatalf("required findings = %+v", required)
	}
	if !strings.Contains(required[0].Note, "missing on 3 of 4") || !strings.Contains(required[0].Note, "removed between the service and storage") {
		t.Errorf("note = %q", required[0].Note)
	}
	if len(recommended) == 0 || recommended[0].Level != finding.LevelImprovement {
		t.Errorf("recommended findings = %+v", recommended)
	}
	for _, row := range result.Owners {
		if row.Owner.Name != "checkout" {
			continue
		}
		if row.Scores.Requirements.Numerator != 2 || row.Scores.Requirements.Denominator != 3 {
			t.Errorf("requirements = %+v, want 2 of 3", row.Scores.Requirements)
		}
	}
}

func Test_SpanGroupSample_validation(t *testing.T) {
	tests := []struct {
		name   string
		sample SpanGroupSample
		valid  bool
	}{
		{name: "consistent", sample: SpanGroupSample{Group: "span.http.server", Sampled: 2, Present: map[string]int{"url.path": 2}}, valid: true},
		{name: "presence above sample size", sample: SpanGroupSample{Group: "span.http.server", Sampled: 2, Present: map[string]int{"url.path": 3}}},
		{name: "negative sample", sample: SpanGroupSample{Group: "span.http.server", Sampled: -1}},
		{name: "no group", sample: SpanGroupSample{Sampled: 1}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			inventory := Inventory{Traces: []TraceDatasource{{UID: "t", Services: []TraceService{{SpanGroups: []SpanGroupSample{tt.sample}}}}}}
			if err := inventory.Validate(); (err == nil) != tt.valid {
				t.Errorf("err = %v, want valid %v", err, tt.valid)
			}
		})
	}
}

func Test_Assess_emptyInventoryEncodesEmptyLists(t *testing.T) {
	encoded, err := json.Marshal(newAssessor(t).Assess(Inventory{}, scoringDefaults))
	if err != nil {
		t.Fatal(err)
	}
	for _, field := range []string{"findings", "attributions", "metric_attributions", "datasources", "owners", "namespaces", "signals"} {
		if !strings.Contains(string(encoded), `"`+field+`":[]`) {
			t.Errorf("%s is not an empty list in %s", field, encoded)
		}
	}
}
