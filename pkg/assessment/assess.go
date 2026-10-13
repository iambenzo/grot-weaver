package assessment

import (
	"cmp"
	"slices"

	"github.com/iambenzo/otel-semconv-compliance/pkg/catalogue"
	"github.com/iambenzo/otel-semconv-compliance/pkg/finding"
	"github.com/iambenzo/otel-semconv-compliance/pkg/identity"
	"github.com/iambenzo/otel-semconv-compliance/pkg/nameindex"
	"github.com/iambenzo/otel-semconv-compliance/pkg/scoring"
)

type Assessor struct {
	catalogue  *catalogue.Catalogue
	attributes *nameindex.AttributeIndex
	metrics    *nameindex.MetricIndex
	classifier finding.Classifier
}

type ScoreRow struct {
	scoring.Key
	Scores scoring.Scores `json:"scores"`
}

type ServiceAttribution struct {
	Datasource string `json:"datasource"`
	identity.Attribution
	SDK SDK `json:"sdk"`
}

type Result struct {
	SemconvVersion string                  `json:"semconv_version"`
	Window         Window                  `json:"window"`
	Findings       []scoring.RankedFinding `json:"findings"`
	Attributions   []ServiceAttribution    `json:"attributions"`
	Metrics        []MetricAttribution     `json:"metric_attributions"`
	Logs           []LogAttribution        `json:"log_attributions"`
	Datasources    []DatasourceSummary     `json:"datasources"`
	Hops           []ServiceHops           `json:"hops"`
	Coverage       []SignalCoverage        `json:"coverage"`
	Owners         []ScoreRow              `json:"owners"`
	Namespaces     []ScoreRow              `json:"namespaces"`
	Signals        []ScoreRow              `json:"signals"`
}

func NewAssessor(c *catalogue.Catalogue, customNamespaces []string) *Assessor {
	return &Assessor{
		catalogue:  c,
		attributes: nameindex.NewAttributeIndex(c, customNamespaces),
		metrics:    nameindex.NewMetricIndex(c),
		classifier: finding.NewClassifier(c),
	}
}

type collected struct {
	findings           []finding.Finding
	requirements       []scoring.RequirementCheck
	checks             []scoring.ResourceCheck
	attributions       []ServiceAttribution
	metricAttributions []MetricAttribution
	logAttributions    []LogAttribution
	datasources        []DatasourceSummary
	hopContexts        map[finding.Owner]hopContext
	collectors         []Collector
	totals             map[finding.Signal]float64
	coverage           map[finding.Signal]scoring.Ratio
}

type SignalCoverage struct {
	Signal   finding.Signal `json:"signal"`
	Coverage scoring.Ratio  `json:"coverage"`
}

func (c *collected) cover(signal finding.Signal, volume float64, attributed bool) {
	ratio := c.coverage[signal]
	ratio.Denominator += volume
	if attributed {
		ratio.Numerator += volume
	}
	c.coverage[signal] = ratio
}

func (c *collected) coverageRows() []SignalCoverage {
	rows := []SignalCoverage{}
	for _, signal := range []finding.Signal{finding.SignalMetrics, finding.SignalTraces, finding.SignalLogs} {
		if ratio, seen := c.coverage[signal]; seen {
			rows = append(rows, SignalCoverage{Signal: signal, Coverage: ratio})
		}
	}
	return rows
}

func (c *collected) noteOwner(context hopContext) {
	if context.owner.Kind != finding.OwnerService && context.owner.Kind != finding.OwnerSource {
		return
	}
	existing, seen := c.hopContexts[context.owner]
	if !seen || existing.target == nil && context.target != nil {
		c.hopContexts[context.owner] = context
	}
}

func (c *collected) hops(mappings []PipelineMapping) []ServiceHops {
	owners := make([]finding.Owner, 0, len(c.hopContexts))
	for owner := range c.hopContexts {
		owners = append(owners, owner)
	}
	slices.SortFunc(owners, func(a, b finding.Owner) int {
		return cmp.Or(cmp.Compare(a.Kind, b.Kind), cmp.Compare(a.Namespace, b.Namespace), cmp.Compare(a.Name, b.Name))
	})
	hops := []ServiceHops{}
	for _, owner := range owners {
		if candidates := hopCandidates(c.hopContexts[owner], c.collectors, mappings); len(candidates) > 0 {
			hops = append(hops, ServiceHops{Owner: owner, Candidates: candidates})
		}
	}
	return hops
}

func (a *Assessor) Assess(inv Inventory, options scoring.Options) Result {
	if len(inv.CustomNamespaces) > 0 {
		return a.withCustomNamespaces(inv.CustomNamespaces).assess(inv, options)
	}
	return a.assess(inv, options)
}

func (a *Assessor) withCustomNamespaces(namespaces []string) *Assessor {
	scoped := *a
	scoped.attributes = nameindex.NewAttributeIndex(a.catalogue, namespaces)
	return &scoped
}

