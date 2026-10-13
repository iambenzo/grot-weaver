package nameindex

import (
	"slices"
	"testing"

	"github.com/prometheus/otlptranslator"

	"github.com/iambenzo/otel-semconv-compliance/pkg/catalogue"
)

func Test_MetricIndex_Match_designEvidenceRows(t *testing.T) {
	index := NewMetricIndex(loadCatalogue(t))

	tests := []struct {
		observed   string
		wantMetric string
		wantPart   SeriesPart
	}{
		{observed: "http_server_request_duration_seconds_bucket", wantMetric: "http.server.request.duration", wantPart: PartBucket},
		{observed: "http_server_request_body_size_bytes_bucket", wantMetric: "http.server.request.body.size", wantPart: PartBucket},
		{observed: "jvm_cpu_recent_utilization_ratio", wantMetric: "jvm.cpu.recent_utilization", wantPart: PartWhole},
		{observed: "gen_ai_client_token_usage_bucket", wantMetric: "gen_ai.client.token.usage", wantPart: PartBucket},
		{observed: "process_memory_usage_bytes", wantMetric: "process.memory.usage", wantPart: PartWhole},
	}
	for _, tt := range tests {
		t.Run(tt.observed, func(t *testing.T) {
			match := index.Match(tt.observed)

			if !match.Matched || match.Form.Metric.Name != tt.wantMetric || match.Form.Part != tt.wantPart {
				t.Fatalf("match = %+v, want %s part %q", match, tt.wantMetric, tt.wantPart)
			}
			if !slices.Contains(match.Form.Strategies, otlptranslator.UnderscoreEscapingWithSuffixes) {
				t.Errorf("strategies %v do not include the default strategy", match.Form.Strategies)
			}
		})
	}
}

func Test_MetricIndex_Match_everyStrategy(t *testing.T) {
	index := NewMetricIndex(loadCatalogue(t))

	tests := []struct {
		name         string
		observed     string
		wantMetric   string
		wantStrategy Strategy
		wantPart     SeriesPart
	}{
		{name: "without suffixes", observed: "http_server_request_duration_bucket", wantMetric: "http.server.request.duration", wantStrategy: otlptranslator.UnderscoreEscapingWithoutSuffixes, wantPart: PartBucket},
		{name: "utf8 with suffixes", observed: "http.server.request.duration_seconds_count", wantMetric: "http.server.request.duration", wantStrategy: otlptranslator.NoUTF8EscapingWithSuffixes, wantPart: PartCount},
		{name: "no translation", observed: "http.server.request.duration_sum", wantMetric: "http.server.request.duration", wantStrategy: otlptranslator.NoTranslation, wantPart: PartSum},
		{name: "native histogram base name", observed: "http_server_request_duration_seconds", wantMetric: "http.server.request.duration", wantStrategy: otlptranslator.UnderscoreEscapingWithSuffixes, wantPart: PartWhole},
		{name: "monotonic counter total", observed: "jvm_class_loaded_total", wantMetric: "jvm.class.loaded", wantStrategy: otlptranslator.UnderscoreEscapingWithSuffixes, wantPart: PartWhole},
		{name: "updowncounter has no total", observed: "jvm_class_count", wantMetric: "jvm.class.count", wantStrategy: otlptranslator.UnderscoreEscapingWithSuffixes, wantPart: PartWhole},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			match := index.Match(tt.observed)

			if !match.Matched {
				t.Fatalf("%s not matched", tt.observed)
			}
			if match.Form.Metric.Name != tt.wantMetric || match.Form.Part != tt.wantPart || !slices.Contains(match.Form.Strategies, tt.wantStrategy) {
				t.Errorf("form = %+v, want %s part %q strategy %s", match.Form, tt.wantMetric, tt.wantPart, tt.wantStrategy)
			}
		})
	}
}

func Test_MetricIndex_Match_deprecatedAndHistory(t *testing.T) {
	index := NewMetricIndex(loadCatalogue(t))

	historic := index.Match("http_server_duration")
	if !historic.Matched || historic.Form.Metric.Source != catalogue.SourceRenameHistory || historic.Form.Metric.Deprecated.RenamedTo != "http.server.request.duration" {
		t.Errorf("http_server_duration = %+v, want rename-history deprecation", historic.Form)
	}

	if unknown := index.Match("my_app_widgets_total"); unknown.Matched {
		t.Errorf("custom metric matched: %+v", unknown.Form)
	}
}

func Test_MetricIndex_Match_prefersCurrentOnCollision(t *testing.T) {
	loaded := &catalogue.Catalogue{Registry: catalogue.Registry{Metrics: []catalogue.Metric{
		{Name: "a.b_c", Instrument: "gauge", Deprecated: &catalogue.Deprecation{Reason: "renamed", RenamedTo: "a.b.c"}},
		{Name: "a.b.c", Instrument: "gauge"},
	}}}

	match := NewMetricIndex(loaded).Match("a_b_c")

	if !match.Matched || match.Form.Metric.Name != "a.b.c" || match.Confidence != ConfidenceHigh || len(match.Alternatives) != 1 {
		t.Errorf("match = %+v", match)
	}
}
