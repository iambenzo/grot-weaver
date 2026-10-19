package assessment

import (
	"slices"

	"github.com/prometheus/otlptranslator"

	"github.com/iambenzo/grot-weaver/pkg/nameindex"
)

type DatasourceSummary struct {
	UID           string             `json:"uid"`
	Signal        string             `json:"signal"`
	Strategy      nameindex.Strategy `json:"strategy,omitempty"`
	Overridden    bool               `json:"overridden,omitempty"`
	Mixed         bool               `json:"mixed,omitempty"`
	Evidence      StrategyEvidence   `json:"evidence"`
	UnitCheckable bool               `json:"unit_checkable"`
}

type StrategyEvidence struct {
	Escaped     int `json:"escaped"`
	UTF8        int `json:"utf8"`
	Suffixed    int `json:"suffixed"`
	NotSuffixed int `json:"not_suffixed"`
}

const mixedMinorityShare = 0.1

var defaultStrategy = otlptranslator.UnderscoreEscapingWithSuffixes

func (a *Assessor) detectStrategy(datasource MetricDatasource) DatasourceSummary {
	evidence := StrategyEvidence{}
	for _, name := range datasource.Names {
		match := a.metrics.Match(name)
		if match.Matched {
			evidence = evidence.add(match.Form.Strategies)
		}
	}
	summary := DatasourceSummary{
		UID:           datasource.UID,
		Signal:        "metrics",
		Evidence:      evidence,
		Strategy:      evidence.dominant(),
		Mixed:         evidence.mixed(),
		UnitCheckable: evidence.Suffixed > 0,
	}
	if datasource.StrategyOverride != "" {
		summary.Strategy = datasource.StrategyOverride
		summary.Overridden = true
		summary.UnitCheckable = datasource.StrategyOverride.ShouldAddSuffixes()
	}
	return summary
}

func (e StrategyEvidence) add(strategies []nameindex.Strategy) StrategyEvidence {
	if escaping, decisive := unanimous(strategies, nameindex.Strategy.ShouldEscape); decisive {
		if escaping {
			e.Escaped++
		} else {
			e.UTF8++
		}
	}
	if suffixed, decisive := unanimous(strategies, nameindex.Strategy.ShouldAddSuffixes); decisive {
		if suffixed {
			e.Suffixed++
		} else {
			e.NotSuffixed++
		}
	}
	return e
}

func unanimous(strategies []nameindex.Strategy, property func(nameindex.Strategy) bool) (value, decisive bool) {
	if len(strategies) == 0 {
		return false, false
	}
	first := property(strategies[0])
	for _, strategy := range strategies[1:] {
		if property(strategy) != first {
			return false, false
		}
	}
	return first, true
}

func (e StrategyEvidence) dominant() nameindex.Strategy {
	escaped := e.Escaped >= e.UTF8
	suffixed := e.Suffixed >= e.NotSuffixed
	if e.Escaped+e.UTF8+e.Suffixed+e.NotSuffixed == 0 {
		return defaultStrategy
	}
	switch {
	case escaped && suffixed:
		return otlptranslator.UnderscoreEscapingWithSuffixes
	case escaped:
		return otlptranslator.UnderscoreEscapingWithoutSuffixes
	case suffixed:
		return otlptranslator.NoUTF8EscapingWithSuffixes
	default:
		return otlptranslator.NoTranslation
	}
}

func (e StrategyEvidence) mixed() bool {
	return minorityShare(e.Escaped, e.UTF8) >= mixedMinorityShare || minorityShare(e.Suffixed, e.NotSuffixed) >= mixedMinorityShare
}

func minorityShare(a, b int) float64 {
	if a+b == 0 {
		return 0
	}
	return float64(min(a, b)) / float64(a+b)
}

func preferStrategy(match nameindex.MetricMatch, strategy nameindex.Strategy) nameindex.MetricMatch {
	if !match.Matched || len(match.Alternatives) == 0 || slices.Contains(match.Form.Strategies, strategy) {
		return match
	}
	for index, alternative := range match.Alternatives {
		if slices.Contains(alternative.Strategies, strategy) && (alternative.Metric.Deprecated == nil) == (match.Form.Metric.Deprecated == nil) {
			chosen := alternative
			rest := append(slices.Clone(match.Alternatives[:index]), match.Alternatives[index+1:]...)
			match.Alternatives = append(rest, *match.Form)
			match.Form = &chosen
			return match
		}
	}
	return match
}
