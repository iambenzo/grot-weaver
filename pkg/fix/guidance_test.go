package fix

import (
	"strings"
	"testing"

	"github.com/iambenzo/otel-semconv-compliance/pkg/catalogue"
	"github.com/iambenzo/otel-semconv-compliance/pkg/finding"
)

var versions = Versions{Semconv: "v1.44.0", GenAICommit: "5293eff"}

func Test_Instrumentation_docsURL(t *testing.T) {
	genAI := deprecated(finding.SignalTraces, catalogue.ScopeSpans, "gen_ai.system", "gen_ai.provider.name")
	genAI.Source = catalogue.SourceGenAI
	genAIOther := deprecated(finding.SignalTraces, catalogue.ScopeSpans, "x", "aws.bedrock.guardrail.id")
	genAIOther.Source = catalogue.SourceGenAI
	tests := []struct {
		name    string
		finding finding.Finding
		want    string
	}{
		{name: "core attribute", finding: deprecated(finding.SignalTraces, catalogue.ScopeSpans, "http.method", "http.request.method"), want: "https://opentelemetry.io/docs/specs/semconv/registry/attributes/http/"},
		{name: "underscore namespace", finding: deprecated(finding.SignalTraces, catalogue.ScopeSpans, "x", "user_agent.original"), want: "https://opentelemetry.io/docs/specs/semconv/registry/attributes/user-agent/"},
		{name: "page slug differs", finding: deprecated(finding.SignalMetrics, catalogue.ScopeMetrics, "x", "hw.id"), want: "https://opentelemetry.io/docs/specs/semconv/registry/attributes/hardware/"},
		{name: "core metric", finding: deprecated(finding.SignalMetrics, "", "db.client.connections.usage", "db.client.connection.count"), want: "https://github.com/open-telemetry/semantic-conventions/tree/v1.44.0/model/db"},
		{name: "genai attribute", finding: genAI, want: "https://github.com/open-telemetry/semantic-conventions-genai/tree/5293eff/model/gen-ai"},
		{name: "genai attribute outside known dirs", finding: genAIOther, want: "https://github.com/open-telemetry/semantic-conventions-genai/tree/5293eff/model"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := Instrumentation(tt.finding, nil, versions).DocsURL; got != tt.want {
				t.Errorf("docs url = %q, want %q", got, tt.want)
			}
		})
	}
}

func Test_Instrumentation_optIn(t *testing.T) {
	httpMethod := deprecated(finding.SignalTraces, catalogue.ScopeSpans, "http.method", "http.request.method")
	dbStatement := deprecated(finding.SignalTraces, catalogue.ScopeSpans, "db.statement", "db.query.text")
	tests := []struct {
		name      string
		finding   finding.Finding
		library   *Library
		wantValue string
	}{
		{name: "js http inside the cited range", finding: httpMethod, library: &Library{Name: "@opentelemetry/instrumentation-http", Version: "0.218.0"}, wantValue: "http/dup"},
		{name: "js http at the lower bound", finding: httpMethod, library: &Library{Name: "@opentelemetry/instrumentation-http", Version: "0.54.0"}, wantValue: "http/dup"},
		{name: "js http after the range", finding: httpMethod, library: &Library{Name: "@opentelemetry/instrumentation-http", Version: "0.221.0"}},
		{name: "js http before the range", finding: httpMethod, library: &Library{Name: "@opentelemetry/instrumentation-http", Version: "0.53.0"}},
		{name: "python flask http", finding: httpMethod, library: &Library{Name: "opentelemetry.instrumentation.flask", Version: "0.50b0"}, wantValue: "http/dup"},
		{name: "python db library", finding: dbStatement, library: &Library{Name: "opentelemetry.instrumentation.psycopg2"}, wantValue: "database/dup"},
		{name: "python http library on a db finding", finding: dbStatement, library: &Library{Name: "opentelemetry.instrumentation.flask"}},
		{name: "uncited sdk", finding: httpMethod, library: &Library{Name: "go.opentelemetry.io/contrib/instrumentation/net/http/otelhttp", Version: "0.49.0"}},
		{name: "no library", finding: httpMethod},
		{name: "no single replacement", finding: deprecated(finding.SignalTraces, catalogue.ScopeSpans, "net.peer.name", ""), library: &Library{Name: "@opentelemetry/instrumentation-http", Version: "0.218.0"}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			guidance := Instrumentation(tt.finding, tt.library, versions)
			if tt.wantValue == "" {
				if guidance.OptIn != nil {
					t.Errorf("opt-in = %+v, want none", guidance.OptIn)
				}
				return
			}
			if guidance.OptIn == nil || guidance.OptIn.Variable != "OTEL_SEMCONV_STABILITY_OPT_IN" || guidance.OptIn.Value != tt.wantValue || len(guidance.OptIn.Sources) == 0 {
				t.Fatalf("opt-in = %+v, want %s", guidance.OptIn, tt.wantValue)
			}
			if !strings.HasPrefix(guidance.OptIn.Sources[0], "https://github.com/open-telemetry/") {
				t.Errorf("first source = %q", guidance.OptIn.Sources[0])
			}
		})
	}
}

func Test_Instrumentation_namesTheLibrary(t *testing.T) {
	library := &Library{Name: "semconv.emitter.http", Version: "0.1.0"}

	guidance := Instrumentation(deprecated(finding.SignalTraces, catalogue.ScopeSpans, "http.method", "http.request.method"), library, versions)

	if guidance.Library != library || guidance.Expected != "http.request.method" {
		t.Errorf("guidance = %+v", guidance)
	}
}
