package assessment

import (
	"slices"
	"strings"
	"testing"

	"github.com/iambenzo/grot-weaver/pkg/finding"
)

func Test_Assess_metricLabelKeys(t *testing.T) {
	targets := []map[string]string{
		{"job": "shop/checkout", "telemetry_sdk_name": "opentelemetry"},
		{"job": "payments", "telemetry_sdk_name": "opentelemetry"},
		{"job": "shop/inventory", "telemetry_sdk_name": "opentelemetry"},
	}
	stack := []string{"cluster", "deployment_environment"}
	keys := func(extra ...string) []string {
		return append(append([]string{"__name__", "job", "le", "otel_scope_name"}, stack...), extra...)
	}
	inventory := Inventory{Metrics: []MetricDatasource{{
		UID:        "prom",
		TargetInfo: targets,
		Owners: []MetricOwner{
			{Metric: "http_server_request_duration_seconds_bucket", Labels: map[string]string{"job": "shop/checkout"}, Series: 30},
			{Metric: "http_client_request_duration_seconds_bucket", Labels: map[string]string{"job": "shop/checkout"}, Series: 10},
			{Metric: "http_server_request_duration_seconds_bucket", Labels: map[string]string{"job": "payments"}, Series: 5},
			{Metric: "http_server_request_duration_seconds_bucket", Labels: map[string]string{"job": "shop/inventory"}, Series: 5},
		},
		LabelKeys: []OwnerLabelKeys{
			{Metric: "http_server_request_duration_seconds_bucket", Selector: map[string]string{"job": "shop/checkout"}, Keys: keys("http_request_method", "url_scheme", "http_method", "acme_tenant", "asserts_env")},
			{Metric: "http_client_request_duration_seconds_bucket", Selector: map[string]string{"job": "shop/checkout"}, Keys: keys("http_request_method", "server_address", "server_port", "http_method")},
			{Metric: "http_server_request_duration_seconds_bucket", Selector: map[string]string{"job": "payments"}, Keys: keys("http_request_method")},
			{Metric: "http_server_request_duration_seconds_bucket", Selector: map[string]string{"job": "shop/inventory"}, Keys: keys("http_request_method", "url_scheme")},
		},
	}}}

	result := newAssessor(t).Assess(inventory, scoringDefaults)

	checkout := finding.Owner{Kind: finding.OwnerService, Namespace: "shop", Name: "checkout"}
	payments := finding.Owner{Kind: finding.OwnerService, Name: "payments"}
	stackOwner := finding.Owner{Kind: finding.OwnerPipeline, Name: stackAddedPipeline}

	method, _ := metricFinding(result, checkout, "http_request_method")
	if method.Type != finding.TypeConformant {
		t.Errorf("http_request_method = %+v", method)
	}
	old, _ := metricFinding(result, checkout, "http_method")
	if old.Type != finding.TypeDeprecated || !slices.Equal(old.Metrics, []string{"http_server_request_duration_seconds_bucket", "http_client_request_duration_seconds_bucket"}) || old.Volume != 40 {
		t.Errorf("http_method = %+v, want one deprecated finding covering both metrics", old)
	}
	environment, _ := metricFinding(result, checkout, "deployment_environment")
	if environment.Type != finding.TypeDeprecated || environment.Expected != "deployment.environment.name" {
		t.Errorf("deployment_environment = %+v, want deprecated and charged to the service even though it is everywhere", environment)
	}
	cluster, found := metricFinding(result, stackOwner, "cluster")
	if !found || cluster.Type != finding.TypeCustom || !cluster.PipelineIntroduced || !strings.Contains(cluster.Note, "added by the stack") {
		t.Errorf("cluster = %+v (found %v), want a stack-added custom label", cluster, found)
	}
	if _, onService := metricFinding(result, checkout, "cluster"); onService {
		t.Error("stack-added label charged to the service")
	}
	assertsOwner := finding.Owner{Kind: finding.OwnerPipeline, Name: assertsPipeline}
	if env, found := metricFinding(result, assertsOwner, "asserts_env"); !found || !env.PipelineIntroduced || !strings.Contains(env.Note, "Grafana Asserts") {
		t.Errorf("asserts_env = %+v (found %v), want it on the Asserts pipeline", env, found)
	}
	if _, onService := metricFinding(result, checkout, "asserts_env"); onService {
		t.Error("Asserts label charged to the service")
	}
	tenant, _ := metricFinding(result, checkout, "acme_tenant")
	if tenant.Type != finding.TypeCustom || tenant.Owner != checkout {
		t.Errorf("acme_tenant = %+v, want custom on the service (not prevalent)", tenant)
	}
	for _, structural := range []string{"__name__", "job", "le", "otel_scope_name"} {
		if _, found := metricFinding(result, checkout, structural); found {
			t.Errorf("structural label %s produced a finding", structural)
		}
	}

	missing, found := metricFinding(result, payments, "http.server.request.duration")
	if !found || missing.Type != finding.TypeRequiredAttributeMissing || missing.Expected != "url.scheme" || !strings.Contains(missing.Note, downstreamCaveat) {
		t.Errorf("payments requirement = %+v (found %v)", missing, found)
	}
	for _, row := range result.Owners {
		if row.Signal != finding.SignalMetrics {
			continue
		}
		switch row.Owner {
		case payments:
			if row.Scores.Requirements.Numerator != 1 || row.Scores.Requirements.Denominator != 2 {
				t.Errorf("payments requirements = %+v, want 1 of 2", row.Scores.Requirements)
			}
		case checkout:
			if row.Scores.Requirements.Numerator != row.Scores.Requirements.Denominator || row.Scores.Requirements.Denominator == 0 {
				t.Errorf("checkout requirements = %+v, want all satisfied", row.Scores.Requirements)
			}
		}
	}
}

