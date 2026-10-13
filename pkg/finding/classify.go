package finding

import (
	"github.com/iambenzo/otel-semconv-compliance/pkg/catalogue"
	"github.com/iambenzo/otel-semconv-compliance/pkg/nameindex"
)

type Classifier struct {
	catalogue *catalogue.Catalogue
}

type Observation struct {
	Owner  Owner
	Signal Signal
	Volume float64
}

func NewClassifier(c *catalogue.Catalogue) Classifier {
	return Classifier{catalogue: c}
}

const maxReplacementHops = 10

type replacementLookup func(name string) (catalogue.Stability, *catalogue.Deprecation, bool)

func (c Classifier) AttributeBucket(attribute catalogue.Attribute, scope catalogue.RenameScope) Bucket {
	return bucketFor(attribute.Stability, attribute.Deprecated, func(name string) (catalogue.Stability, *catalogue.Deprecation, bool) {
		replacement, found := c.catalogue.Attribute(name, scope, "")
		return replacement.Stability, replacement.Deprecated, found
	})
}

func (c Classifier) MetricBucket(metric catalogue.Metric) Bucket {
	return bucketFor(metric.Stability, metric.Deprecated, func(name string) (catalogue.Stability, *catalogue.Deprecation, bool) {
		replacement, found := c.catalogue.Metric(name)
		return replacement.Stability, replacement.Deprecated, found
	})
}

func bucketFor(stability catalogue.Stability, deprecation *catalogue.Deprecation, lookup replacementLookup) Bucket {
	if deprecation == nil {
		return bucketForStability(stability)
	}
	current := deprecation
	for hop := 0; hop < maxReplacementHops && current != nil && current.RenamedTo != ""; hop++ {
		replacementStability, replacementDeprecation, found := lookup(current.RenamedTo)
		if !found {
			break
		}
		if replacementDeprecation == nil {
			return bucketForStability(replacementStability)
		}
		current = replacementDeprecation
	}
	if stability == "" {
		return BucketExperimental
	}
	return bucketForStability(stability)
}

func bucketForStability(stability catalogue.Stability) Bucket {
	switch stability {
	case catalogue.StabilityStable:
		return BucketStable
	case catalogue.StabilityReleaseCandidate:
		return BucketReleaseCandidate
	default:
		return BucketExperimental
	}
}

func (c Classifier) Attribute(at Observation, match nameindex.AttributeMatch, scope catalogue.RenameScope) Finding {
	result := Finding{Signal: at.Signal, Owner: at.Owner, Observed: match.Observed, Scope: scope, Volume: at.Volume, Confidence: match.Confidence}
	switch match.Classification {
	case nameindex.ClassCustom:
		return withType(result, TypeCustom)
	case nameindex.ClassNotInRegistry:
		result.Bucket = BucketUnclassified
		return withType(result, TypeNotInRegistry)
	}
	attribute := *match.Attribute
	result.Matched = attribute.Name
	result.Source = attribute.Source
	result.Bucket = c.AttributeBucket(attribute, scope)
	if attribute.Deprecated == nil {
		result.Expected = attribute.Name
		return withType(result, TypeConformant)
	}
	return deprecated(result, attribute.Deprecated)
}

func (c Classifier) Metric(at Observation, match nameindex.MetricMatch) Finding {
	result := Finding{Signal: SignalMetrics, Owner: at.Owner, Observed: match.Observed, Volume: at.Volume, Confidence: match.Confidence}
	metric := match.Form.Metric
	result.Matched = metric.Name
	result.Source = metric.Source
	result.Bucket = c.MetricBucket(metric)
	if metric.Deprecated == nil {
		result.Expected = metric.Name
		return withType(result, TypeConformant)
	}
	return deprecated(result, metric.Deprecated)
}

func (c Classifier) NearMiss(at Observation, miss nameindex.NearMiss) Finding {
	result := Finding{Signal: SignalMetrics, Owner: at.Owner, Observed: miss.Observed, Volume: at.Volume, Confidence: nameindex.ConfidenceHigh}
	metric := miss.Metric
	result.Matched = metric.Name
	result.Source = metric.Source
	result.Bucket = c.MetricBucket(metric)
	if miss.UnitUnknown {
		result.Confidence = nameindex.ConfidenceMedium
		return deprecated(result, metric.Deprecated)
	}
	result.Expected = metric.Name
	result.Note = "unit suffix " + miss.FoundUnit + ", registry unit maps to " + miss.ExpectedUnit
	return withType(result, TypeUnitMismatch)
}

func deprecated(result Finding, deprecation *catalogue.Deprecation) Finding {
	if deprecation != nil {
		result.Expected = deprecation.RenamedTo
		result.Note = deprecation.Note
	}
	return withType(result, TypeDeprecated)
}

func withType(result Finding, t Type) Finding {
	result.Type = t
	result.Level = LevelOf(t)
	return result
}
