package main

import (
	"strings"
	"testing"

	"github.com/iambenzo/otel-semconv-compliance/pkg/catalogue"
)

func Test_summariseChanges(t *testing.T) {
	previous := catalogue.New(catalogue.Manifest{Semconv: catalogue.SemconvSource{Version: "v1.44.0"}}, catalogue.Registry{
		Attributes: []catalogue.Attribute{
			{Name: "kept", Stability: catalogue.StabilityStable},
			{Name: "promoted", Stability: catalogue.StabilityReleaseCandidate},
			{Name: "retired", Stability: catalogue.StabilityDevelopment},
			{Name: "gone", Stability: catalogue.StabilityDevelopment},
		},
	}, catalogue.RenameHistory{})
	next := catalogue.New(catalogue.Manifest{Semconv: catalogue.SemconvSource{Version: "v1.45.0"}}, catalogue.Registry{
		Attributes: []catalogue.Attribute{
			{Name: "kept", Stability: catalogue.StabilityStable},
			{Name: "promoted", Stability: catalogue.StabilityStable},
			{Name: "retired", Stability: catalogue.StabilityDevelopment, Deprecated: &catalogue.Deprecation{Reason: "obsoleted"}},
			{Name: "fresh", Stability: catalogue.StabilityDevelopment},
		},
	}, catalogue.RenameHistory{})

	summary := summariseChanges(previous, next, "kept genai commit old")

	for _, want := range []string{
		"semconv: v1.44.0 → v1.45.0",
		"GenAI: kept genai commit old",
		"- Added: 1\n  - `fresh`",
		"- Removed: 1\n  - `gone`",
		"- Newly deprecated: 1\n  - `retired`",
		"- Stability changed: 1\n  - `promoted (release_candidate → stable)`",
	} {
		if !strings.Contains(summary, want) {
			t.Errorf("summary missing %q:\n%s", want, summary)
		}
	}
}

func Test_summariseChanges_withoutPreviousCatalogue(t *testing.T) {
	next := catalogue.New(catalogue.Manifest{Semconv: catalogue.SemconvSource{Version: "v1.44.0"}}, catalogue.Registry{}, catalogue.RenameHistory{})

	if summary := summariseChanges(nil, next, "x"); !strings.Contains(summary, "(none) → v1.44.0") {
		t.Errorf("summary = %s", summary)
	}
}
