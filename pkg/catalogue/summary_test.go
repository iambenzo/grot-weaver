package catalogue

import "testing"

func Test_Summary_countsDeprecatedSeparatelyFromStability(t *testing.T) {
	loaded := New(Manifest{}, Registry{
		Attributes: []Attribute{
			{Name: "a", Stability: StabilityStable},
			{Name: "b", Stability: StabilityReleaseCandidate},
			{Name: "c", Stability: StabilityDevelopment},
			{Name: "d", Stability: StabilityAlpha},
			{Name: "e", Stability: StabilityStable, Deprecated: &Deprecation{Reason: "obsoleted"}},
		},
		Metrics: []Metric{{Name: "m", Stability: StabilityDevelopment, Deprecated: &Deprecation{Reason: "renamed"}}},
	}, RenameHistory{})

	summary := loaded.Summary()

	want := StabilityBreakdown{Stable: 1, ReleaseCandidate: 1, Development: 1, Alpha: 1, Deprecated: 1}
	if summary.Stability.Attributes != want {
		t.Errorf("attributes = %+v, want %+v", summary.Stability.Attributes, want)
	}
	if summary.Stability.Metrics != (StabilityBreakdown{Deprecated: 1}) {
		t.Errorf("metrics = %+v", summary.Stability.Metrics)
	}
	if summary.Counts.Attributes != 5 || summary.Counts.Metrics != 1 {
		t.Errorf("counts = %+v", summary.Counts)
	}
}

func Test_LoadEmbedded_matchesGeneratedData(t *testing.T) {
	embedded, err := LoadEmbedded()
	if err != nil {
		t.Fatal(err)
	}
	onDisk := loadGenerated(t)

	if embedded.Summary() != onDisk.Summary() {
		t.Errorf("embedded summary %+v differs from data/ %+v", embedded.Summary(), onDisk.Summary())
	}
}
