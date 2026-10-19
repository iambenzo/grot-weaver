package finding

import (
	"testing"

	"github.com/iambenzo/grot-weaver/pkg/catalogue"
	"github.com/iambenzo/grot-weaver/pkg/nameindex"
)

var checkout = Owner{Kind: OwnerService, Namespace: "shop", Name: "checkout"}

func embeddedCatalogue(t *testing.T) *catalogue.Catalogue {
	t.Helper()
	loaded, err := catalogue.LoadEmbedded()
	if err != nil {
		t.Fatal(err)
	}
	return loaded
}

func Test_Classifier_Attribute_bucketsAndTypes(t *testing.T) {
	loaded := embeddedCatalogue(t)
	classifier := NewClassifier(loaded)
	index := nameindex.NewAttributeIndex(loaded, nil)

	tests := []struct {
		observed     string
		scope        catalogue.RenameScope
		wantType     Type
		wantBucket   Bucket
		wantExpected string
	}{
		{observed: "http.method", scope: catalogue.ScopeSpans, wantType: TypeDeprecated, wantBucket: BucketStable, wantExpected: "http.request.method"},
		{observed: "net.peer.name", scope: catalogue.ScopeSpans, wantType: TypeDeprecated, wantBucket: BucketExperimental},
		{observed: "exception.escaped", scope: catalogue.ScopeSpans, wantType: TypeDeprecated, wantBucket: BucketStable},
		{observed: "http_request_method", scope: catalogue.ScopeMetrics, wantType: TypeConformant, wantBucket: BucketStable, wantExpected: "http.request.method"},
		{observed: "cicd.pipeline.name", scope: catalogue.ScopeSpans, wantType: TypeConformant, wantBucket: BucketReleaseCandidate, wantExpected: "cicd.pipeline.name"},
		{observed: "gen_ai.request.model", scope: catalogue.ScopeSpans, wantType: TypeConformant, wantBucket: BucketExperimental, wantExpected: "gen_ai.request.model"},
		{observed: "browser.user_agent", scope: catalogue.ScopeResources, wantType: TypeDeprecated, wantBucket: BucketStable, wantExpected: "user_agent.original"},
		{observed: "http.request.colour", scope: catalogue.ScopeSpans, wantType: TypeNotInRegistry, wantBucket: BucketUnclassified},
		{observed: "billingid", scope: catalogue.ScopeMetrics, wantType: TypeCustom},
	}
	for _, tt := range tests {
		t.Run(tt.observed, func(t *testing.T) {
			match := index.Match(tt.observed, nameindex.Context{Scope: tt.scope})

			got := classifier.Attribute(Observation{Owner: checkout, Signal: SignalTraces, Volume: 3}, match, tt.scope)

			if match.Attribute != nil && got.Matched != match.Attribute.Name {
				t.Errorf("matched = %q, want %q", got.Matched, match.Attribute.Name)
			}
			if got.Type != tt.wantType || got.Bucket != tt.wantBucket || got.Expected != tt.wantExpected {
				t.Errorf("got type %s bucket %s expected %q, want %s %s %q", got.Type, got.Bucket, got.Expected, tt.wantType, tt.wantBucket, tt.wantExpected)
			}
			if got.Level != LevelOf(tt.wantType) || got.Owner != checkout || got.Volume != 3 {
				t.Errorf("finding metadata wrong: %+v", got)
			}
		})
	}
}

func Test_Classifier_Attribute_deprecationWithoutReplacementKeepsNote(t *testing.T) {
	loaded := embeddedCatalogue(t)
	match := nameindex.NewAttributeIndex(loaded, nil).Match("net.peer.name", nameindex.Context{Scope: catalogue.ScopeSpans})

	got := NewClassifier(loaded).Attribute(Observation{Owner: checkout, Signal: SignalTraces}, match, catalogue.ScopeSpans)

	if got.Note == "" || got.Expected != "" {
		t.Errorf("got %+v, want the registry note and no expected name", got)
	}
}

func Test_Classifier_bucket_followsReplacementChains(t *testing.T) {
	loaded := catalogue.New(catalogue.Manifest{}, catalogue.Registry{Attributes: []catalogue.Attribute{
		{Name: "a.old", Stability: catalogue.StabilityDevelopment, Deprecated: &catalogue.Deprecation{Reason: "renamed", RenamedTo: "a.mid"}},
		{Name: "a.mid", Stability: catalogue.StabilityDevelopment, Deprecated: &catalogue.Deprecation{Reason: "renamed", RenamedTo: "a.new"}},
		{Name: "a.new", Stability: catalogue.StabilityReleaseCandidate},
		{Name: "a.orphan", Stability: catalogue.StabilityStable, Deprecated: &catalogue.Deprecation{Reason: "renamed", RenamedTo: "a.missing"}},
	}}, catalogue.RenameHistory{})
	classifier := NewClassifier(loaded)

	tests := []struct {
		name string
		want Bucket
	}{
		{name: "a.old", want: BucketReleaseCandidate},
		{name: "a.orphan", want: BucketStable},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			attribute, _ := loaded.Attribute(tt.name, catalogue.ScopeSpans, "")
			if got := classifier.AttributeBucket(attribute, catalogue.ScopeSpans); got != tt.want {
				t.Errorf("bucket = %s, want %s", got, tt.want)
			}
		})
	}
}

func Test_Classifier_Metric_andNearMiss(t *testing.T) {
	loaded := embeddedCatalogue(t)
	classifier := NewClassifier(loaded)
	index := nameindex.NewMetricIndex(loaded)
	at := Observation{Owner: checkout, Signal: SignalMetrics, Volume: 10}

	conformant := classifier.Metric(at, index.Match("http_server_request_duration_seconds_bucket"))
	if conformant.Type != TypeConformant || conformant.Bucket != BucketStable || conformant.Expected != "http.server.request.duration" {
		t.Errorf("conformant = %+v", conformant)
	}

	miss, _ := index.NearMiss("http_server_request_duration_milliseconds_bucket")
	mismatch := classifier.NearMiss(at, miss)
	if mismatch.Type != TypeUnitMismatch || mismatch.Bucket != BucketStable || mismatch.Expected != "http.server.request.duration" || mismatch.Note == "" {
		t.Errorf("unit mismatch = %+v", mismatch)
	}

	historic, _ := index.NearMiss("http_server_duration_milliseconds_bucket")
	renamed := classifier.NearMiss(at, historic)
	if renamed.Type != TypeDeprecated || renamed.Bucket != BucketStable || renamed.Expected != "http.server.request.duration" || renamed.Confidence != nameindex.ConfidenceMedium {
		t.Errorf("history near miss = %+v", renamed)
	}
}

func Test_Classifier_Attribute_recordsScope(t *testing.T) {
	loaded := embeddedCatalogue(t)
	match := nameindex.NewAttributeIndex(loaded, nil).Match("service.name", nameindex.Context{Scope: catalogue.ScopeResources})

	got := NewClassifier(loaded).Attribute(Observation{Owner: checkout, Signal: SignalTraces}, match, catalogue.ScopeResources)

	if got.Scope != catalogue.ScopeResources {
		t.Errorf("scope = %q, want resources", got.Scope)
	}
}
