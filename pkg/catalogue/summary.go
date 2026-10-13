package catalogue

type Summary struct {
	Manifest  Manifest          `json:"manifest"`
	Counts    Counts            `json:"counts"`
	Stability StabilitySummary  `json:"stability"`
	Renames   RenameHistoryInfo `json:"renames"`
}

type Counts struct {
	Attributes int `json:"attributes"`
	Metrics    int `json:"metrics"`
	Spans      int `json:"spans"`
	Entities   int `json:"entities"`
	Events     int `json:"events"`
}

type StabilitySummary struct {
	Attributes StabilityBreakdown `json:"attributes"`
	Metrics    StabilityBreakdown `json:"metrics"`
}

type StabilityBreakdown struct {
	Stable           int `json:"stable"`
	ReleaseCandidate int `json:"release_candidate"`
	Development      int `json:"development"`
	Alpha            int `json:"alpha"`
	Deprecated       int `json:"deprecated"`
}

type RenameHistoryInfo struct {
	Attributes int `json:"attributes"`
	Metrics    int `json:"metrics"`
}

func (c *Catalogue) Summary() Summary {
	registry := c.Registry
	return Summary{
		Manifest: c.Manifest,
		Counts: Counts{
			Attributes: len(registry.Attributes),
			Metrics:    len(registry.Metrics),
			Spans:      len(registry.Spans),
			Entities:   len(registry.Entities),
			Events:     len(registry.Events),
		},
		Stability: StabilitySummary{
			Attributes: breakdown(registry.Attributes, func(a Attribute) (Stability, bool) { return a.Stability, a.Deprecated != nil }),
			Metrics:    breakdown(registry.Metrics, func(m Metric) (Stability, bool) { return m.Stability, m.Deprecated != nil }),
		},
		Renames: RenameHistoryInfo{Attributes: len(c.Renames.Attributes), Metrics: len(c.Renames.Metrics)},
	}
}

func breakdown[T any](items []T, status func(T) (Stability, bool)) StabilityBreakdown {
	var result StabilityBreakdown
	for _, item := range items {
		stability, deprecated := status(item)
		if deprecated {
			result.Deprecated++
			continue
		}
		switch stability {
		case StabilityStable:
			result.Stable++
		case StabilityReleaseCandidate:
			result.ReleaseCandidate++
		case StabilityDevelopment:
			result.Development++
		case StabilityAlpha:
			result.Alpha++
		}
	}
	return result
}
