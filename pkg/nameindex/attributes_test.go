package nameindex

import (
	"testing"

	"github.com/iambenzo/grot-weaver/pkg/catalogue"
)

func loadCatalogue(t *testing.T) *catalogue.Catalogue {
	t.Helper()
	loaded, err := catalogue.LoadEmbedded()
	if err != nil {
		t.Fatal(err)
	}
	return loaded
}

func Test_AttributeIndex_Match_generatedCatalogue(t *testing.T) {
	index := NewAttributeIndex(loadCatalogue(t), []string{"acme"})

	tests := []struct {
		name            string
		observed        string
		wantClass       Classification
		wantAttribute   string
		wantForm        Form
		wantDeprecated  bool
		wantTemplate    bool
		wantRenamedTo   string
		wantFromHistory bool
		scope           catalogue.RenameScope
		metric          string
	}{
		{name: "current dotted", observed: "http.request.method", wantClass: ClassMatched, wantAttribute: "http.request.method", wantForm: FormDotted},
		{name: "current underscore", observed: "http_request_method", wantClass: ClassMatched, wantAttribute: "http.request.method", wantForm: FormUnderscore},
		{name: "deprecated underscore", observed: "http_method", wantClass: ClassMatched, wantAttribute: "http.method", wantForm: FormUnderscore, wantDeprecated: true, wantRenamedTo: "http.request.method"},
		{name: "deprecated dotted", observed: "deployment.environment", wantClass: ClassMatched, wantAttribute: "deployment.environment", wantForm: FormDotted, wantDeprecated: true, wantRenamedTo: "deployment.environment.name"},
		{name: "template dotted", observed: "http.request.header.content-type", wantClass: ClassMatched, wantAttribute: "http.request.header", wantForm: FormDotted, wantTemplate: true},
		{name: "template underscore", observed: "http_request_header_content_type", wantClass: ClassMatched, wantAttribute: "http.request.header", wantForm: FormUnderscore, wantTemplate: true},
		{name: "rename history only", observed: "browser_user_agent", scope: catalogue.ScopeResources, wantClass: ClassMatched, wantAttribute: "browser.user_agent", wantForm: FormUnderscore, wantDeprecated: true, wantRenamedTo: "user_agent.original", wantFromHistory: true},
		{name: "metric-scoped history applies to its metric", observed: "action", scope: catalogue.ScopeMetrics, metric: "jvm.gc.duration", wantClass: ClassMatched, wantAttribute: "action", wantForm: FormDotted, wantDeprecated: true, wantRenamedTo: "jvm.gc.action", wantFromHistory: true},
		{name: "metric-scoped history ignored for other metrics", observed: "action", scope: catalogue.ScopeMetrics, metric: "http.server.request.duration", wantClass: ClassCustom},
		{name: "metric-scoped history ignored on spans", observed: "state", scope: catalogue.ScopeSpans, wantClass: ClassCustom},
		{name: "namespace-less registry attribute matches only where its rename applies", observed: "state", scope: catalogue.ScopeMetrics, metric: "db.client.connections.usage", wantClass: ClassMatched, wantAttribute: "state", wantForm: FormDotted, wantDeprecated: true, wantRenamedTo: "db.client.connection.state"},
		{name: "namespace-less registry attribute ignored elsewhere", observed: "state", scope: catalogue.ScopeMetrics, metric: "hw.status", wantClass: ClassCustom},
		{name: "unknown key in registry namespace", observed: "http.request.colour", wantClass: ClassNotInRegistry},
		{name: "unknown underscore key in registry namespace", observed: "gen_ai_request_colour", wantClass: ClassNotInRegistry},
		{name: "outside registry namespaces", observed: "billingid", wantClass: ClassCustom},
		{name: "namespace word alone is custom", observed: "source", wantClass: ClassCustom},
		{name: "org allowlist wins", observed: "acme.http.thing", wantClass: ClassCustom},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			match := index.Match(tt.observed, Context{Scope: tt.scope, Metric: tt.metric})

			if match.Classification != tt.wantClass {
				t.Fatalf("classification = %q, want %q (%+v)", match.Classification, tt.wantClass, match)
			}
			if tt.wantClass != ClassMatched {
				return
			}
			got := match.Attribute
			if got.Name != tt.wantAttribute || match.Form != tt.wantForm || match.ViaTemplate != tt.wantTemplate {
				t.Errorf("got %s form %s template %v, want %s form %s template %v", got.Name, match.Form, match.ViaTemplate, tt.wantAttribute, tt.wantForm, tt.wantTemplate)
			}
			if (got.Deprecated != nil) != tt.wantDeprecated {
				t.Errorf("deprecated = %v, want %v", got.Deprecated != nil, tt.wantDeprecated)
			}
			if tt.wantRenamedTo != "" && got.Deprecated.RenamedTo != tt.wantRenamedTo {
				t.Errorf("renamed_to = %q, want %q", got.Deprecated.RenamedTo, tt.wantRenamedTo)
			}
			if (got.Source == catalogue.SourceRenameHistory) != tt.wantFromHistory {
				t.Errorf("source = %q", got.Source)
			}
		})
	}
}

func Test_AttributeIndex_Match_ambiguousUnderscoreForms(t *testing.T) {
	deprecated := &catalogue.Deprecation{Reason: "renamed"}
	tests := []struct {
		name           string
		attributes     []catalogue.Attribute
		wantChosen     string
		wantConfidence Confidence
		wantAlternates int
	}{
		{
			name:           "current wins over deprecated",
			attributes:     []catalogue.Attribute{{Name: "foo.bar_baz", Deprecated: deprecated}, {Name: "foo.bar.baz"}},
			wantChosen:     "foo.bar.baz",
			wantConfidence: ConfidenceHigh,
			wantAlternates: 1,
		},
		{
			name:           "only deprecated candidates are medium",
			attributes:     []catalogue.Attribute{{Name: "foo.bar_baz", Deprecated: deprecated}, {Name: "foo_bar.baz", Deprecated: deprecated}},
			wantChosen:     "foo.bar_baz",
			wantConfidence: ConfidenceMedium,
			wantAlternates: 1,
		},
		{
			name:           "two current candidates are medium",
			attributes:     []catalogue.Attribute{{Name: "foo.bar_baz"}, {Name: "foo.bar.baz"}},
			wantChosen:     "foo.bar_baz",
			wantConfidence: ConfidenceMedium,
			wantAlternates: 1,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			index := NewAttributeIndex(&catalogue.Catalogue{Registry: catalogue.Registry{Attributes: tt.attributes}}, nil)

			match := index.Match("foo_bar_baz", Context{})

			if match.Attribute == nil || match.Attribute.Name != tt.wantChosen {
				t.Fatalf("chosen = %+v, want %s", match.Attribute, tt.wantChosen)
			}
			if match.Confidence != tt.wantConfidence || len(match.Alternatives) != tt.wantAlternates {
				t.Errorf("confidence %s alternatives %d, want %s and %d", match.Confidence, len(match.Alternatives), tt.wantConfidence, tt.wantAlternates)
			}
		})
	}
}

func Test_AttributeIndex_Match_preservedDoubleUnderscores(t *testing.T) {
	index := NewAttributeIndex(&catalogue.Catalogue{Registry: catalogue.Registry{Attributes: []catalogue.Attribute{{Name: "foo._bar"}}}}, nil)

	for _, observed := range []string{"foo_bar", "foo__bar"} {
		if match := index.Match(observed, Context{}); match.Classification != ClassMatched {
			t.Errorf("%s classification = %q, want matched", observed, match.Classification)
		}
	}
}
