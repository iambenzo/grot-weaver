package catalogue

import (
	"slices"
	"strconv"
	"strings"
)

type RenameScope string

const (
	ScopeAll       RenameScope = "all"
	ScopeSpans     RenameScope = "spans"
	ScopeMetrics   RenameScope = "metrics"
	ScopeResources RenameScope = "resources"
	ScopeLogs      RenameScope = "logs"
)

type AttributeRename struct {
	From    string      `json:"from"`
	To      string      `json:"to"`
	Version string      `json:"version"`
	Scope   RenameScope `json:"scope"`
	Metrics []string    `json:"metrics,omitempty"`
}

type MetricRename struct {
	From    string `json:"from"`
	To      string `json:"to"`
	Version string `json:"version"`
}

type RenameHistory struct {
	SchemaURL  string            `json:"schema_url"`
	Attributes []AttributeRename `json:"attributes"`
	Metrics    []MetricRename    `json:"metrics"`
}

func (h RenameHistory) ResolveMetric(name string) (string, bool) {
	current := name
	for _, rename := range h.Metrics {
		if rename.From == current {
			current = rename.To
		}
	}
	return current, current != name
}

func (h RenameHistory) ResolveAttribute(name string, scope RenameScope, metric string) (string, bool) {
	current := name
	for _, rename := range h.Attributes {
		if rename.From == current && rename.appliesTo(scope, metric) {
			current = rename.To
		}
	}
	return current, current != name
}

func (r AttributeRename) appliesTo(scope RenameScope, metric string) bool {
	if r.Scope == ScopeAll {
		return true
	}
	if r.Scope != scope {
		return false
	}
	return len(r.Metrics) == 0 || slices.Contains(r.Metrics, metric)
}

func (h RenameHistory) inVersionOrder() RenameHistory {
	attributes := slices.Clone(h.Attributes)
	slices.SortStableFunc(attributes, func(a, b AttributeRename) int { return CompareVersions(a.Version, b.Version) })
	metrics := slices.Clone(h.Metrics)
	slices.SortStableFunc(metrics, func(a, b MetricRename) int { return CompareVersions(a.Version, b.Version) })
	return RenameHistory{SchemaURL: h.SchemaURL, Attributes: attributes, Metrics: metrics}
}

func CompareVersions(a, b string) int {
	return slices.Compare(versionParts(a), versionParts(b))
}

func versionParts(version string) []int {
	fields := strings.Split(strings.TrimPrefix(version, "v"), ".")
	parts := make([]int, len(fields))
	for i, field := range fields {
		parts[i], _ = strconv.Atoi(field)
	}
	return parts
}
