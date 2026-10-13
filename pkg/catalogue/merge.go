package catalogue

func Overlay(base, override Registry) Registry {
	return Registry{
		Attributes: overlayByKey(base.Attributes, override.Attributes, func(a Attribute) string { return a.Name }),
		Metrics:    overlayByKey(base.Metrics, override.Metrics, func(m Metric) string { return m.Name }),
		Spans:      overlayByKey(base.Spans, override.Spans, func(s Span) string { return s.ID }),
		Entities:   overlayByKey(base.Entities, override.Entities, func(e Entity) string { return e.Name }),
		Events:     overlayByKey(base.Events, override.Events, func(e Event) string { return e.Name }),
	}
}

func overlayByKey[T any](base, override []T, key func(T) string) []T {
	pending := make(map[string]T, len(override))
	for _, item := range override {
		pending[key(item)] = item
	}

	merged := make([]T, 0, len(base)+len(override))
	for _, item := range base {
		replacement, replaced := pending[key(item)]
		if !replaced {
			merged = append(merged, item)
			continue
		}
		merged = append(merged, replacement)
		delete(pending, key(item))
	}

	for _, item := range override {
		if addition, stillPending := pending[key(item)]; stillPending {
			merged = append(merged, addition)
			delete(pending, key(item))
		}
	}
	return merged
}
