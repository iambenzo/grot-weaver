package catalogue

import (
	"encoding/json"
	"os"
	"strings"
	"testing"
	"testing/fstest"
)

func loadGenerated(t *testing.T) *Catalogue {
	t.Helper()
	loaded, err := Load(os.DirFS("data"))
	if err != nil {
		t.Fatal(err)
	}
	return loaded
}

func findAttribute(t *testing.T, c *Catalogue, name string) Attribute {
	t.Helper()
	for _, attribute := range c.Registry.Attributes {
		if attribute.Name == name {
			return attribute
		}
	}
	t.Fatalf("attribute %q not in catalogue", name)
	return Attribute{}
}

func findMetric(t *testing.T, c *Catalogue, name string) Metric {
	t.Helper()
	for _, metric := range c.Registry.Metrics {
		if metric.Name == name {
			return metric
		}
	}
	t.Fatalf("metric %q not in catalogue", name)
	return Metric{}
}

func Test_Load_generatedData_genAIReplacesMovedCoreEntries(t *testing.T) {
	loaded := loadGenerated(t)

	model := findAttribute(t, loaded, "gen_ai.request.model")
	if model.Deprecated != nil || model.Source != SourceGenAI {
		t.Errorf("gen_ai.request.model = %+v, want genai definition, not deprecated", model)
	}

	tokenUsage := findMetric(t, loaded, "gen_ai.client.token.usage")
	if tokenUsage.Source != SourceCore || tokenUsage.Deprecated == nil || !strings.Contains(tokenUsage.Deprecated.Note, "semantic-conventions-genai") {
		t.Errorf("gen_ai.client.token.usage = %+v, want core definition deprecated with the moved note", tokenUsage)
	}

	textTokens := findAttribute(t, loaded, "gen_ai.usage.text.input_tokens")
	if textTokens.Source != SourceGenAI {
		t.Errorf("gen_ai.usage.text.input_tokens source = %q, want genai", textTokens.Source)
	}

	method := findAttribute(t, loaded, "http.request.method")
	if method.Source != SourceCore || method.Stability != StabilityStable {
		t.Errorf("http.request.method = %+v, want stable core attribute", method)
	}
}

func Test_Load_generatedData_everyEntryHasASource(t *testing.T) {
	loaded := loadGenerated(t)

	for _, attribute := range loaded.Registry.Attributes {
		if attribute.Source == "" {
			t.Fatalf("attribute %q has no source", attribute.Name)
		}
	}
	for _, metric := range loaded.Registry.Metrics {
		if metric.Source == "" {
			t.Fatalf("metric %q has no source", metric.Name)
		}
	}
}

func Test_Load_generatedData_manifestNamesBothRegistries(t *testing.T) {
	manifest := loadGenerated(t).Manifest

	if manifest.Semconv.Version == "" || manifest.GenAI.Commit == "" || manifest.GenAI.CommittedAt == "" {
		t.Errorf("manifest = %+v, want semconv version and genai commit with date", manifest)
	}
}

func Test_Load_reportsMissingFile(t *testing.T) {
	fsys := fstest.MapFS{
		ManifestFile: {Data: []byte(`{}`)},
		CoreFile:     {Data: []byte(`{}`)},
	}

	_, err := Load(fsys)

	if err == nil || !strings.Contains(err.Error(), GenAIFile) {
		t.Errorf("err = %v, want it to name %s", err, GenAIFile)
	}
}

func Test_RequirementLevel_UnmarshalJSON(t *testing.T) {
	tests := []struct {
		name        string
		input       string
		want        RequirementLevel
		wantFailure bool
	}{
		{name: "plain level", input: `"required"`, want: RequirementLevel{Level: "required"}},
		{name: "conditional level", input: `{"conditionally_required":"if an error occurred"}`, want: RequirementLevel{Level: "conditionally_required", Condition: "if an error occurred"}},
		{name: "rejects two keys", input: `{"a":"x","b":"y"}`, wantFailure: true},
		{name: "rejects number", input: `3`, wantFailure: true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			var got RequirementLevel
			err := json.Unmarshal([]byte(tt.input), &got)
			if tt.wantFailure {
				if err == nil {
					t.Fatalf("expected error, got %+v", got)
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			if got != tt.want {
				t.Errorf("got %+v, want %+v", got, tt.want)
			}
		})
	}
}
