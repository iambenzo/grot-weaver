package main

import (
	"slices"
	"strings"
	"testing"

	"github.com/iambenzo/grot-weaver/pkg/catalogue"
)

const sampleSchema = `
file_format: 1.1.0
schema_url: https://opentelemetry.io/schemas/1.44.0
versions:
  1.44.0:
    metrics:
      changes:
        - rename_metrics:
            k8s.pod.memory.paging.faults: k8s.pod.paging.faults
  1.43.0:
  1.26.0:
    metrics:
      changes:
        - rename_attributes:
            attribute_map:
              db.name: db.namespace
            apply_to_metrics:
              - db.client.connections.usage
              - db.client.connection.count
  1.21.0:
    spans:
      changes:
        - rename_attributes:
            attribute_map:
              http.method: http.request.method
  1.4.0:
    all:
      changes:
        - rename_attributes:
            attribute_map:
              k8s.pod.name: k8s.pod.name.old
`

func Test_parseRenameHistory_flattensAndSortsByVersion(t *testing.T) {
	history, err := parseRenameHistory([]byte(sampleSchema))
	if err != nil {
		t.Fatal(err)
	}

	if history.SchemaURL != "https://opentelemetry.io/schemas/1.44.0" {
		t.Errorf("schema url = %q", history.SchemaURL)
	}
	gotVersions := make([]string, 0, len(history.Attributes))
	for _, rename := range history.Attributes {
		gotVersions = append(gotVersions, rename.Version)
	}
	if !slices.Equal(gotVersions, []string{"1.4.0", "1.21.0", "1.26.0"}) {
		t.Errorf("attribute rename versions = %v, want ascending", gotVersions)
	}
	scoped := history.Attributes[2]
	if scoped.Scope != catalogue.ScopeMetrics || !slices.Equal(scoped.Metrics, []string{"db.client.connection.count", "db.client.connections.usage"}) {
		t.Errorf("metric-scoped rename = %+v", scoped)
	}
	if len(history.Metrics) != 1 || history.Metrics[0].To != "k8s.pod.paging.faults" {
		t.Errorf("metric renames = %+v", history.Metrics)
	}
}

func Test_parseRenameHistory_rejectsUnknownChangeTypesAndSections(t *testing.T) {
	tests := []struct {
		name    string
		schema  string
		wantErr string
	}{
		{name: "unknown change type", schema: "versions:\n  1.0.0:\n    metrics:\n      changes:\n        - split:\n            x: y\n", wantErr: "split"},
		{name: "unknown section", schema: "versions:\n  1.0.0:\n    profiles:\n      changes: []\n", wantErr: "profiles"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_, err := parseRenameHistory([]byte(tt.schema))
			if err == nil || !strings.Contains(err.Error(), tt.wantErr) {
				t.Errorf("err = %v, want it to mention %q", err, tt.wantErr)
			}
		})
	}
}

func Test_schemaURLFor_dropsLeadingV(t *testing.T) {
	if got := schemaURLFor("v1.44.0"); got != "https://opentelemetry.io/schemas/1.44.0" {
		t.Errorf("got %q", got)
	}
}
