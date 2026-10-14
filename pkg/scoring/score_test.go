package scoring

import (
	"encoding/json"
	"testing"

	"github.com/iambenzo/otel-semconv-compliance/pkg/finding"
)

var (
	checkout = finding.Owner{Kind: finding.OwnerService, Namespace: "shop", Name: "checkout"}
	payments = finding.Owner{Kind: finding.OwnerService, Namespace: "shop", Name: "payments"}
	pipeline = finding.Owner{Kind: finding.OwnerPipeline, Name: "alloy-receiver"}
)

func named(owner finding.Owner, signal finding.Signal, observed string, t finding.Type, bucket finding.Bucket, volume float64) finding.Finding {
	return finding.Finding{Owner: owner, Signal: signal, Observed: observed, Type: t, Bucket: bucket, Volume: volume}
}

func value(t *testing.T, r Ratio) float64 {
	t.Helper()
	got, defined := r.Value()
	if !defined {
		t.Fatalf("ratio %+v is N/A", r)
	}
	return got
}

func Test_Score_namingScoresPerBucket(t *testing.T) {
	findings := []finding.Finding{
		named(checkout, finding.SignalTraces, "http.request.method", finding.TypeConformant, finding.BucketStable, 1),
		named(checkout, finding.SignalTraces, "http.method", finding.TypeDeprecated, finding.BucketStable, 1),
		named(checkout, finding.SignalTraces, "gen_ai.request.model", finding.TypeConformant, finding.BucketExperimental, 1),
		named(checkout, finding.SignalTraces, "http.request.colour", finding.TypeNotInRegistry, finding.BucketUnclassified, 1),
		named(checkout, finding.SignalTraces, "acme.thing", finding.TypeCustom, "", 1),
	}

	got := Score(findings, nil, nil, Options{})[Key{Owner: checkout, Signal: finding.SignalTraces}]

	if value(t, got.NamingStable) != 0.5 || value(t, got.NamingExperimental) != 1 {
		t.Errorf("stable %+v experimental %+v", got.NamingStable, got.NamingExperimental)
	}
	if _, defined := got.NamingRC.Value(); defined {
		t.Errorf("rc = %+v, want N/A", got.NamingRC)
	}
	if got.Deprecated != 1 || got.Unclassified != 1 || got.Custom != 1 {
		t.Errorf("counts = %+v", got)
	}
	if _, defined := got.Requirements.Value(); defined {
		t.Error("requirements should be N/A with no checks")
	}
}

func Test_Score_countsEachObservedNameOncePerOwner(t *testing.T) {
	findings := []finding.Finding{
		named(checkout, finding.SignalMetrics, "http_method", finding.TypeDeprecated, finding.BucketStable, 5),
		named(checkout, finding.SignalMetrics, "http_method", finding.TypeDeprecated, finding.BucketStable, 7),
		named(checkout, finding.SignalMetrics, "http_request_method", finding.TypeConformant, finding.BucketStable, 1),
	}

	got := Score(findings, nil, nil, Options{})[Key{Owner: checkout, Signal: finding.SignalMetrics}]

	if got.NamingStable.Denominator != 2 || got.Deprecated != 1 {
		t.Errorf("got %+v, want two distinct names", got)
	}
}

func Test_Score_volumeWeighting(t *testing.T) {
	findings := []finding.Finding{
		named(checkout, finding.SignalMetrics, "http_method", finding.TypeDeprecated, finding.BucketStable, 90),
		named(checkout, finding.SignalMetrics, "http_request_method", finding.TypeConformant, finding.BucketStable, 10),
	}

	weighted := Score(findings, nil, nil, Options{VolumeWeighted: true})[Key{Owner: checkout, Signal: finding.SignalMetrics}]
	unweighted := Score(findings, nil, nil, Options{})[Key{Owner: checkout, Signal: finding.SignalMetrics}]

	if value(t, weighted.NamingStable) != 0.1 || value(t, unweighted.NamingStable) != 0.5 {
		t.Errorf("weighted %+v unweighted %+v", weighted.NamingStable, unweighted.NamingStable)
	}
}

func Test_Score_requirementAndResourceChecks(t *testing.T) {
	requirements := []RequirementCheck{
		{Owner: checkout, Signal: finding.SignalTraces, Satisfied: true},
		{Owner: checkout, Signal: finding.SignalTraces, Satisfied: false},
		{Owner: checkout, Signal: finding.SignalTraces, Satisfied: true},
		{Owner: checkout, Signal: finding.SignalTraces, Satisfied: true},
	}
	resources := []ResourceCheck{
		{Owner: checkout, Signal: finding.SignalTraces, Name: "service.name present", Passed: true},
		{Owner: checkout, Signal: finding.SignalTraces, Name: "service.name not SDK default", Passed: false},
	}

	got := Score(nil, requirements, resources, Options{})[Key{Owner: checkout, Signal: finding.SignalTraces}]

	if value(t, got.Requirements) != 0.75 || value(t, got.Resource) != 0.5 {
		t.Errorf("requirements %+v resource %+v", got.Requirements, got.Resource)
	}
	if _, defined := got.NamingStable.Value(); defined {
		t.Error("naming should be N/A with no names")
	}
}

