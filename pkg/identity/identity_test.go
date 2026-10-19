package identity

import (
	"testing"

	"github.com/iambenzo/grot-weaver/pkg/finding"
)

func Test_ResolveTraceService(t *testing.T) {
	tests := []struct {
		name         string
		serviceName  string
		namespace    string
		wantKind     finding.OwnerKind
		wantFindings []finding.Type
		wantPassed   map[string]bool
	}{
		{
			name:        "named service",
			serviceName: "checkout", namespace: "shop",
			wantKind:   finding.OwnerService,
			wantPassed: map[string]bool{CheckServiceNamePresent: true, CheckServiceNameNotDefault: true},
		},
		{
			name:         "sdk default with language",
			serviceName:  "unknown_service:python",
			wantKind:     finding.OwnerService,
			wantFindings: []finding.Type{finding.TypeSDKDefaultServiceName},
			wantPassed:   map[string]bool{CheckServiceNamePresent: true, CheckServiceNameNotDefault: false},
		},
		{
			name:         "bare sdk default",
			serviceName:  "unknown_service",
			wantKind:     finding.OwnerService,
			wantFindings: []finding.Type{finding.TypeSDKDefaultServiceName},
			wantPassed:   map[string]bool{CheckServiceNamePresent: true, CheckServiceNameNotDefault: false},
		},
		{
			name:         "empty service name is unattributed, never dropped",
			serviceName:  "",
			wantKind:     finding.OwnerUnattributed,
			wantFindings: []finding.Type{finding.TypeMissingServiceName},
			wantPassed:   map[string]bool{CheckServiceNamePresent: false},
		},
		{
			name:        "unknown_service as a substring is a real name",
			serviceName: "unknown_services-api",
			wantKind:    finding.OwnerService,
			wantPassed:  map[string]bool{CheckServiceNamePresent: true, CheckServiceNameNotDefault: true},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := ResolveTraceService(tt.serviceName, tt.namespace, 4)

			if got.Attribution.Owner.Kind != tt.wantKind {
				t.Errorf("owner = %+v, want kind %s", got.Attribution.Owner, tt.wantKind)
			}
			if len(got.Findings) != len(tt.wantFindings) {
				t.Fatalf("findings = %+v, want %v", got.Findings, tt.wantFindings)
			}
			for i, f := range got.Findings {
				if f.Type != tt.wantFindings[i] || f.Volume != 4 || f.Level != finding.LevelViolation {
					t.Errorf("finding %d = %+v", i, f)
				}
			}
			if len(got.Checks) != len(tt.wantPassed) {
				t.Fatalf("checks = %+v", got.Checks)
			}
			for _, c := range got.Checks {
				if want, known := tt.wantPassed[c.Name]; !known || c.Passed != want || c.Owner != got.Attribution.Owner {
					t.Errorf("check %+v, want passed %v", c, want)
				}
			}
		})
	}
}