func (a *Assessor) assess(inv Inventory, options scoring.Options) Result {
	gathered := collected{totals: map[finding.Signal]float64{}, hopContexts: map[finding.Owner]hopContext{}, coverage: map[finding.Signal]scoring.Ratio{}}
	for _, datasource := range inv.Traces {
		for _, service := range datasource.Services {
			a.assessTraceService(datasource.UID, service, &gathered)
		}
	}
	for _, datasource := range inv.Metrics {
		a.assessMetricDatasource(datasource, inv.ReclassificationRules(), &gathered)
	}
	for _, datasource := range inv.Logs {
		for _, service := range datasource.Services {
			a.assessLogService(datasource.UID, service, &gathered)
		}
	}

	scores := scoring.Score(gathered.findings, gathered.requirements, gathered.checks, options)
	return Result{
		SemconvVersion: a.catalogue.Manifest.Semconv.Version,
		Window:         inv.Window,
		Findings:       scoring.RankByImpact(gathered.findings, gathered.totals),
		Attributions:   nonNil(gathered.attributions),
		Metrics:        nonNil(gathered.metricAttributions),
		Logs:           nonNil(gathered.logAttributions),
		Datasources:    nonNil(gathered.datasources),
		Hops:           gathered.hops(inv.PipelineMappings),
		Coverage:       gathered.coverageRows(),
		Owners:         rows(scores),
		Namespaces:     rows(scoring.RollUp(servicesOnly(scores), scoring.ByNamespace)),
		Signals:        rows(scoring.RollUp(servicesOnly(scores), scoring.BySignal)),
	}
}

func (a *Assessor) assessTraceService(datasource string, service TraceService, into *collected) {
	resolution := identity.ResolveTraceService(service.ServiceName, service.ServiceNamespace, service.SpanCount)
	owner := resolution.Attribution.Owner
	into.noteOwner(hopContext{owner: owner, origin: identity.OriginSDK})
	into.attributions = append(into.attributions, ServiceAttribution{Datasource: datasource, Attribution: resolution.Attribution, SDK: service.SDK})
	into.findings = append(into.findings, resolution.Findings...)
	into.checks = append(into.checks, resolution.Checks...)
	into.totals[finding.SignalTraces] += service.SpanCount
	into.cover(finding.SignalTraces, service.SpanCount, owner.Kind == finding.OwnerService)

	at := finding.Observation{Owner: owner, Signal: finding.SignalTraces}
	for _, key := range service.ResourceKeys {
		into.addKeyFindings(a, at, key, service.SpanCount, catalogue.ScopeResources)
	}
	for _, key := range service.SpanKeys {
		into.addKeyFindings(a, at, key, service.SpanCount, catalogue.ScopeSpans)
	}
	groupFindings, requirements := a.spanGroupFindings(owner, service.SpanGroups, service.SpanCount)
	into.findings = append(into.findings, groupFindings...)
	into.requirements = append(into.requirements, requirements...)
}

func (c *collected) addKeyFindings(a *Assessor, at finding.Observation, key KeyObservation, fallbackVolume float64, scope catalogue.RenameScope) {
	classified := a.classifyKey(at, key, fallbackVolume, scope)
	c.findings = append(c.findings, classified)
	if misplaced, found := a.classifier.Misplacement(classified); found {
		c.findings = append(c.findings, misplaced)
	}
}

func (a *Assessor) classifyKey(at finding.Observation, key KeyObservation, fallbackVolume float64, scope catalogue.RenameScope) finding.Finding {
	at.Volume = key.Volume
	if at.Volume == 0 {
		at.Volume = fallbackVolume
	}
	match := a.attributes.Match(key.Key, nameindex.Context{Scope: scope})
	return a.classifier.Attribute(at, match, scope)
}

func nonNil[T any](items []T) []T {
	if items == nil {
		return []T{}
	}
	return items
}

func servicesOnly(scores map[scoring.Key]scoring.Scores) map[scoring.Key]scoring.Scores {
	services := map[scoring.Key]scoring.Scores{}
	for key, value := range scores {
		if key.Owner.Kind == finding.OwnerService {
			services[key] = value
		}
	}
	return services
}

func rows(scores map[scoring.Key]scoring.Scores) []ScoreRow {
	result := make([]ScoreRow, 0, len(scores))
	for key, value := range scores {
		result = append(result, ScoreRow{Key: key, Scores: value})
	}
	slices.SortFunc(result, func(a, b ScoreRow) int {
		return cmp.Or(
			cmp.Compare(a.Signal, b.Signal),
			cmp.Compare(a.Owner.Kind, b.Owner.Kind),
			cmp.Compare(a.Owner.Namespace, b.Owner.Namespace),
			cmp.Compare(a.Owner.Name, b.Owner.Name),
		)
	})
	return result
}
