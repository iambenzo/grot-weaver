package identity

import (
	"testing"

	"github.com/iambenzo/otel-semconv-compliance/pkg/nameindex"
)

func Test_ClassifyOrigin(t *testing.T) {
	tests := []struct {
		name       string
		target     map[string]string
		found      bool
		scope      string
		want       Origin
		confidence nameindex.Confidence
	}{
		{name: "sdk labels", target: map[string]string{"job": "shop/checkout", "telemetry_sdk_name": "opentelemetry"}, found: true, want: OriginSDK, confidence: nameindex.ConfidenceHigh},
		{name: "envoy sdk without job", target: map[string]string{"instance": "envoy-1", "telemetry_sdk_name": "envoy"}, found: true, want: OriginSDK, confidence: nameindex.ConfidenceHigh},
		{name: "collector scrape target (experiment 6)", target: map[string]string{"job": "node-via-otelcol-otlp", "instance": "node-exporter:9100", "server_address": "node-exporter", "server_port": "9100", "url_scheme": "http"}, found: true, want: OriginCollectorScraped, confidence: nameindex.ConfidenceMedium},
		{name: "legacy scrape target labels", target: map[string]string{"job": "integrations/x", "net_host_name": "h", "http_scheme": "http"}, found: true, want: OriginCollectorScraped, confidence: nameindex.ConfidenceMedium},
		{name: "receiver scope wins", target: nil, found: false, scope: "github.com/open-telemetry/opentelemetry-collector-contrib/receiver/prometheusreceiver", want: OriginCollectorScraped, confidence: nameindex.ConfidenceHigh},
		{name: "no target_info", found: false, want: OriginNonOTel, confidence: nameindex.ConfidenceMedium},
		{name: "receiver copies job and instance (Grafana Cloud db-o11y shape)", target: map[string]string{"job": "integrations/db-o11y", "instance": "host-a", "service_name": "integrations/db-o11y", "service_instance_id": "host-a", "net_host_name": "host-a", "http_scheme": "http"}, found: true, want: OriginCollectorScraped, confidence: nameindex.ConfidenceMedium},
		{name: "receiver copies split job", target: map[string]string{"job": "shop/checkout", "instance": "i", "service_namespace": "shop", "service_name": "checkout", "net_host_name": "h"}, found: true, want: OriginCollectorScraped, confidence: nameindex.ConfidenceMedium},
		{name: "service name that differs from job is real", target: map[string]string{"job": "integrations/db-o11y", "instance": "host-a", "service_name": "db", "net_host_name": "host-a"}, found: true, want: OriginSDK, confidence: nameindex.ConfidenceMedium},
		{name: "resource attributes without sdk", target: map[string]string{"job": "otelcol", "service_name": "otelcol-contrib"}, found: true, want: OriginSDK, confidence: nameindex.ConfidenceMedium},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := ClassifyOrigin(tt.target, tt.found, tt.scope)
			if got.Origin != tt.want || got.Confidence != tt.confidence || got.Reason == "" {
				t.Errorf("got %+v, want %s/%s", got, tt.want, tt.confidence)
			}
		})
	}
}
