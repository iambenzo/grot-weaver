package assessment

import (
	"fmt"
	"slices"

	"github.com/iambenzo/otel-semconv-compliance/pkg/catalogue"
	"github.com/iambenzo/otel-semconv-compliance/pkg/finding"
	"github.com/iambenzo/otel-semconv-compliance/pkg/identity"
	"github.com/iambenzo/otel-semconv-compliance/pkg/nameindex"
)

const collectorScrapePipeline = "collector prometheus receiver"

type MetricAttribution struct {
	Datasource string `json:"datasource"`
	identity.Attribution
	Origin identity.OriginClassification `json:"origin"`
	SDK    identity.SDK                  `json:"sdk"`
	Hints  map[string]string             `json:"hints,omitempty"`
}

func (a *Assessor) assessMetricDatasource(datasource MetricDatasource, rules []ReclassificationRule, into *collected) {
	summary := a.detectStrategy(datasource)
	into.datasources = append(into.datasources, summary)
	targets := identity.NewTargetIndex(datasource.TargetInfo)
	into.collectors = append(into.collectors, collectorsFrom(datasource.Collectors)...)
	identityFindings := map[finding.Owner][]int{}
	volumes := map[string]float64{}
	names := metricNameCollector{into: into, position: map[metricNameKey]int{}}
	for _, owner := range datasource.Owners {
		if _, reclassified := Reclassify(owner.Metric, rules); reclassified {
			continue
		}
		resolution := identity.ResolveMetricOwner(owner.Labels, targets, owner.Series)
		ownerKey := resolution.Attribution.Owner
		into.noteOwner(hopContext{owner: ownerKey, origin: resolution.Origin.Origin, target: resolution.Target})
		if positions, seen := identityFindings[ownerKey]; seen {
			for _, position := range positions {
				into.findings[position].Volume += owner.Series
			}
		} else {
			into.metricAttributions = append(into.metricAttributions, MetricAttribution{
				Datasource:  datasource.UID,
				Attribution: resolution.Attribution,
				Origin:      resolution.Origin,
				SDK:         resolution.SDK,
				Hints:       resolution.Hints,
			})
			into.checks = append(into.checks, resolution.Checks...)
			positions = make([]int, 0, len(resolution.Findings))
			for _, identityFinding := range resolution.Findings {
				positions = append(positions, len(into.findings))
				into.findings = append(into.findings, identityFinding)
			}
			identityFindings[ownerKey] = positions
		}
		into.resources.observe(ownerKey, finding.SignalMetrics, metricResource(ownerKey, owner.Labels, resolution.Target))
		names.add(a.classifyMetricName(ownerKey, owner, summary.Strategy))
		into.totals[finding.SignalMetrics] += owner.Series
		into.cover(finding.SignalMetrics, owner.Series, ownerKey.Kind == finding.OwnerService)
		volumes[ownerMetricKey(ownerKey, owner.Metric)] += owner.Series
	}
	into.findings = append(into.findings, a.receiverIntroducedFindings(targets)...)
	a.assessLabelKeys(datasource, targets, rules, volumes, into)
}

type metricNameKey struct {
	owner finding.Owner
	name  string
	kind  finding.Type
}

type metricNameCollector struct {
	into     *collected
	position map[metricNameKey]int
}

func (c *metricNameCollector) add(f finding.Finding) {
	base, part := nameindex.SplitPart(f.Observed)
	name := f.Matched
	if name == "" {
		name = base
	}
	key := metricNameKey{owner: f.Owner, name: name, kind: f.Type}
	if position, seen := c.position[key]; seen {
		existing := &c.into.findings[position]
		existing.Volume += f.Volume
		if !slices.Contains(existing.Metrics, f.Observed) {
			existing.Metrics = append(existing.Metrics, f.Observed)
		}
		if existing.Library == nil {
			existing.Library = f.Library
		}
		return
	}
	f.Metrics = []string{f.Observed}
	if part != nameindex.PartWhole {
		f.Observed = base
	}
	c.position[key] = len(c.into.findings)
	c.into.findings = append(c.into.findings, f)
}

func (a *Assessor) classifyMetricName(owner finding.Owner, row MetricOwner, strategy nameindex.Strategy) finding.Finding {
	classified := a.classifyMetricNameOnly(owner, row, strategy)
	classified.Library = scopeLibrary(row.Labels)
	return classified
}

func scopeLibrary(labels map[string]string) *finding.Library {
	name := labels[identity.ScopeNameLabel]
	if name == "" {
		return nil
	}
	return &finding.Library{Name: name, Version: labels[identity.ScopeVersionLabel], Evidence: "otel_scope_name label", Confidence: nameindex.ConfidenceHigh}
}

func (a *Assessor) classifyMetricNameOnly(owner finding.Owner, row MetricOwner, strategy nameindex.Strategy) finding.Finding {
	at := finding.Observation{Owner: owner, Signal: finding.SignalMetrics, Volume: row.Series}
	if match := a.metrics.Match(row.Metric); match.Matched {
		return a.classifier.Metric(at, preferStrategy(match, strategy))
	}
	if miss, found := a.metrics.NearMiss(row.Metric); found {
		return a.classifier.NearMiss(at, miss)
	}
	result := finding.Finding{Signal: finding.SignalMetrics, Owner: owner, Observed: row.Metric, Volume: row.Series}
	if a.metrics.InRegistryNamespace(row.Metric) {
		result.Type, result.Level, result.Bucket = finding.TypeNotInRegistry, finding.LevelOf(finding.TypeNotInRegistry), finding.BucketUnclassified
		return result
	}
	result.Type, result.Level = finding.TypeCustom, finding.LevelOf(finding.TypeCustom)
	return result
}

func (a *Assessor) receiverIntroducedFindings(targets identity.TargetIndex) []finding.Finding {
	var findings []finding.Finding
	jobs := make([]string, 0, len(targets.Jobs()))
	for job := range targets.Jobs() {
		jobs = append(jobs, job)
	}
	slices.Sort(jobs)
	for _, job := range jobs {
		labels := targets.Jobs()[job]
		if identity.ClassifyOrigin(labels, true, "").Origin != identity.OriginCollectorScraped {
			continue
		}
		pipeline := finding.Owner{Kind: finding.OwnerPipeline, Name: collectorScrapePipeline}
		at := finding.Observation{Owner: pipeline, Signal: finding.SignalMetrics}
		keys := identity.ScrapeTargetLabels(labels)
		slices.Sort(keys)
		for _, key := range keys {
			match := a.attributes.Match(key, nameindex.Context{Scope: catalogue.ScopeResources})
			classified := a.classifier.Attribute(at, match, catalogue.ScopeResources)
			classified.PipelineIntroduced = true
			classified.Note = joinNote(fmt.Sprintf("added to target_info by the scrape receiver for job %q", job), classified.Note)
			findings = append(findings, classified)
		}
	}
	return findings
}

func joinNote(first, second string) string {
	if second == "" {
		return first
	}
	return first + "; " + second
}
