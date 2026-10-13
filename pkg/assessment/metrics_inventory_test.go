package assessment

import (
	"strings"
	"testing"
)

func Test_Reclassify_defaults(t *testing.T) {
	tests := []struct {
		metric string
		want   ReclassificationAction
		found  bool
	}{
		{metric: "job:http_requests:rate5m", want: ActionExclude, found: true},
		{metric: "traces_spanmetrics_calls_total", want: ActionExclude, found: true},
		{metric: "traces_service_graph_request_total", want: ActionExclude, found: true},
		{metric: "traces_target_info", want: ActionExclude, found: true},
		{metric: "otelcol_receiver_accepted_spans_total", want: ActionPipeline, found: true},
		{metric: "alloy_build_info", want: ActionPipeline, found: true},
		{metric: "http_server_request_duration_seconds_bucket"},
		{metric: "traces_target_info_extra"},
	}
	for _, tt := range tests {
		t.Run(tt.metric, func(t *testing.T) {
			got, found := Reclassify(tt.metric, DefaultReclassification)
			if got != tt.want || found != tt.found {
				t.Errorf("got (%q, %v), want (%q, %v)", got, found, tt.want, tt.found)
			}
		})
	}
}

func Test_Inventory_ReclassificationRules_areEditable(t *testing.T) {
	custom := []ReclassificationRule{{Pattern: "acme_*", Action: ActionExclude}}

	if got := (Inventory{}).ReclassificationRules(); len(got) != len(DefaultReclassification) {
		t.Errorf("defaults = %+v", got)
	}
	if got := (Inventory{Reclassification: custom}).ReclassificationRules(); len(got) != 1 || got[0].Pattern != "acme_*" {
		t.Errorf("custom = %+v", got)
	}
	if got := (Inventory{Reclassification: []ReclassificationRule{}}).ReclassificationRules(); len(got) != 0 {
		t.Errorf("explicitly empty rules should disable reclassification, got %+v", got)
	}
}

func Test_Inventory_Validate_metrics(t *testing.T) {
	tests := []struct {
		name      string
		inventory Inventory
		wantErr   string
	}{
		{name: "valid", inventory: Inventory{Metrics: []MetricDatasource{{UID: "prom", Names: []string{"up"}, Owners: []MetricOwner{{Metric: "up", Labels: map[string]string{"job": "x"}, Series: 1}}}}}},
		{name: "no uid", inventory: Inventory{Metrics: []MetricDatasource{{}}}, wantErr: "without uid"},
		{name: "negative series", inventory: Inventory{Metrics: []MetricDatasource{{UID: "p", Owners: []MetricOwner{{Metric: "up", Series: -1}}}}}, wantErr: "malformed owner"},
		{name: "bad pattern", inventory: Inventory{Reclassification: []ReclassificationRule{{Pattern: "[", Action: ActionExclude}}}, wantErr: "pattern"},
		{name: "bad action", inventory: Inventory{Reclassification: []ReclassificationRule{{Pattern: "x", Action: "drop"}}}, wantErr: "action"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := tt.inventory.Validate()
			if tt.wantErr == "" && err != nil {
				t.Fatalf("unexpected error %v", err)
			}
			if tt.wantErr != "" && (err == nil || !strings.Contains(err.Error(), tt.wantErr)) {
				t.Fatalf("err = %v, want %q", err, tt.wantErr)
			}
		})
	}
}
