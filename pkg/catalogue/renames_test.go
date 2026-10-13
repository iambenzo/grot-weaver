package catalogue

import "testing"

func Test_RenameHistory_ResolveAttribute(t *testing.T) {
	history := RenameHistory{Attributes: []AttributeRename{
		{From: "b", To: "c", Version: "1.20.0", Scope: ScopeAll},
		{From: "a", To: "b", Version: "1.10.0", Scope: ScopeAll},
		{From: "http.method", To: "http.request.method", Version: "1.21.0", Scope: ScopeSpans},
		{From: "db.name", To: "db.namespace", Version: "1.26.0", Scope: ScopeMetrics, Metrics: []string{"db.client.connection.count"}},
	}}.inVersionOrder()

	tests := []struct {
		name        string
		attribute   string
		scope       RenameScope
		metric      string
		want        string
		wantRenamed bool
	}{
		{name: "chain resolves to latest name", attribute: "a", scope: ScopeSpans, want: "c", wantRenamed: true},
		{name: "span rename applies on spans", attribute: "http.method", scope: ScopeSpans, want: "http.request.method", wantRenamed: true},
		{name: "span rename ignored on metrics", attribute: "http.method", scope: ScopeMetrics, want: "http.method"},
		{name: "metric-scoped rename applies to listed metric", attribute: "db.name", scope: ScopeMetrics, metric: "db.client.connection.count", want: "db.namespace", wantRenamed: true},
		{name: "metric-scoped rename ignored for other metric", attribute: "db.name", scope: ScopeMetrics, metric: "other", want: "db.name"},
		{name: "unknown attribute unchanged", attribute: "service.name", scope: ScopeResources, want: "service.name"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, renamed := history.ResolveAttribute(tt.attribute, tt.scope, tt.metric)
			if got != tt.want || renamed != tt.wantRenamed {
				t.Errorf("got (%q, %v), want (%q, %v)", got, renamed, tt.want, tt.wantRenamed)
			}
		})
	}
}

func Test_RenameHistory_ResolveMetric_followsChains(t *testing.T) {
	history := RenameHistory{Metrics: []MetricRename{
		{From: "y", To: "z", Version: "1.30.0"},
		{From: "x", To: "y", Version: "1.9.0"},
	}}.inVersionOrder()

	got, renamed := history.ResolveMetric("x")

	if got != "z" || !renamed {
		t.Errorf("got (%q, %v), want (\"z\", true)", got, renamed)
	}
}

func Test_CompareVersions_isNumeric(t *testing.T) {
	if CompareVersions("1.9.0", "1.10.0") >= 0 {
		t.Error("1.9.0 should sort before 1.10.0")
	}
	if CompareVersions("v1.41.1", "1.41.0") <= 0 {
		t.Error("1.41.1 should sort after 1.41.0")
	}
}

func Test_Load_generatedData_resolvesKnownRenames(t *testing.T) {
	renames := loadGenerated(t).Renames

	if got, _ := renames.ResolveAttribute("http.method", ScopeSpans, ""); got != "http.request.method" {
		t.Errorf("http.method on spans resolves to %q", got)
	}
	if got, _ := renames.ResolveMetric("http.server.request.size"); got != "http.server.request.body.size" {
		t.Errorf("http.server.request.size resolves to %q", got)
	}
	if got, _ := renames.ResolveAttribute("telemetry.auto.version", ScopeResources, ""); got != "telemetry.distro.version" {
		t.Errorf("telemetry.auto.version on resources resolves to %q", got)
	}
}

func Test_Catalogue_Attribute_reportsHistoryOnlyNamesAsDeprecated(t *testing.T) {
	loaded := loadGenerated(t)

	historyOnly, found := loaded.Attribute("browser.user_agent", ScopeResources, "")
	if !found || historyOnly.Source != SourceRenameHistory || historyOnly.Deprecated == nil || historyOnly.Deprecated.RenamedTo != "user_agent.original" {
		t.Errorf("browser.user_agent = %+v (found %v), want deprecated rename to user_agent.original", historyOnly, found)
	}

	inRegistry, found := loaded.Attribute("http.method", ScopeSpans, "")
	if !found || inRegistry.Source != SourceCore || inRegistry.Deprecated == nil || inRegistry.Deprecated.RenamedTo != "http.request.method" {
		t.Errorf("http.method = %+v, want the registry's own deprecated entry", inRegistry)
	}

	if _, found := loaded.Attribute("my.custom.thing", ScopeSpans, ""); found {
		t.Error("unknown attribute should not be found")
	}
}

func Test_Catalogue_Metric_reportsHistoryOnlyNamesAsDeprecated(t *testing.T) {
	loaded := loadGenerated(t)

	historyOnly, found := loaded.Metric("http.server.duration")
	if !found || historyOnly.Source != SourceRenameHistory || historyOnly.Deprecated == nil || historyOnly.Deprecated.RenamedTo == "" {
		t.Errorf("http.server.duration = %+v (found %v), want deprecated with a current name", historyOnly, found)
	}

	current, found := loaded.Metric("http.server.request.duration")
	if !found || current.Deprecated != nil || current.Stability != StabilityStable {
		t.Errorf("http.server.request.duration = %+v, want stable registry metric", current)
	}
}