func Test_WithPresence_isSeparateFromConformance(t *testing.T) {
	findings := []finding.Finding{named(checkout, finding.SignalTraces, "http.request.method", finding.TypeConformant, finding.BucketStable, 1)}
	checks := []PresenceCheck{
		{Owner: checkout, Signal: finding.SignalTraces, Present: true},
		{Owner: checkout, Signal: finding.SignalTraces, Present: false},
	}

	got := WithPresence(Score(findings, nil, nil, Options{}), checks)[Key{Owner: checkout, Signal: finding.SignalTraces}]

	if value(t, got.RequiredResource) != 0.5 || value(t, got.NamingStable) != 1 {
		t.Errorf("required resource %+v naming %+v", got.RequiredResource, got.NamingStable)
	}
	if _, defined := got.Requirements.Value(); defined {
		t.Error("presence checks must not count as semconv requirements")
	}
}

func Test_Score_pipelineFindingsDoNotAffectTheService(t *testing.T) {
	introduced := named(pipeline, finding.SignalMetrics, "net_host_name", finding.TypeDeprecated, finding.BucketStable, 1)
	introduced.PipelineIntroduced = true
	findings := []finding.Finding{
		named(checkout, finding.SignalMetrics, "http_request_method", finding.TypeConformant, finding.BucketStable, 1),
		introduced,
	}

	scores := Score(findings, nil, nil, Options{})

	if value(t, scores[Key{Owner: checkout, Signal: finding.SignalMetrics}].NamingStable) != 1 {
		t.Error("service score affected by a pipeline finding")
	}
	if value(t, scores[Key{Owner: pipeline, Signal: finding.SignalMetrics}].NamingStable) != 0 {
		t.Error("pipeline row missing its finding")
	}
}

func Test_RollUp_microAveragesByNamespace(t *testing.T) {
	findings := []finding.Finding{
		named(checkout, finding.SignalTraces, "a", finding.TypeConformant, finding.BucketStable, 1),
		named(checkout, finding.SignalTraces, "b", finding.TypeConformant, finding.BucketStable, 1),
		named(checkout, finding.SignalTraces, "c", finding.TypeConformant, finding.BucketStable, 1),
		named(payments, finding.SignalTraces, "d", finding.TypeDeprecated, finding.BucketStable, 1),
	}

	rolled := RollUp(Score(findings, nil, nil, Options{}), ByNamespace)
	shop := rolled[Key{Owner: finding.Owner{Kind: finding.OwnerService, Namespace: "shop"}, Signal: finding.SignalTraces}]

	if value(t, shop.NamingStable) != 0.75 {
		t.Errorf("shop = %+v, want 3/4 (micro-average), not the 0.5 macro-average", shop.NamingStable)
	}
}

func Test_Ratio_MarshalJSON_writesNullForNA(t *testing.T) {
	encoded, err := json.Marshal(Scores{NamingStable: Ratio{Numerator: 1, Denominator: 2}})
	if err != nil {
		t.Fatal(err)
	}
	var decoded struct {
		NamingStable       map[string]any `json:"naming_stable"`
		NamingExperimental map[string]any `json:"naming_experimental"`
	}
	if err := json.Unmarshal(encoded, &decoded); err != nil {
		t.Fatal(err)
	}
	if decoded.NamingStable["value"] != 0.5 || decoded.NamingExperimental["value"] != nil {
		t.Errorf("encoded = %s", encoded)
	}
}

func Test_RankByImpact_sortsWithinEachSignal(t *testing.T) {
	findings := []finding.Finding{
		named(checkout, finding.SignalTraces, "small-span", finding.TypeDeprecated, finding.BucketStable, 10),
		named(checkout, finding.SignalMetrics, "big-metric", finding.TypeDeprecated, finding.BucketStable, 1000),
		named(checkout, finding.SignalTraces, "big-span", finding.TypeDeprecated, finding.BucketStable, 90),
	}
	totals := map[finding.Signal]float64{finding.SignalTraces: 100, finding.SignalMetrics: 10000}

	ranked := RankByImpact(findings, totals)

	order := []string{ranked[0].Observed, ranked[1].Observed, ranked[2].Observed}
	want := []string{"big-metric", "big-span", "small-span"}
	for i := range want {
		if order[i] != want[i] {
			t.Fatalf("order = %v, want %v", order, want)
		}
	}
	if ranked[0].ImpactShare != 0.1 || ranked[1].ImpactShare != 0.9 {
		t.Errorf("shares = %v %v", ranked[0].ImpactShare, ranked[1].ImpactShare)
	}
}
