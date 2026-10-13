package catalogue

import (
	"slices"
	"testing"
)

func Test_Overlay_replacesMatchingKeysInPlaceAndAppendsNewOnes(t *testing.T) {
	moved := &Deprecation{Reason: "uncategorized", Note: "Moved"}
	base := Registry{
		Attributes: []Attribute{
			{Name: "http.request.method", Source: SourceCore},
			{Name: "gen_ai.request.model", Deprecated: moved, Source: SourceCore},
			{Name: "gen_ai.system", Deprecated: moved, Source: SourceCore},
		},
		Spans: []Span{{ID: "span.gen_ai.inference.client", Source: SourceCore}},
	}
	override := Registry{
		Attributes: []Attribute{
			{Name: "gen_ai.usage.text.input_tokens", Source: SourceGenAI},
			{Name: "gen_ai.request.model", Source: SourceGenAI},
		},
		Spans: []Span{{ID: "span.gen_ai.inference.client", Source: SourceGenAI}},
	}

	merged := Overlay(base, override)

	gotNames := make([]string, 0, len(merged.Attributes))
	for _, attribute := range merged.Attributes {
		gotNames = append(gotNames, attribute.Name)
	}
	wantNames := []string{"http.request.method", "gen_ai.request.model", "gen_ai.system", "gen_ai.usage.text.input_tokens"}
	if !slices.Equal(gotNames, wantNames) {
		t.Fatalf("names = %v, want %v", gotNames, wantNames)
	}

	replaced := merged.Attributes[1]
	if replaced.Source != SourceGenAI || replaced.Deprecated != nil {
		t.Errorf("gen_ai.request.model = %+v, want genai definition without deprecation", replaced)
	}
	notRedefined := merged.Attributes[2]
	if notRedefined.Source != SourceCore || notRedefined.Deprecated != moved {
		t.Errorf("gen_ai.system = %+v, want core definition kept with its deprecation", notRedefined)
	}
	if merged.Spans[0].Source != SourceGenAI {
		t.Errorf("span source = %q, want genai", merged.Spans[0].Source)
	}
}

func Test_Overlay_keepsOneEntryWhenOverrideRepeatsAKey(t *testing.T) {
	override := Registry{Metrics: []Metric{{Name: "m", Unit: "s"}, {Name: "m", Unit: "ms"}}}

	merged := Overlay(Registry{}, override)

	if len(merged.Metrics) != 1 || merged.Metrics[0].Unit != "ms" {
		t.Errorf("metrics = %+v, want a single last definition", merged.Metrics)
	}
}
