package fix

import (
	"fmt"
	"regexp"
	"strings"

	"github.com/iambenzo/grot-weaver/pkg/catalogue"
	"github.com/iambenzo/grot-weaver/pkg/finding"
)

const StartingPointLabel = "starting point; test before deploying"

const processorName = "semconv"

var safeName = regexp.MustCompile(`^[A-Za-z0-9._/-]+$`)

type MetricLookup interface {
	Metric(name string) (catalogue.Metric, bool)
}

type PipelineRule struct {
	Available bool   `json:"available"`
	Reason    string `json:"reason,omitempty"`
	Label     string `json:"label,omitempty"`
	Collector string `json:"collector,omitempty"`
	Alloy     string `json:"alloy,omitempty"`
}

type target struct {
	group        string
	alloyContext string
	statements   []string
	signal       string
}

func Rule(f finding.Finding, metrics MetricLookup) PipelineRule {
	if f.Type != finding.TypeDeprecated {
		return unavailable("Pipeline rules are generated only for deprecated names with a single replacement. Fix this finding where the telemetry is produced.")
	}
	if f.Expected == "" {
		return unavailable(joinSentences("The registry gives no single replacement, so the right name depends on context and a rule would have to guess.", f.Note))
	}
	old := f.Matched
	if old == "" {
		old = f.Observed
	}
	if !safeName.MatchString(old) || !safeName.MatchString(f.Expected) {
		return unavailable("The names contain characters that a generated rule cannot quote safely.")
	}
	if f.Signal == finding.SignalMetrics && f.Scope == "" {
		return metricRename(old, f.Expected, metrics)
	}
	t, ok := attributeTarget(f.Signal, f.Scope)
	if !ok {
		return unavailable(fmt.Sprintf("No transform context is known for %s attributes at %q scope.", f.Signal, f.Scope))
	}
	t.statements = renameStatements(t.attributesPath(), old, f.Expected)
	return t.render()
}

func metricRename(old, expected string, metrics MetricLookup) PipelineRule {
	previous, knownPrevious := metrics.Metric(old)
	next, knownNext := metrics.Metric(expected)
	if !knownPrevious || !knownNext || previous.Unit == "" || next.Unit == "" {
		return unavailable(fmt.Sprintf("The unit of %s or %s is unknown, so a rename could mislabel the values. Rename it where the metric is produced.", old, expected))
	}
	if previous.Unit != next.Unit {
		return unavailable(fmt.Sprintf("%s is in %s but %s is in %s. Renaming would mislabel the values; change the instrumentation instead.", old, previous.Unit, expected, next.Unit))
	}
	t := target{group: "metric_statements", alloyContext: "metric", signal: "metrics"}
	t.statements = []string{fmt.Sprintf(`set(metric.name, %q) where metric.name == %q`, expected, old)}
	return t.render()
}

func attributeTarget(signal finding.Signal, scope catalogue.RenameScope) (target, bool) {
	group, signalName, ok := statementGroup(signal)
	if !ok {
		return target{}, false
	}
	switch scope {
	case catalogue.ScopeResources:
		return target{group: group, alloyContext: "resource", signal: signalName}, true
	case catalogue.ScopeSpans:
		return target{group: group, alloyContext: "span", signal: signalName}, signal == finding.SignalTraces
	case catalogue.ScopeLogs:
		return target{group: group, alloyContext: "log", signal: signalName}, signal == finding.SignalLogs
	case catalogue.ScopeMetrics:
		return target{group: group, alloyContext: "datapoint", signal: signalName}, signal == finding.SignalMetrics
	}
	return target{}, false
}

func statementGroup(signal finding.Signal) (group, signalName string, ok bool) {
	switch signal {
	case finding.SignalTraces:
		return "trace_statements", "traces", true
	case finding.SignalMetrics:
		return "metric_statements", "metrics", true
	case finding.SignalLogs:
		return "log_statements", "logs", true
	}
	return "", "", false
}

func (t target) attributesPath() string {
	return t.alloyContext + ".attributes"
}

func renameStatements(path, old, expected string) []string {
	from := fmt.Sprintf("%s[%q]", path, old)
	return []string{
		fmt.Sprintf("set(%s[%q], %s) where %s != nil", path, expected, from, from),
		fmt.Sprintf("delete_key(%s, %q)", path, old),
	}
}

func (t target) render() PipelineRule {
	return PipelineRule{Available: true, Label: StartingPointLabel, Collector: t.collectorYAML(), Alloy: t.alloyConfig()}
}

func (t target) collectorYAML() string {
	var b strings.Builder
	fmt.Fprintf(&b, "processors:\n  transform/%s:\n    error_mode: ignore\n    %s:\n", processorName, t.group)
	for _, statement := range t.statements {
		fmt.Fprintf(&b, "      - '%s'\n", strings.ReplaceAll(statement, "'", "''"))
	}
	return b.String()
}

func (t target) alloyConfig() string {
	var b strings.Builder
	fmt.Fprintf(&b, "otelcol.processor.transform %q {\n  error_mode = \"ignore\"\n\n  %s {\n    context    = %q\n    statements = [\n", processorName, t.group, t.alloyContext)
	for _, statement := range t.statements {
		fmt.Fprintf(&b, "      `%s`,\n", statement)
	}
	fmt.Fprintf(&b, "    ]\n  }\n\n  output {\n    %s = [otelcol.exporter.otlp.default.input]\n  }\n}\n", t.signal)
	return b.String()
}

func unavailable(reason string) PipelineRule {
	return PipelineRule{Reason: reason}
}

func joinSentences(first, second string) string {
	if second == "" {
		return first
	}
	return first + " Registry note: " + second
}
