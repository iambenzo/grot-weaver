package nameindex

import (
	"testing"

	"github.com/prometheus/otlptranslator"

	"github.com/iambenzo/grot-weaver/pkg/catalogue"
)

func Test_MetricIndex_NearMiss(t *testing.T) {
	index := NewMetricIndex(loadCatalogue(t))

	tests := []struct {
		name            string
		observed        string
		wantMiss        bool
		wantMetric      string
		wantFound       string
		wantExpected    string
		wantPart        SeriesPart
		wantUnitUnknown bool
	}{
		{name: "milliseconds where registry says seconds", observed: "http_server_request_duration_milliseconds_bucket", wantMiss: true, wantMetric: "http.server.request.duration", wantFound: "milliseconds", wantExpected: "seconds", wantPart: PartBucket},
		{name: "kilobytes where registry says bytes", observed: "process_memory_usage_kilobytes", wantMiss: true, wantMetric: "process.memory.usage", wantFound: "kilobytes", wantExpected: "bytes"},
		{name: "utf8 name with wrong unit", observed: "http.server.request.duration_milliseconds_count", wantMiss: true, wantMetric: "http.server.request.duration", wantFound: "milliseconds", wantExpected: "seconds", wantPart: PartCount},
		{name: "history-only metric with any unit", observed: "http_server_duration_milliseconds_bucket", wantMiss: true, wantMetric: "http.server.duration", wantFound: "milliseconds", wantPart: PartBucket, wantUnitUnknown: true},
		{name: "exact match is not a near miss", observed: "http_server_request_duration_seconds_bucket"},
		{name: "unrelated name", observed: "my_app_latency_milliseconds"},
		{name: "bucket on a non-histogram", observed: "process_memory_usage_kilobytes_bucket"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			miss, found := index.NearMiss(tt.observed)

			if found != tt.wantMiss {
				t.Fatalf("near miss = %v (%+v), want %v", found, miss, tt.wantMiss)
			}
			if !found {
				return
			}
			if miss.Metric.Name != tt.wantMetric || miss.FoundUnit != tt.wantFound || miss.ExpectedUnit != tt.wantExpected || miss.Part != tt.wantPart || miss.UnitUnknown != tt.wantUnitUnknown {
				t.Errorf("miss = %+v", miss)
			}
		})
	}
}

func Test_UnitCheckable(t *testing.T) {
	seconds := catalogue.Metric{Unit: "s", Instrument: "histogram"}
	annotation := catalogue.Metric{Unit: "{request}", Instrument: "counter"}
	ratio := catalogue.Metric{Unit: "1", Instrument: "gauge"}

	tests := []struct {
		name     string
		metric   catalogue.Metric
		strategy Strategy
		want     bool
	}{
		{name: "suffix strategy with unit", metric: seconds, strategy: otlptranslator.UnderscoreEscapingWithSuffixes, want: true},
		{name: "without suffixes", metric: seconds, strategy: otlptranslator.UnderscoreEscapingWithoutSuffixes},
		{name: "no translation", metric: seconds, strategy: otlptranslator.NoTranslation},
		{name: "annotation unit", metric: annotation, strategy: otlptranslator.UnderscoreEscapingWithSuffixes},
		{name: "dimensionless gauge gets ratio", metric: ratio, strategy: otlptranslator.NoUTF8EscapingWithSuffixes, want: true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := UnitCheckable(tt.metric, tt.strategy); got != tt.want {
				t.Errorf("got %v, want %v", got, tt.want)
			}
		})
	}
}

func Test_CheckUnitLabel(t *testing.T) {
	seconds := catalogue.Metric{Unit: "s", Instrument: "histogram"}

	tests := []struct {
		name         string
		unitLabel    string
		wantMismatch bool
	}{
		{name: "matching label", unitLabel: "seconds"},
		{name: "wrong label", unitLabel: "milliseconds", wantMismatch: true},
		{name: "absent label", unitLabel: ""},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			expected, mismatch := CheckUnitLabel(seconds, tt.unitLabel)
			if expected != "seconds" || mismatch != tt.wantMismatch {
				t.Errorf("got (%q, %v), want (seconds, %v)", expected, mismatch, tt.wantMismatch)
			}
		})
	}
}
