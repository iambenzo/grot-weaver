package identity

import (
	"testing"

	"github.com/iambenzo/otel-semconv-compliance/pkg/finding"
	"github.com/iambenzo/otel-semconv-compliance/pkg/nameindex"
)

func Test_ResolveLogService(t *testing.T) {
	otlp := []string{"scope_name", "severity_number"}
	tests := []struct {
		name           string
		serviceName    string
		markers        []string
		wantKind       finding.OwnerKind
		wantSource     Source
		wantConfidence nameindex.Confidence
		wantFinding    finding.Type
	}{
		{name: "otlp service", serviceName: "checkout", markers: otlp, wantKind: finding.OwnerService, wantSource: SourceLogServiceNameOTLP, wantConfidence: nameindex.ConfidenceHigh},
		{name: "derived service (db-o11y integration)", serviceName: "integrations/db-o11y", wantKind: finding.OwnerService, wantSource: SourceLogServiceNameDerived, wantConfidence: nameindex.ConfidenceLow},
		{name: "sdk default with language", serviceName: "unknown_service:python", markers: otlp, wantKind: finding.OwnerService, wantSource: SourceLogServiceNameOTLP, wantConfidence: nameindex.ConfidenceHigh, wantFinding: finding.TypeSDKDefaultServiceName},
		{name: "loki fallback", serviceName: "unknown_service", wantKind: finding.OwnerUnattributed, wantSource: SourceLokiFallback, wantConfidence: nameindex.ConfidenceMedium, wantFinding: finding.TypeMissingServiceName},
		{name: "no service name", serviceName: "", wantKind: finding.OwnerUnattributed, wantSource: SourceNone, wantConfidence: nameindex.ConfidenceMedium, wantFinding: finding.TypeMissingServiceName},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := ResolveLogService(tt.serviceName, "", tt.markers, 9)
			if got.Attribution.Owner.Kind != tt.wantKind || got.Attribution.Source != tt.wantSource || got.Attribution.Confidence != tt.wantConfidence {
				t.Errorf("attribution = %+v", got.Attribution)
			}
			if tt.wantFinding == "" && len(got.Findings) != 0 || tt.wantFinding != "" && (len(got.Findings) != 1 || got.Findings[0].Type != tt.wantFinding || got.Findings[0].Signal != finding.SignalLogs) {
				t.Errorf("findings = %+v, want %q", got.Findings, tt.wantFinding)
			}
		})
	}
}
