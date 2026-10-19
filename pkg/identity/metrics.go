package identity

import (
	"strings"

	"github.com/iambenzo/grot-weaver/pkg/finding"
	"github.com/iambenzo/grot-weaver/pkg/nameindex"
	"github.com/iambenzo/grot-weaver/pkg/scoring"
)

const (
	SourceServiceNameLabel Source = "service_name label"
	SourceJobLabel         Source = "job label (SDK origin)"
	SourceInstanceTarget   Source = "instance matched target_info"
	SourceScrapeJob        Source = "job label (scrape or integration)"
	SourceIdentityHint     Source = "identity-like label"

	jobLabel              = "job"
	instanceLabel         = "instance"
	serviceNameLabel      = "service_name"
	serviceNamespaceLabel = "service_namespace"
)

var hintTargetLabels = []string{
	"telemetry_sdk_name", "telemetry_sdk_language", "service_instance_id",
	"k8s_deployment_name", "k8s_statefulset_name", "k8s_daemonset_name", "k8s_pod_name", "k8s_namespace_name", "host_name",
}

var workloadLabels = []string{"k8s_deployment_name", "k8s_statefulset_name", "k8s_daemonset_name"}

const k8sNamespaceLabel = "k8s_namespace_name"

var identityLikeLabels = []string{"service", "otel_service", "app", "client", "server"}

type TargetIndex struct {
	byJob      map[string]map[string]string
	byInstance map[string]map[string]string
}

func NewTargetIndex(series []map[string]string) TargetIndex {
	index := TargetIndex{byJob: map[string]map[string]string{}, byInstance: map[string]map[string]string{}}
	for _, labels := range series {
		if job := labels[jobLabel]; job != "" {
			index.byJob[job] = mergeLabels(index.byJob[job], labels)
		}
		if instance := labels[instanceLabel]; instance != "" {
			index.byInstance[instance] = mergeLabels(index.byInstance[instance], labels)
		}
	}
	return index
}

func (t TargetIndex) ForJob(job string) (map[string]string, bool) {
	labels, found := t.byJob[job]
	return labels, found
}

func (t TargetIndex) Jobs() map[string]map[string]string {
	return t.byJob
}

func mergeLabels(into, labels map[string]string) map[string]string {
	if into == nil {
		into = map[string]string{}
	}
	for key, value := range labels {
		if _, present := into[key]; !present {
			into[key] = value
		}
	}
	return into
}

type SDK struct {
	Name     string `json:"name,omitempty"`
	Language string `json:"language,omitempty"`
	Version  string `json:"version,omitempty"`
}

type MetricResolution struct {
	Attribution Attribution
	Origin      OriginClassification
	Target      map[string]string
	SDK         SDK
	Hints       map[string]string
	Findings    []finding.Finding
	Checks      []scoring.ResourceCheck
}

func sdkFrom(target map[string]string) SDK {
	return SDK{Name: target["telemetry_sdk_name"], Language: target["telemetry_sdk_language"], Version: target["telemetry_sdk_version"]}
}

func ResolveMetricOwner(labels map[string]string, targets TargetIndex, volume float64) MetricResolution {
	scope := labels[ScopeNameLabel]
	if resolution, resolved := resolveByServiceName(labels, targets, scope, volume); resolved {
		return resolution
	}

	if job := labels[jobLabel]; job != "" {
		target, found := targets.ForJob(job)
		origin := ClassifyOrigin(target, found, scope)
		if IsSDKDefaultServiceName(job) {
			resolution := serviceResolution(finding.Owner{Kind: finding.OwnerService, Name: job}, SourceJobLabel, origin, volume)
			resolution.SDK, resolution.Target = sdkFrom(target), target
			return resolution
		}
		if origin.Origin == OriginSDK {
			namespace, name := splitJob(job)
			resolution := serviceResolution(finding.Owner{Kind: finding.OwnerService, Namespace: namespace, Name: name}, SourceJobLabel, origin, volume)
			resolution.SDK, resolution.Target = sdkFrom(target), target
			return resolution
		}
		owner := finding.Owner{Kind: finding.OwnerSource, Name: job}
		return MetricResolution{
			Attribution: Attribution{Owner: owner, Source: SourceScrapeJob, Confidence: nameindex.ConfidenceMedium},
			Origin:      origin,
			Target:      target,
		}
	}

	if target, found := targets.byInstance[labels[instanceLabel]]; found && labels[instanceLabel] != "" {
		owner := hintedUnattributedOwner(target, labels[instanceLabel])
		resolution := unattributedResolution(owner, SourceInstanceTarget, ClassifyOrigin(target, true, scope), pick(target, hintTargetLabels), volume)
		resolution.SDK, resolution.Target = sdkFrom(target), target
		return resolution
	}
	owner := finding.Owner{Kind: finding.OwnerUnattributed, Name: unattributedName}
	return unattributedResolution(owner, SourceIdentityHint, ClassifyOrigin(nil, false, scope), pick(labels, identityLikeLabels), volume)
}

