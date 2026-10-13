package nameindex

import (
	"slices"

	"github.com/prometheus/otlptranslator"

	"github.com/iambenzo/otel-semconv-compliance/pkg/catalogue"
)

type Strategy = otlptranslator.TranslationStrategyOption

var Strategies = []Strategy{
	otlptranslator.UnderscoreEscapingWithSuffixes,
	otlptranslator.UnderscoreEscapingWithoutSuffixes,
	otlptranslator.NoUTF8EscapingWithSuffixes,
	otlptranslator.NoTranslation,
}

type SeriesPart string

const (
	PartWhole  SeriesPart = ""
	PartBucket SeriesPart = "bucket"
	PartSum    SeriesPart = "sum"
	PartCount  SeriesPart = "count"
)

var histogramParts = []SeriesPart{PartWhole, PartBucket, PartSum, PartCount}

type MetricForm struct {
	Metric     catalogue.Metric `json:"metric"`
	Part       SeriesPart       `json:"part,omitempty"`
	Strategies []Strategy       `json:"strategies"`
}

type MetricMatch struct {
	Observed     string       `json:"observed"`
	Matched      bool         `json:"matched"`
	Form         *MetricForm  `json:"form,omitempty"`
	Alternatives []MetricForm `json:"alternatives,omitempty"`
	Confidence   Confidence   `json:"confidence,omitempty"`
}

type MetricIndex struct {
	byStored map[string][]MetricForm
}

func NewMetricIndex(c *catalogue.Catalogue) *MetricIndex {
	index := &MetricIndex{byStored: map[string][]MetricForm{}}
	for _, metric := range metricsWithHistory(c) {
		index.add(metric)
	}
	return index
}

func metricsWithHistory(c *catalogue.Catalogue) []catalogue.Metric {
	metrics := slices.Clone(c.Registry.Metrics)
	seen := map[string]bool{}
	for _, metric := range metrics {
		seen[metric.Name] = true
	}
	for _, rename := range c.Renames.Metrics {
		if seen[rename.From] {
			continue
		}
		seen[rename.From] = true
		if historic, found := c.Metric(rename.From); found {
			metrics = append(metrics, historic)
		}
	}
	return metrics
}

func (i *MetricIndex) add(metric catalogue.Metric) {
	for _, strategy := range Strategies {
		namer := otlptranslator.NewMetricNamer("", strategy)
		base, err := namer.Build(otlptranslator.Metric{Name: metric.Name, Unit: metric.Unit, Type: metricType(metric.Instrument)})
		if err != nil {
			continue
		}
		for _, part := range partsFor(metric.Instrument) {
			i.record(storedName(base, part), metric, part, strategy)
		}
	}
}

func (i *MetricIndex) record(stored string, metric catalogue.Metric, part SeriesPart, strategy Strategy) {
	forms := i.byStored[stored]
	for index := range forms {
		if forms[index].Metric.Name == metric.Name && forms[index].Part == part {
			if !slices.Contains(forms[index].Strategies, strategy) {
				forms[index].Strategies = append(forms[index].Strategies, strategy)
			}
			return
		}
	}
	i.byStored[stored] = append(forms, MetricForm{Metric: metric, Part: part, Strategies: []Strategy{strategy}})
}

func (i *MetricIndex) Match(observed string) MetricMatch {
	forms, found := i.byStored[observed]
	if !found {
		return MetricMatch{Observed: observed}
	}
	ordered, confidence := rankCandidates(forms, func(f MetricForm) bool { return f.Metric.Deprecated == nil })
	chosen := ordered[0]
	return MetricMatch{Observed: observed, Matched: true, Form: &chosen, Alternatives: ordered[1:], Confidence: confidence}
}

func (i *MetricIndex) StoredNames() map[string][]MetricForm {
	copied := make(map[string][]MetricForm, len(i.byStored))
	for name, forms := range i.byStored {
		copied[name] = slices.Clone(forms)
	}
	return copied
}

func metricType(instrument string) otlptranslator.MetricType {
	switch instrument {
	case "counter":
		return otlptranslator.MetricTypeMonotonicCounter
	case "updowncounter":
		return otlptranslator.MetricTypeNonMonotonicCounter
	case "gauge":
		return otlptranslator.MetricTypeGauge
	case "histogram":
		return otlptranslator.MetricTypeHistogram
	default:
		return otlptranslator.MetricTypeUnknown
	}
}

func partsFor(instrument string) []SeriesPart {
	if instrument == "histogram" {
		return histogramParts
	}
	return []SeriesPart{PartWhole}
}

func storedName(base string, part SeriesPart) string {
	if part == PartWhole {
		return base
	}
	return base + "_" + string(part)
}