func Test_stackAddedKeys_needsEnoughSetsAndOwners(t *testing.T) {
	one := []OwnerLabelKeys{
		{Metric: "a", Selector: map[string]string{"job": "x"}, Keys: []string{"cluster"}},
		{Metric: "b", Selector: map[string]string{"job": "x"}, Keys: []string{"cluster"}},
		{Metric: "c", Selector: map[string]string{"job": "x"}, Keys: []string{"cluster"}},
	}
	if got := stackAddedKeys(one, identityTargets(nil)); got["cluster"] {
		t.Error("a label seen on a single owner should not count as stack-added")
	}
	if got := stackAddedKeys(one[:2], identityTargets(nil)); got != nil {
		t.Errorf("too few sets should disable detection, got %v", got)
	}
}

func Test_Assess_skipsRecordingRules(t *testing.T) {
	rule := "asserts:request:rate5m"
	inventory := Inventory{Reclassification: []ReclassificationRule{}, Metrics: []MetricDatasource{{
		UID:        "prom",
		Names:      []string{"http_server_request_duration_seconds_bucket", rule},
		TargetInfo: []map[string]string{{"job": "shop/checkout", "telemetry_sdk_name": "opentelemetry"}},
		Owners: []MetricOwner{
			{Metric: "http_server_request_duration_seconds_bucket", Labels: map[string]string{"job": "shop/checkout"}, Series: 10},
			{Metric: rule, Labels: map[string]string{"job": "shop/checkout"}, Series: 90},
			{Metric: rule, Labels: map[string]string{}, Series: 50},
		},
		LabelKeys: []OwnerLabelKeys{{Metric: rule, Selector: map[string]string{"job": "shop/checkout"}, Keys: []string{"job", "asserts_env"}}},
	}}}

	result := newAssessor(t).Assess(inventory, scoringDefaults)

	for _, f := range result.Findings {
		if f.Observed == rule || slices.Contains(f.Metrics, rule) {
			t.Errorf("recording rule produced a finding: %+v", f)
		}
	}
	for _, coverage := range result.Coverage {
		if coverage.Signal == finding.SignalMetrics && coverage.Coverage.Denominator != 10 {
			t.Errorf("metric volume = %v, want only the 10 instrumented series", coverage.Coverage.Denominator)
		}
	}
}
