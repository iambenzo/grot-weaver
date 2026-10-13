package finding

import "github.com/iambenzo/otel-semconv-compliance/pkg/catalogue"

func (c Classifier) Misplacement(classified Finding) (Finding, bool) {
	if classified.Matched == "" || classified.Signal != SignalTraces {
		return Finding{}, false
	}
	placement := c.catalogue.Placement(classified.Matched)
	var note string
	switch {
	case classified.Scope == catalogue.ScopeResources && placement.Signal && !placement.Resource:
		note = "defined for spans, metrics or events, but sent as a resource attribute"
	case classified.Scope == catalogue.ScopeSpans && placement.Resource && !placement.Signal:
		note = "defined as a resource (entity) attribute, but sent on spans"
	default:
		return Finding{}, false
	}
	misplaced := classified
	misplaced.Expected = classified.Matched
	misplaced.Note = note
	return withType(misplaced, TypeMisplacedAttribute), true
}
