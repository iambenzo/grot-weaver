package catalogue

type Placement struct {
	Resource bool
	Signal   bool
}

func (c *Catalogue) Placement(name string) Placement {
	return c.placements[name]
}

func placementsOf(registry Registry) map[string]Placement {
	placements := map[string]Placement{}
	mark := func(refs []AttributeRef, resource bool) {
		for _, ref := range refs {
			placement := placements[ref.Name]
			if resource {
				placement.Resource = true
			} else {
				placement.Signal = true
			}
			placements[ref.Name] = placement
		}
	}
	for _, entity := range registry.Entities {
		mark(entity.Attributes, true)
	}
	for _, span := range registry.Spans {
		mark(span.Attributes, false)
	}
	for _, metric := range registry.Metrics {
		mark(metric.Attributes, false)
	}
	for _, event := range registry.Events {
		mark(event.Attributes, false)
	}
	return placements
}
