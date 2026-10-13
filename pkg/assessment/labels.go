package assessment

import (
	"fmt"
	"slices"

	"github.com/iambenzo/otel-semconv-compliance/pkg/catalogue"
	"github.com/iambenzo/otel-semconv-compliance/pkg/finding"
	"github.com/iambenzo/otel-semconv-compliance/pkg/identity"
	"github.com/iambenzo/otel-semconv-compliance/pkg/nameindex"
	"github.com/iambenzo/otel-semconv-compliance/pkg/scoring"
)

const (
	maxMetricsPerLabelFinding = 20
	stackAddedShare           = 0.9
	stackAddedMinSets         = 3
	stackAddedMinOwners       = 2
	stackAddedPipeline        = "stack-added labels"
)

var structuralMetricLabels = map[string]bool{
	"__name__": true, "job": true, "instance": true, "le": true, "quantile": true,
	"otel_scope_name": true, "otel_scope_version": true, "__type__": true, "__unit__": true,
}

type labelFindingKey struct {
	owner    finding.Owner
	observed string
	kind     finding.Type
}

type labelCollector struct {
	into     *collected
	position map[labelFindingKey]int
}

func (a *Assessor) assessLabelKeys(datasource MetricDatasource, targets identity.TargetIndex, rules []ReclassificationRule, volumes map[string]float64, into *collected) {
	labels := labelCollector{into: into, position: map[labelFindingKey]int{}}
	stackAdded := stackAddedKeys(datasource.LabelKeys, targets)
	for _, set := range datasource.LabelKeys {
		if _, reclassified := Reclassify(set.Metric, rules); reclassified {
			continue
		}
		registryMetric, known := a.registryMetricFor(set.Metric)
		if !known {
			continue
		}
		owner := identity.ResolveMetricOwner(set.Selector, targets, 0).Attribution.Owner
		volume := volumes[ownerMetricKey(owner, set.Metric)]
		present := map[string]bool{}
		for _, key := range set.Keys {
			if structuralMetricLabels[key] {
				continue
			}
			match := a.attributes.Match(key, nameindex.Context{Scope: catalogue.ScopeMetrics, Metric: registryMetric.Name})
			if match.Attribute != nil {
				present[match.Attribute.Name] = true
			}
			classified := a.classifier.Attribute(finding.Observation{Owner: owner, Signal: finding.SignalMetrics, Volume: volume}, match, catalogue.ScopeMetrics)
			if stackAdded[key] && match.Classification != nameindex.ClassMatched {
				classified = asStackAdded(classified, owner)
			}
			labels.add(classified, set.Metric)
		}
		a.metricRequirements(owner, registryMetric, set.Metric, present, volume, &labels)
	}
}

func stackAddedKeys(sets []OwnerLabelKeys, targets identity.TargetIndex) map[string]bool {
	if len(sets) < stackAddedMinSets {
		return nil
	}
	counts := map[string]int{}
	owners := map[string]map[finding.Owner]bool{}
	for _, set := range sets {
		owner := identity.ResolveMetricOwner(set.Selector, targets, 0).Attribution.Owner
		for _, key := range set.Keys {
			counts[key]++
			if owners[key] == nil {
				owners[key] = map[finding.Owner]bool{}
			}
			owners[key][owner] = true
		}
	}
	stackAdded := map[string]bool{}
	for key, count := range counts {
		if float64(count) >= stackAddedShare*float64(len(sets)) && len(owners[key]) >= stackAddedMinOwners {
			stackAdded[key] = true
		}
	}
	return stackAdded
}

func asStackAdded(classified finding.Finding, service finding.Owner) finding.Finding {
	moved := classified
	moved.Owner = finding.Owner{Kind: finding.OwnerPipeline, Name: stackAddedPipeline}
	moved.Type = finding.TypeCustom
	moved.Level = finding.LevelOf(finding.TypeCustom)
	moved.Bucket = ""
	moved.PipelineIntroduced = true
	moved.Note = joinNote("present on nearly every series across owners, so added by the stack rather than by "+ownerLabel(service), classified.Note)
	return moved
}

func ownerLabel(owner finding.Owner) string {
	if owner.Namespace != "" {
		return owner.Namespace + "/" + owner.Name
	}
	return owner.Name
}

func (a *Assessor) registryMetricFor(observed string) (catalogue.Metric, bool) {
	if match := a.metrics.Match(observed); match.Matched {
		return match.Form.Metric, true
	}
	if miss, found := a.metrics.NearMiss(observed); found {
		return miss.Metric, true
	}
	return catalogue.Metric{}, false
}

func (a *Assessor) metricRequirements(owner finding.Owner, metric catalogue.Metric, observed string, present map[string]bool, volume float64, labels *labelCollector) {
	for _, ref := range metric.Attributes {
		if ref.RequirementLevel.Level != "required" {
			continue
		}
		satisfied := present[ref.Name]
		labels.into.requirements = append(labels.into.requirements, scoring.RequirementCheck{Owner: owner, Signal: finding.SignalMetrics, Satisfied: satisfied, Volume: volume})
		if satisfied {
			continue
		}
		labels.add(finding.Finding{
			Type:       finding.TypeRequiredAttributeMissing,
			Level:      finding.LevelOf(finding.TypeRequiredAttributeMissing),
			Signal:     finding.SignalMetrics,
			Owner:      owner,
			Observed:   metric.Name,
			Scope:      catalogue.ScopeMetrics,
			Expected:   ref.Name,
			Confidence: nameindex.ConfidenceMedium,
			Note:       fmt.Sprintf("no label for %s on %s; %s", ref.Name, observed, downstreamCaveat),
			Volume:     volume,
		}, observed)
	}
}

func (c *labelCollector) add(f finding.Finding, metric string) {
	key := labelFindingKey{owner: f.Owner, observed: f.Observed + "|" + f.Expected, kind: f.Type}
	if position, seen := c.position[key]; seen {
		existing := &c.into.findings[position]
		existing.Volume += f.Volume
		if len(existing.Metrics) < maxMetricsPerLabelFinding && !slices.Contains(existing.Metrics, metric) {
			existing.Metrics = append(existing.Metrics, metric)
		}
		return
	}
	f.Metrics = []string{metric}
	c.position[key] = len(c.into.findings)
	c.into.findings = append(c.into.findings, f)
}

func ownerMetricKey(owner finding.Owner, metric string) string {
	return string(owner.Kind) + "|" + owner.Namespace + "|" + owner.Name + "|" + metric
}
