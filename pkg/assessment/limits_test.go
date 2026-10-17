package assessment

import (
	"os"
	"regexp"
	"strconv"
	"testing"
)

func Test_frontendLimits_matchBackendLimits(t *testing.T) {
	source, err := os.ReadFile("../../src/inventory/limits.ts")
	if err != nil {
		t.Fatal(err)
	}
	declared := map[string]int{}
	for _, match := range regexp.MustCompile(`export const (MAX_[A-Z_]+) = (\d+);`).FindAllStringSubmatch(string(source), -1) {
		value, err := strconv.Atoi(match[2])
		if err != nil {
			t.Fatal(err)
		}
		declared[match[1]] = value
	}
	want := map[string]int{
		"MAX_METRIC_NAMES":       MaxMetricNames,
		"MAX_OWNERS_PER_SOURCE":  MaxOwnersPerSource,
		"MAX_TARGET_INFO_SERIES": MaxTargetInfoSeries,
		"MAX_TRACE_SERVICES":     MaxServicesPerTrace,
		"MAX_LOG_SERVICES":       MaxLogServices,
	}
	if len(declared) != len(want) {
		t.Errorf("frontend declares %v, want exactly %v", declared, want)
	}
	for name, value := range want {
		if declared[name] != value {
			t.Errorf("%s = %d in src/inventory/limits.ts, backend uses %d", name, declared[name], value)
		}
	}
}
