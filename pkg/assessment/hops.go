package assessment

import (
	"cmp"
	"fmt"
	"path"
	"slices"
	"strings"

	"github.com/iambenzo/otel-semconv-compliance/pkg/finding"
	"github.com/iambenzo/otel-semconv-compliance/pkg/identity"
)

const (
	maxHopCandidates   = 5
	scoreMapping       = 100
	scoreHostMatch     = 60
	scoreScrapeReceive = 50
	scoreNameAffinity  = 40
	minAffinityLength  = 4
)

type PipelineMapping struct {
	Match    string `json:"match"`
	Pipeline string `json:"pipeline"`
}

type Collector struct {
	ID         string   `json:"id"`
	Job        string   `json:"job,omitempty"`
	Pod        string   `json:"pod,omitempty"`
	Instance   string   `json:"instance,omitempty"`
	Components []string `json:"components,omitempty"`
}

type HopCandidate struct {
	Pipeline string   `json:"pipeline"`
	Reasons  []string `json:"reasons"`
	Score    int      `json:"score"`
}

type ServiceHops struct {
	Owner      finding.Owner  `json:"owner"`
	Candidates []HopCandidate `json:"candidates"`
}

type hopContext struct {
	owner  finding.Owner
	origin identity.Origin
	target map[string]string
}

func collectorsFrom(rows []map[string]string) []Collector {
	byID := map[string]*Collector{}
	var order []string
	for _, labels := range rows {
		id := cmp.Or(labels["collector_id"], labels["pod"], labels["instance"])
		if id == "" {
			continue
		}
		collector, seen := byID[id]
		if !seen {
			collector = &Collector{ID: id, Job: labels["job"], Pod: labels["pod"], Instance: labels["instance"]}
			byID[id] = collector
			order = append(order, id)
		}
		for _, key := range []string{"receiver", "component_path", "component_id", "workload"} {
			if value := labels[key]; value != "" && !slices.Contains(collector.Components, value) {
				collector.Components = append(collector.Components, value)
			}
		}
	}
	collectors := make([]Collector, 0, len(order))
	for _, id := range order {
		collectors = append(collectors, *byID[id])
	}
	return collectors
}

func hopCandidates(context hopContext, collectors []Collector, mappings []PipelineMapping) []HopCandidate {
	candidates := map[string]*HopCandidate{}
	add := func(pipeline, reason string, score int) {
		candidate, seen := candidates[pipeline]
		if !seen {
			candidate = &HopCandidate{Pipeline: pipeline}
			candidates[pipeline] = candidate
		}
		candidate.Reasons = append(candidate.Reasons, reason)
		candidate.Score += score
	}

	qualified := qualifiedName(context.owner)
	for _, mapping := range mappings {
		if matchesService(mapping.Match, context.owner) {
			add(mapping.Pipeline, fmt.Sprintf("admin mapping %q matches %s", mapping.Match, qualified), scoreMapping)
		}
	}
	if context.origin == identity.OriginCollectorScraped {
		add(collectorScrapePipeline, "target_info carries only scrape-target labels or the prometheus receiver scope", scoreScrapeReceive)
	}
	host := context.target["host_name"]
	affinity := normalise(context.owner.Name)
	for _, collector := range collectors {
		if host != "" && (host == collector.Pod || host == collector.ID || strings.HasPrefix(collector.Instance, host)) {
			add(collector.ID, fmt.Sprintf("the service's host.name %q is this collector, so its resource detection ran there", host), scoreHostMatch)
		}
		if len(affinity) < minAffinityLength {
			continue
		}
		for _, component := range collector.Components {
			if strings.Contains(normalise(component), affinity) {
				add(collector.ID, fmt.Sprintf("component %q mentions %s", component, context.owner.Name), scoreNameAffinity)
				break
			}
		}
	}

	ranked := make([]HopCandidate, 0, len(candidates))
	for _, candidate := range candidates {
		ranked = append(ranked, *candidate)
	}
	slices.SortFunc(ranked, func(a, b HopCandidate) int {
		return cmp.Or(cmp.Compare(b.Score, a.Score), cmp.Compare(a.Pipeline, b.Pipeline))
	})
	if len(ranked) > maxHopCandidates {
		ranked = ranked[:maxHopCandidates]
	}
	return ranked
}

func matchesService(pattern string, owner finding.Owner) bool {
	for _, name := range []string{qualifiedName(owner), owner.Name} {
		if matched, _ := path.Match(pattern, name); matched {
			return true
		}
	}
	return false
}

func qualifiedName(owner finding.Owner) string {
	if owner.Namespace == "" {
		return owner.Name
	}
	return owner.Namespace + "/" + owner.Name
}

func normalise(value string) string {
	var builder strings.Builder
	for _, r := range strings.ToLower(value) {
		if r >= 'a' && r <= 'z' || r >= '0' && r <= '9' {
			builder.WriteRune(r)
		}
	}
	return builder.String()
}
