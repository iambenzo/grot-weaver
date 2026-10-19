package identity

import (
	"testing"

	"github.com/iambenzo/grot-weaver/pkg/finding"
	"github.com/iambenzo/grot-weaver/pkg/nameindex"
)

func Test_ResolveMetricOwner(t *testing.T) {
	targets := NewTargetIndex([]map[string]string{
		{"job": "shop/checkout", "instance": "checkout-1", "telemetry_sdk_name": "opentelemetry"},
		{"job": "weather-app", "telemetry_sdk_name": "beyla"},
		{"job": "unknown_service:python", "instance": "x", "telemetry_sdk_name": "opentelemetry"},
		{"job": "node-via-otelcol-otlp", "instance": "node-exporter:9100", "server_address": "node-exporter", "server_port": "9100", "url_scheme": "http"},
		{"instance": "envoy-envoy-gateway-system-abc", "telemetry_sdk_name": "envoy", "k8s_deployment_name": "envoy-gateway", "k8s_namespace_name": "envoy-gateway-system"},
		{"instance": "bare-host:9901", "telemetry_sdk_name": "envoy"},
		{"job": "integrations/db-o11y", "instance": "host-a", "service_name": "integrations/db-o11y", "service_instance_id": "host-a", "net_host_name": "host-a", "http_scheme": "http"},
	})

	tests := []struct {
		name         string
		labels       map[string]string
		wantOwner    finding.Owner
		wantSource   Source
		wantOrigin   Origin
		wantFindings []finding.Type
		wantHints    map[string]string
		wantChecks   int
	}{
		{
			name:       "service_name label",
			labels:     map[string]string{"service_name": "payments", "service_namespace": "shop", "job": "shop/payments"},
			wantOwner:  finding.Owner{Kind: finding.OwnerService, Namespace: "shop", Name: "payments"},
			wantSource: SourceServiceNameLabel, wantOrigin: OriginSDK, wantChecks: 2,
		},
		{
			name:       "sdk job split on the first slash",
			labels:     map[string]string{"job": "shop/checkout", "instance": "checkout-1"},
			wantOwner:  finding.Owner{Kind: finding.OwnerService, Namespace: "shop", Name: "checkout"},
			wantSource: SourceJobLabel, wantOrigin: OriginSDK, wantChecks: 2,
		},
		{
			name:       "sdk job without instance still attributes (weather-app)",
			labels:     map[string]string{"job": "weather-app"},
			wantOwner:  finding.Owner{Kind: finding.OwnerService, Name: "weather-app"},
			wantSource: SourceJobLabel, wantOrigin: OriginSDK, wantChecks: 2,
		},
		{
			name:       "sdk default service name",
			labels:     map[string]string{"job": "unknown_service:python"},
			wantOwner:  finding.Owner{Kind: finding.OwnerService, Name: "unknown_service:python"},
			wantSource: SourceJobLabel, wantOrigin: OriginSDK,
			wantFindings: []finding.Type{finding.TypeSDKDefaultServiceName}, wantChecks: 2,
		},
		{
			name:       "go sdk default from envoy gateway",
			labels:     map[string]string{"job": "unknown_service:envoy-gateway", "instance": "envoy-gateway-8677d8b958-nh682"},
			wantOwner:  finding.Owner{Kind: finding.OwnerService, Name: "unknown_service:envoy-gateway"},
			wantSource: SourceJobLabel, wantOrigin: OriginNonOTel,
			wantFindings: []finding.Type{finding.TypeSDKDefaultServiceName}, wantChecks: 2,
		},
		{
			name:       "receiver-copied service_name on a collector-scraped job is a source",
			labels:     map[string]string{"job": "integrations/db-o11y", "instance": "host-a", "service_name": "integrations/db-o11y"},
			wantOwner:  finding.Owner{Kind: finding.OwnerSource, Name: "integrations/db-o11y"},
			wantSource: SourceScrapeJob, wantOrigin: OriginCollectorScraped,
		},
		{
			name:       "collector-scraped job is a source",
			labels:     map[string]string{"job": "node-via-otelcol-otlp", "instance": "node-exporter:9100"},
			wantOwner:  finding.Owner{Kind: finding.OwnerSource, Name: "node-via-otelcol-otlp"},
			wantSource: SourceScrapeJob, wantOrigin: OriginCollectorScraped,
		},
		{
			name:       "non-otel job is a source",
			labels:     map[string]string{"job": "integrations/node_exporter"},
			wantOwner:  finding.Owner{Kind: finding.OwnerSource, Name: "integrations/node_exporter"},
			wantSource: SourceScrapeJob, wantOrigin: OriginNonOTel,
		},
		{
			name:       "no job but instance matches target_info (envoy)",
			labels:     map[string]string{"instance": "envoy-envoy-gateway-system-abc"},
			wantOwner:  finding.Owner{Kind: finding.OwnerUnattributed, Namespace: "envoy-gateway-system", Name: "envoy-gateway"},
			wantSource: SourceInstanceTarget, wantOrigin: OriginSDK,
			wantFindings: []finding.Type{finding.TypeMissingServiceName},
			wantHints:    map[string]string{"telemetry_sdk_name": "envoy", "k8s_deployment_name": "envoy-gateway", "k8s_namespace_name": "envoy-gateway-system"},
			wantChecks:   1,
		},
		{
			name:       "no job and no workload falls back to the instance",
			labels:     map[string]string{"instance": "bare-host:9901"},
			wantOwner:  finding.Owner{Kind: finding.OwnerUnattributed, Name: "bare-host:9901"},
			wantSource: SourceInstanceTarget, wantOrigin: OriginSDK,
			wantFindings: []finding.Type{finding.TypeMissingServiceName},
			wantHints:    map[string]string{"telemetry_sdk_name": "envoy"},
			wantChecks:   1,
		},
		{
			name:       "nothing but an identity-like label",
			labels:     map[string]string{"service": "legacy-api"},
			wantOwner:  finding.Owner{Kind: finding.OwnerUnattributed, Name: unattributedName},
			wantSource: SourceIdentityHint, wantOrigin: OriginNonOTel,
			wantFindings: []finding.Type{finding.TypeMissingServiceName},
			wantHints:    map[string]string{"service": "legacy-api"},
			wantChecks:   1,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := ResolveMetricOwner(tt.labels, targets, 5)

			if got.Attribution.Owner != tt.wantOwner || got.Attribution.Source != tt.wantSource || got.Origin.Origin != tt.wantOrigin {
				t.Errorf("got owner %+v source %q origin %s", got.Attribution.Owner, got.Attribution.Source, got.Origin.Origin)
			}
			if len(got.Findings) != len(tt.wantFindings) || len(got.Checks) != tt.wantChecks {
				t.Fatalf("findings %+v checks %+v", got.Findings, got.Checks)
			}
			for i, f := range got.Findings {
				if f.Type != tt.wantFindings[i] || f.Signal != finding.SignalMetrics {
					t.Errorf("finding %+v", f)
				}
			}
			for key, value := range tt.wantHints {
				if got.Hints[key] != value {
					t.Errorf("hints = %v, want %s=%s", got.Hints, key, value)
				}
			}
		})
	}
}

func Test_ResolveMetricOwner_hintOnlyIsLowConfidence(t *testing.T) {
	got := ResolveMetricOwner(map[string]string{"app": "x"}, NewTargetIndex(nil), 1)

	if got.Attribution.Confidence != nameindex.ConfidenceLow {
		t.Errorf("confidence = %s", got.Attribution.Confidence)
	}
}
