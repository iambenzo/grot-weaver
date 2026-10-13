package nameindex

import (
	"slices"
	"strings"

	"github.com/prometheus/otlptranslator"

	"github.com/iambenzo/otel-semconv-compliance/pkg/catalogue"
)

const totalSuffix = "_total"

var (
	ucumMainUnits = []string{
		"d", "h", "min", "s", "ms", "us", "ns",
		"By", "KiBy", "MiBy", "GiBy", "TiBy", "KBy", "MBy", "GBy", "TBy",
		"m", "V", "A", "J", "W", "g", "Cel", "Hz", "%",
	}
	ucumPerUnits = []string{"s", "m", "h", "d", "w", "mo", "y"}
	unitSuffixes = buildUnitSuffixes()
)

type NearMiss struct {
	Observed     string           `json:"observed"`
	Metric       catalogue.Metric `json:"metric"`
	Part         SeriesPart       `json:"part,omitempty"`
	FoundUnit    string           `json:"found_unit"`
	ExpectedUnit string           `json:"expected_unit"`
	UnitUnknown  bool             `json:"unit_unknown,omitempty"`
}

func buildUnitSuffixes() []string {
	namer := otlptranslator.UnitNamer{}
	suffixes := []string{"ratio"}
	for _, main := range ucumMainUnits {
		suffixes = append(suffixes, namer.Build(main))
		for _, per := range ucumPerUnits {
			suffixes = append(suffixes, namer.Build(main+"/"+per))
		}
	}
	for _, per := range ucumPerUnits {
		suffixes = append(suffixes, namer.Build("1/"+per))
	}
	suffixes = slices.DeleteFunc(suffixes, func(s string) bool { return s == "" })
	slices.SortFunc(suffixes, func(a, b string) int { return len(b) - len(a) })
	return slices.Compact(suffixes)
}

func ExpectedUnitSuffix(metric catalogue.Metric) string {
	namer := otlptranslator.UnitNamer{}
	suffix := namer.Build(metric.Unit)
	if suffix == "" && metric.Unit == "1" && metric.Instrument == "gauge" {
		return "ratio"
	}
	return suffix
}

func UnitCheckable(metric catalogue.Metric, strategy Strategy) bool {
	return strategy.ShouldAddSuffixes() && ExpectedUnitSuffix(metric) != ""
}

func CheckUnitLabel(metric catalogue.Metric, unitLabel string) (expected string, mismatch bool) {
	expected = ExpectedUnitSuffix(metric)
	if unitLabel == "" || expected == "ratio" {
		return expected, false
	}
	return expected, unitLabel != expected
}

func (i *MetricIndex) NearMiss(observed string) (NearMiss, bool) {
	if _, exact := i.byStored[observed]; exact {
		return NearMiss{}, false
	}
	stem, part := SplitPart(observed)
	stem = strings.TrimSuffix(stem, totalSuffix)
	for _, suffix := range unitSuffixes {
		base, found := strings.CutSuffix(stem, "_"+suffix)
		if !found {
			continue
		}
		for _, metric := range i.byBare[base] {
			if miss, ok := nearMissFor(observed, metric, part, suffix); ok {
				return miss, true
			}
		}
	}
	return NearMiss{}, false
}

func nearMissFor(observed string, metric catalogue.Metric, part SeriesPart, found string) (NearMiss, bool) {
	if part != PartWhole && metric.Instrument != "histogram" && metric.Source != catalogue.SourceRenameHistory {
		return NearMiss{}, false
	}
	miss := NearMiss{Observed: observed, Metric: metric, Part: part, FoundUnit: found}
	if metric.Source == catalogue.SourceRenameHistory {
		miss.UnitUnknown = true
		return miss, true
	}
	miss.ExpectedUnit = ExpectedUnitSuffix(metric)
	return miss, miss.ExpectedUnit != found
}

func SplitPart(observed string) (string, SeriesPart) {
	for _, part := range []SeriesPart{PartBucket, PartSum, PartCount} {
		if stem, found := strings.CutSuffix(observed, "_"+string(part)); found {
			return stem, part
		}
	}
	return observed, PartWhole
}