func hintedUnattributedOwner(target map[string]string, instance string) finding.Owner {
	owner := finding.Owner{Kind: finding.OwnerUnattributed, Namespace: target[k8sNamespaceLabel], Name: instance}
	for _, label := range workloadLabels {
		if workload := target[label]; workload != "" {
			owner.Name = workload
			return owner
		}
	}
	return owner
}

func resolveByServiceName(labels map[string]string, targets TargetIndex, scope string, volume float64) (MetricResolution, bool) {
	name := labels[serviceNameLabel]
	if name == "" {
		return MetricResolution{}, false
	}
	target, found := targets.ForJob(labels[jobLabel])
	origin := ClassifyOrigin(target, found, scope)
	if origin.Origin == OriginCollectorScraped && copiesStructuralLabel(labels, serviceNameLabel, name) {
		return MetricResolution{}, false
	}
	if origin.Origin == OriginNonOTel {
		origin = OriginClassification{Origin: OriginSDK, Confidence: nameindex.ConfidenceHigh, Reason: "series carry a service_name label"}
	}
	resolution := serviceResolution(finding.Owner{Kind: finding.OwnerService, Namespace: labels[serviceNamespaceLabel], Name: name}, SourceServiceNameLabel, origin, volume)
	resolution.SDK, resolution.Target = sdkFrom(target), target
	return resolution, true
}

func serviceResolution(owner finding.Owner, source Source, origin OriginClassification, volume float64) MetricResolution {
	resolution := MetricResolution{
		Attribution: Attribution{Owner: owner, Source: source, Confidence: nameindex.ConfidenceHigh},
		Origin:      origin,
		Checks:      []scoring.ResourceCheck{metricCheck(owner, CheckServiceNamePresent, true)},
	}
	isDefault := IsSDKDefaultServiceName(owner.Name)
	resolution.Checks = append(resolution.Checks, metricCheck(owner, CheckServiceNameNotDefault, !isDefault))
	if isDefault {
		resolution.Findings = []finding.Finding{metricIdentityFinding(owner, finding.TypeSDKDefaultServiceName, owner.Name, nameindex.ConfidenceHigh, volume)}
	}
	return resolution
}

func unattributedResolution(owner finding.Owner, source Source, origin OriginClassification, hints map[string]string, volume float64) MetricResolution {
	confidence := nameindex.ConfidenceMedium
	if source == SourceIdentityHint {
		confidence = nameindex.ConfidenceLow
	}
	return MetricResolution{
		Attribution: Attribution{Owner: owner, Source: source, Confidence: confidence},
		Origin:      origin,
		Hints:       hints,
		Findings:    []finding.Finding{metricIdentityFinding(owner, finding.TypeMissingServiceName, "", confidence, volume)},
		Checks:      []scoring.ResourceCheck{metricCheck(owner, CheckServiceNamePresent, false)},
	}
}

func splitJob(job string) (namespace, name string) {
	namespace, name, found := strings.Cut(job, "/")
	if !found {
		return "", job
	}
	return namespace, name
}

func pick(labels map[string]string, keys []string) map[string]string {
	picked := map[string]string{}
	for _, key := range keys {
		if value := labels[key]; value != "" {
			picked[key] = value
		}
	}
	if len(picked) == 0 {
		return nil
	}
	return picked
}

func metricIdentityFinding(owner finding.Owner, t finding.Type, observed string, confidence nameindex.Confidence, volume float64) finding.Finding {
	return finding.Finding{
		Type:       t,
		Level:      finding.LevelOf(t),
		Signal:     finding.SignalMetrics,
		Owner:      owner,
		Observed:   observed,
		Expected:   "service.name",
		Confidence: confidence,
		Volume:     volume,
	}
}

func metricCheck(owner finding.Owner, name string, passed bool) scoring.ResourceCheck {
	return scoring.ResourceCheck{Owner: owner, Signal: finding.SignalMetrics, Name: name, Passed: passed}
}
