package scoring

import (
	"cmp"
	"slices"

	"github.com/iambenzo/grot-weaver/pkg/finding"
)

type RankedFinding struct {
	finding.Finding
	ImpactShare float64 `json:"impact_share"`
}

func RankByImpact(findings []finding.Finding, signalTotals map[finding.Signal]float64) []RankedFinding {
	ranked := make([]RankedFinding, 0, len(findings))
	for _, f := range findings {
		share := 0.0
		if total := signalTotals[f.Signal]; total > 0 {
			share = f.Volume / total
		}
		ranked = append(ranked, RankedFinding{Finding: f, ImpactShare: share})
	}
	slices.SortStableFunc(ranked, func(a, b RankedFinding) int {
		if c := cmp.Compare(a.Signal, b.Signal); c != 0 {
			return c
		}
		return cmp.Compare(b.ImpactShare, a.ImpactShare)
	})
	return ranked
}
