package catalogue

const reasonRenamed = "renamed"

func (c *Catalogue) Attribute(name string, scope RenameScope, metric string) (Attribute, bool) {
	if index, known := c.attributeIndex[name]; known {
		return c.Registry.Attributes[index], true
	}
	renamedTo, renamed := c.Renames.ResolveAttribute(name, scope, metric)
	if !renamed {
		return Attribute{}, false
	}
	return Attribute{
		Name:       name,
		Deprecated: &Deprecation{Reason: reasonRenamed, RenamedTo: renamedTo},
		Source:     SourceRenameHistory,
	}, true
}

func (c *Catalogue) Metric(name string) (Metric, bool) {
	if index, known := c.metricIndex[name]; known {
		return c.Registry.Metrics[index], true
	}
	renamedTo, renamed := c.Renames.ResolveMetric(name)
	if !renamed {
		return Metric{}, false
	}
	return Metric{
		Name:       name,
		Deprecated: &Deprecation{Reason: reasonRenamed, RenamedTo: renamedTo},
		Source:     SourceRenameHistory,
	}, true
}

func indexByName[T any](items []T, name func(T) string) map[string]int {
	index := make(map[string]int, len(items))
	for i, item := range items {
		index[name(item)] = i
	}
	return index
}
