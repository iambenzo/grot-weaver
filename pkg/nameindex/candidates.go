package nameindex

import "slices"

func rankCandidates[T any](candidates []T, isCurrent func(T) bool) ([]T, Confidence) {
	ordered := slices.Clone(candidates)
	slices.SortStableFunc(ordered, func(a, b T) int {
		return currentRank(isCurrent(a)) - currentRank(isCurrent(b))
	})
	current := 0
	for _, candidate := range ordered {
		if isCurrent(candidate) {
			current++
		}
	}
	if len(ordered) == 1 || current == 1 {
		return ordered, ConfidenceHigh
	}
	return ordered, ConfidenceMedium
}

func currentRank(current bool) int {
	if current {
		return 0
	}
	return 1
}
