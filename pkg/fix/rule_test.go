package fix

import (
	"strings"
	"testing"

	"github.com/iambenzo/grot-weaver/pkg/catalogue"
	"github.com/iambenzo/grot-weaver/pkg/finding"
)

type fakeMetrics map[string]catalogue.Metric

func (f fakeMetrics) Metric(name string) (catalogue.Metric, bool) {
	metric, ok := f[name]
	return metric, ok
}

var metrics = fakeMetrics{
	"http.server.duration":         {Name: "http.server.duration", Unit: "ms"},
	"http.server.request.duration": {Name: "http.server.request.duration", Unit: "s"},
	"db.client.connections.usage":  {Name: "db.client.connections.usage", Unit: "{connection}"},
	"db.client.connection.count":   {Name: "db.client.connection.count", Unit: "{connection}"},
}

func deprecated(signal finding.Signal, scope catalogue.RenameScope, matched, expected string) finding.Finding {
	return finding.Finding{Type: finding.TypeDeprecated, Signal: signal, Scope: scope, Observed: matched, Matched: matched, Expected: expected}
}

func Test_Rule_attributeRenames(t *testing.T) {
	tests := []struct {
		name          string
		finding       finding.Finding
		wantGroup     string
		wantPath      string
		wantAlloyCtx  string
		wantAlloyWire string
	}{
		{name: "span attribute", finding: deprecated(finding.SignalTraces, catalogue.ScopeSpans, "http.method", "http.request.method"), wantGroup: "trace_statements", wantPath: "span.attributes", wantAlloyCtx: `context    = "span"`, wantAlloyWire: "traces = ["},
		{name: "trace resource attribute", finding: deprecated(finding.SignalTraces, catalogue.ScopeResources, "deployment.environment", "deployment.environment.name"), wantGroup: "trace_statements", wantPath: "resource.attributes", wantAlloyCtx: `context    = "resource"`, wantAlloyWire: "traces = ["},
		{name: "metric datapoint attribute", finding: deprecated(finding.SignalMetrics, catalogue.ScopeMetrics, "http.method", "http.request.method"), wantGroup: "metric_statements", wantPath: "datapoint.attributes", wantAlloyCtx: `context    = "datapoint"`, wantAlloyWire: "metrics = ["},
		{name: "log attribute", finding: deprecated(finding.SignalLogs, catalogue.ScopeLogs, "http.method", "http.request.method"), wantGroup: "log_statements", wantPath: "log.attributes", wantAlloyCtx: `context    = "log"`, wantAlloyWire: "logs = ["},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			rule := Rule(tt.finding, metrics)

			if !rule.Available || rule.Label != StartingPointLabel {
				t.Fatalf("rule = %+v", rule)
			}
			old, expected := tt.finding.Matched, tt.finding.Expected
			wantSet := `set(` + tt.wantPath + `["` + expected + `"], ` + tt.wantPath + `["` + old + `"]) where ` + tt.wantPath + `["` + old + `"] != nil`
			for _, want := range []string{"transform/semconv:", tt.wantGroup + ":", wantSet, `delete_key(` + tt.wantPath + `, "` + old + `")`} {
				if !strings.Contains(rule.Collector, want) {
					t.Errorf("collector snippet missing %q:\n%s", want, rule.Collector)
				}
			}
			for _, want := range []string{`otelcol.processor.transform "semconv"`, tt.wantGroup + " {", tt.wantAlloyCtx, wantSet, tt.wantAlloyWire} {
				if !strings.Contains(rule.Alloy, want) {
					t.Errorf("alloy snippet missing %q:\n%s", want, rule.Alloy)
				}
			}
		})
	}
}

func Test_Rule_usesTheRegistryNameNotTheStoredForm(t *testing.T) {
	f := deprecated(finding.SignalMetrics, catalogue.ScopeMetrics, "net.peer.name", "server.address")
	f.Observed = "net_peer_name"

	rule := Rule(f, metrics)

	if !strings.Contains(rule.Collector, `datapoint.attributes["net.peer.name"]`) || strings.Contains(rule.Collector, "net_peer_name") {
		t.Errorf("collector snippet = %s", rule.Collector)
	}
}

func Test_Rule_metricRenames(t *testing.T) {
	sameUnit := Rule(deprecated(finding.SignalMetrics, "", "db.client.connections.usage", "db.client.connection.count"), metrics)
	if !sameUnit.Available || !strings.Contains(sameUnit.Collector, `set(metric.name, "db.client.connection.count") where metric.name == "db.client.connections.usage"`) || !strings.Contains(sameUnit.Alloy, `context    = "metric"`) || !strings.Contains(sameUnit.Alloy, `set(metric.name, "db.client.connection.count")`) {
		t.Errorf("same unit rule = %+v", sameUnit)
	}

	unitChange := Rule(deprecated(finding.SignalMetrics, "", "http.server.duration", "http.server.request.duration"), metrics)
	if unitChange.Available || !strings.Contains(unitChange.Reason, "ms") || !strings.Contains(unitChange.Reason, "mislabel") {
		t.Errorf("unit change rule = %+v", unitChange)
	}

	unknown := Rule(deprecated(finding.SignalMetrics, "", "old.metric", "db.client.connection.count"), metrics)
	if unknown.Available || !strings.Contains(unknown.Reason, "unknown") {
		t.Errorf("unknown unit rule = %+v", unknown)
	}
}

func Test_Rule_explainsWhenNoRuleIsOffered(t *testing.T) {
	noReplacement := deprecated(finding.SignalTraces, catalogue.ScopeSpans, "net.peer.name", "")
	noReplacement.Note = "Replaced by `server.address` on client spans and `client.address` on server spans."
	tests := []struct {
		name    string
		finding finding.Finding
		want    string
	}{
		{name: "no single replacement", finding: noReplacement, want: "depends on context"},
		{name: "registry note kept", finding: noReplacement, want: "client.address"},
		{name: "not a deprecation", finding: finding.Finding{Type: finding.TypeRequiredAttributeMissing, Signal: finding.SignalTraces, Expected: "url.scheme"}, want: "only for deprecated names"},
		{name: "unsafe name", finding: deprecated(finding.SignalTraces, catalogue.ScopeSpans, `bad"name`, "x"), want: "quote safely"},
		{name: "span scope on logs", finding: deprecated(finding.SignalLogs, catalogue.ScopeSpans, "a", "b"), want: "No transform context"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			rule := Rule(tt.finding, metrics)
			if rule.Available || rule.Collector != "" || rule.Alloy != "" || !strings.Contains(rule.Reason, tt.want) {
				t.Errorf("rule = %+v, want reason containing %q", rule, tt.want)
			}
		})
	}
}
