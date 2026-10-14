package assessment

import (
	"strings"
	"testing"

	"github.com/iambenzo/otel-semconv-compliance/pkg/finding"
	"github.com/iambenzo/otel-semconv-compliance/pkg/scoring"
)

type presence struct {
	state    PresenceState
	evidence string
}

func resourceStates(result Result, owner finding.Owner, signal finding.Signal) map[string]presence {
	states := map[string]presence{}
	for _, check := range result.Resource {
		if check.Owner == owner && check.Signal == signal {
			states[check.Attribute] = presence{state: check.State, evidence: check.Evidence}
		}
	}
	return states
}

func wantStates(t *testing.T, got map[string]presence, want map[string]PresenceState) {
	t.Helper()
	for attribute, state := range want {
		if got[attribute].state != state {
			t.Errorf("%s = %+v, want %s", attribute, got[attribute], state)
		}
	}
	if len(got) != len(want) {
		t.Errorf("checked %d attributes, want %d: %+v", len(got), len(want), got)
	}
}

func Test_Assess_requiredResourceAttributesOnTraces(t *testing.T) {
	inventory := Inventory{Traces: []TraceDatasource{{UID: "tempo", Services: []TraceService{
		{ServiceName: "checkout", ServiceNamespace: "shop", SpanCount: 10, ResourceKeys: []KeyObservation{{Key: "service.name"}, {Key: "service.instance.id"}, {Key: "deployment.environment"}}},
		{ServiceName: "cart", SpanCount: 5},
	}}}}

	result := newAssessor(t).Assess(inventory, scoringDefaults)

	checkout := resourceStates(result, finding.Owner{Kind: finding.OwnerService, Namespace: "shop", Name: "checkout"}, finding.SignalTraces)
	wantStates(t, checkout, map[string]PresenceState{
		"service.name": PresencePresent, "service.namespace": PresencePresent,
		"service.instance.id": PresencePresent, "deployment.environment.name": PresenceMissing,
	})
	if !strings.Contains(checkout["deployment.environment.name"].evidence, "deprecated deployment.environment") {
		t.Errorf("evidence = %q, want the deprecated name called out", checkout["deployment.environment.name"].evidence)
	}
	wantStates(t, resourceStates(result, finding.Owner{Kind: finding.OwnerService, Name: "cart"}, finding.SignalTraces), map[string]PresenceState{
		"service.name": PresencePresent, "service.namespace": PresenceMissing,
		"service.instance.id": PresenceUnknown, "deployment.environment.name": PresenceUnknown,
	})
}

func Test_Assess_requiredResourceAttributesOnMetricsUseTargetInfo(t *testing.T) {
	inventory := Inventory{Metrics: []MetricDatasource{{
		UID:   "prom",
		Names: []string{"http_server_request_duration_seconds_bucket"},
		TargetInfo: []map[string]string{
			{"job": "shop/checkout", "instance": "abc", "telemetry_sdk_name": "opentelemetry", "deployment_environment_name": "prod"},
		},
		Owners: []MetricOwner{
			{Metric: "http_server_request_duration_seconds_bucket", Labels: map[string]string{"job": "shop/checkout"}, Series: 4},
			{Metric: "http_server_request_duration_seconds_bucket", Labels: map[string]string{"service_name": "cart"}, Series: 2},
		},
	}}}

	result := newAssessor(t).Assess(inventory, scoringDefaults)

	wantStates(t, resourceStates(result, finding.Owner{Kind: finding.OwnerService, Namespace: "shop", Name: "checkout"}, finding.SignalMetrics), map[string]PresenceState{
		"service.name": PresencePresent, "service.namespace": PresencePresent,
		"service.instance.id": PresencePresent, "deployment.environment.name": PresencePresent,
	})
	wantStates(t, resourceStates(result, finding.Owner{Kind: finding.OwnerService, Name: "cart"}, finding.SignalMetrics), map[string]PresenceState{
		"service.name": PresencePresent, "service.namespace": PresenceMissing,
		"service.instance.id": PresenceUnknown, "deployment.environment.name": PresenceUnknown,
	})
}

func Test_Assess_requiredResourceAttributesOnLogs(t *testing.T) {
	inventory := Inventory{Logs: []LogDatasource{{UID: "loki", Services: []LogService{
		{ServiceName: "checkout", ServiceNamespace: "shop", StreamLabels: []string{"service_name", "service_namespace", "service_instance_id"}, MetadataKeys: []string{"deployment_environment_name"}, KeysMethod: MethodDetectedFields, Volume: 3},
		{ServiceName: "cart", StreamLabels: []string{"service_name"}, KeysMethod: MethodSample, Volume: 1},
	}}}}

	result := newAssessor(t).Assess(inventory, scoringDefaults)

	wantStates(t, resourceStates(result, finding.Owner{Kind: finding.OwnerService, Namespace: "shop", Name: "checkout"}, finding.SignalLogs), map[string]PresenceState{
		"service.name": PresencePresent, "service.namespace": PresencePresent,
		"service.instance.id": PresencePresent, "deployment.environment.name": PresencePresent,
	})
	wantStates(t, resourceStates(result, finding.Owner{Kind: finding.OwnerService, Name: "cart"}, finding.SignalLogs), map[string]PresenceState{
		"service.name": PresencePresent, "service.namespace": PresenceMissing,
		"service.instance.id": PresenceUnknown, "deployment.environment.name": PresenceUnknown,
	})
}

func Test_Assess_requiredResourceAttributesAreConfigurableAndScoredSeparately(t *testing.T) {
	inventory := Inventory{
		RequiredResourceAttributes: []string{"service.name", "team.name"},
		Traces: []TraceDatasource{{UID: "tempo", Services: []TraceService{
			{ServiceName: "checkout", SpanCount: 1, ResourceKeys: []KeyObservation{{Key: "service.name"}}},
			{ServiceName: "", SpanCount: 1},
		}}},
	}

	result := newAssessor(t).Assess(inventory, scoringDefaults)

	owner := finding.Owner{Kind: finding.OwnerService, Name: "checkout"}
	wantStates(t, resourceStates(result, owner, finding.SignalTraces), map[string]PresenceState{"service.name": PresencePresent, "team.name": PresenceMissing})
	if len(result.Resource) != 2 {
		t.Errorf("unattributed telemetry should not be checked: %+v", result.Resource)
	}
	for _, row := range result.Owners {
		if row.Key == (scoring.Key{Owner: owner, Signal: finding.SignalTraces}) {
			if value, _ := row.Scores.RequiredResource.Value(); value != 0.5 {
				t.Errorf("required resource = %+v", row.Scores.RequiredResource)
			}
			if _, defined := row.Scores.Requirements.Value(); defined {
				t.Errorf("requirements should not include resource presence: %+v", row.Scores.Requirements)
			}
		}
	}
}

func Test_Inventory_Validate_requiredResourceAttributes(t *testing.T) {
	tooMany := make([]string, MaxRequiredResourceAttributes+1)
	for index := range tooMany {
		tooMany[index] = "a"
	}
	for _, attributes := range [][]string{{""}, tooMany, {strings.Repeat("a", MaxNameLength+1)}} {
		if err := (Inventory{RequiredResourceAttributes: attributes}).Validate(); err == nil {
			t.Errorf("attributes %d long validated", len(attributes))
		}
	}
	if err := (Inventory{RequiredResourceAttributes: []string{"service.name"}}).Validate(); err != nil {
		t.Error(err)
	}
}
