//go:build docker

package fix

import (
	"bytes"
	"fmt"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/iambenzo/otel-semconv-compliance/pkg/catalogue"
	"github.com/iambenzo/otel-semconv-compliance/pkg/finding"
)

const (
	collectorImage = "otel/opentelemetry-collector-contrib:0.162.0"
	alloyImage     = "grafana/alloy:v1.20.1"
	startTimeout   = 60 * time.Second
)

type pipelineCase struct {
	name    string
	finding finding.Finding
	path    string
	body    string
	want    string
	gone    string
}

func pipelineCases() []pipelineCase {
	resource := func(extra string) string {
		return `{"attributes":[{"key":"service.name","value":{"stringValue":"checkout"}}` + extra + `]}`
	}
	return []pipelineCase{
		{
			name:    "span attribute",
			finding: deprecated(finding.SignalTraces, catalogue.ScopeSpans, "http.method", "http.request.method"),
			path:    "/v1/traces",
			body:    `{"resourceSpans":[{"resource":` + resource("") + `,"scopeSpans":[{"spans":[{"traceId":"5b8efff798038103d269b633813fc60c","spanId":"eee19b7ec3c1b174","name":"GET","kind":2,"startTimeUnixNano":"1","endTimeUnixNano":"2","attributes":[{"key":"http.method","value":{"stringValue":"GET"}}]}]}]}]}`,
			want:    "http.request.method", gone: "http.method",
		},
		{
			name:    "trace resource attribute",
			finding: deprecated(finding.SignalTraces, catalogue.ScopeResources, "deployment.environment", "deployment.environment.name"),
			path:    "/v1/traces",
			body:    `{"resourceSpans":[{"resource":` + resource(`,{"key":"deployment.environment","value":{"stringValue":"prod"}}`) + `,"scopeSpans":[{"spans":[{"traceId":"5b8efff798038103d269b633813fc60c","spanId":"eee19b7ec3c1b174","name":"GET","kind":2,"startTimeUnixNano":"1","endTimeUnixNano":"2"}]}]}]}`,
			want:    "deployment.environment.name", gone: "deployment.environment",
		},
		{
			name:    "metric datapoint attribute",
			finding: deprecated(finding.SignalMetrics, catalogue.ScopeMetrics, "http.method", "http.request.method"),
			path:    "/v1/metrics",
			body:    `{"resourceMetrics":[{"resource":` + resource("") + `,"scopeMetrics":[{"metrics":[{"name":"http.server.request.duration","unit":"s","gauge":{"dataPoints":[{"asDouble":1,"timeUnixNano":"1","attributes":[{"key":"http.method","value":{"stringValue":"GET"}}]}]}}]}]}]}`,
			want:    "http.request.method", gone: "http.method",
		},
		{
			name:    "metric rename with the same unit",
			finding: deprecated(finding.SignalMetrics, "", "db.client.connections.usage", "db.client.connection.count"),
			path:    "/v1/metrics",
			body:    `{"resourceMetrics":[{"resource":` + resource("") + `,"scopeMetrics":[{"metrics":[{"name":"db.client.connections.usage","unit":"{connection}","gauge":{"dataPoints":[{"asDouble":3,"timeUnixNano":"1"}]}}]}]}]}`,
			want:    "db.client.connection.count", gone: "db.client.connections.usage",
		},
		{
			name:    "log attribute",
			finding: deprecated(finding.SignalLogs, catalogue.ScopeLogs, "http.method", "http.request.method"),
			path:    "/v1/logs",
			body:    `{"resourceLogs":[{"resource":` + resource("") + `,"scopeLogs":[{"logRecords":[{"timeUnixNano":"1","body":{"stringValue":"hello"},"attributes":[{"key":"http.method","value":{"stringValue":"GET"}}]}]}]}]}`,
			want:    "http.request.method", gone: "http.method",
		},
	}
}

func Test_PipelineRules_runInOtelcolContrib(t *testing.T) {
	for _, tc := range pipelineCases() {
		t.Run(tc.name, func(t *testing.T) {
			rule := Rule(tc.finding, metrics)
			if !rule.Available {
				t.Fatalf("no rule: %s", rule.Reason)
			}
			signal := signalOf(tc.path)
			config := "receivers:\n  otlp:\n    protocols:\n      http:\n        endpoint: 0.0.0.0:4318\n" +
				rule.Collector +
				"exporters:\n  debug:\n    verbosity: detailed\n" +
				"service:\n  pipelines:\n    " + signal + ":\n      receivers: [otlp]\n      processors: [transform/semconv]\n      exporters: [debug]\n"
			output := runPipeline(t, collectorImage, "/etc/otelcol-contrib/config.yaml", config, []string{"--config=/etc/otelcol-contrib/config.yaml"}, tc)
			assertRenamed(t, output, tc)
		})
	}
}

func Test_PipelineRules_runInAlloy(t *testing.T) {
	for _, tc := range pipelineCases() {
		t.Run(tc.name, func(t *testing.T) {
			rule := Rule(tc.finding, metrics)
			if !rule.Available {
				t.Fatalf("no rule: %s", rule.Reason)
			}
			signal := signalOf(tc.path)
			config := fmt.Sprintf("otelcol.receiver.otlp \"default\" {\n  http {\n    endpoint = \"0.0.0.0:4318\"\n  }\n  output {\n    %s = [otelcol.processor.transform.semconv.input]\n  }\n}\n\n", signal) +
				strings.ReplaceAll(rule.Alloy, "otelcol.exporter.otlp.default.input", "otelcol.exporter.debug.default.input") +
				"\notelcol.exporter.debug \"default\" {\n  verbosity = \"detailed\"\n}\n"
			output := runPipeline(t, alloyImage, "/etc/alloy/config.alloy", config, []string{"run", "--stability.level=experimental", "/etc/alloy/config.alloy"}, tc)
			assertRenamed(t, output, tc)
		})
	}
}

func signalOf(path string) string {
	return strings.TrimPrefix(path, "/v1/")
}

func runPipeline(t *testing.T, image, configPath, config string, args []string, tc pipelineCase) string {
	t.Helper()
	dir := t.TempDir()
	configFile := filepath.Join(dir, filepath.Base(configPath))
	if err := os.WriteFile(configFile, []byte(config), 0o644); err != nil {
		t.Fatal(err)
	}
	runArgs := append([]string{"run", "-d", "-p", "127.0.0.1::4318", "-v", configFile + ":" + configPath + ":ro", image}, args...)
	id := strings.TrimSpace(mustRun(t, "docker", runArgs...))
	t.Cleanup(func() { _ = exec.Command("docker", "rm", "-f", id).Run() })
	port := strings.TrimSpace(mustRun(t, "docker", "port", id, "4318/tcp"))
	url := "http://" + port + tc.path

	deadline := time.Now().Add(startTimeout)
	for {
		response, err := http.Post(url, "application/json", bytes.NewBufferString(tc.body))
		if err == nil {
			response.Body.Close()
			if response.StatusCode == http.StatusOK {
				break
			}
		}
		if time.Now().After(deadline) {
			t.Fatalf("pipeline never accepted data: %v\n%s\nconfig:\n%s", err, logs(id), config)
		}
		time.Sleep(time.Second)
	}
	for time.Now().Before(deadline) {
		if output := logs(id); strings.Contains(output, tc.want) {
			return output
		}
		time.Sleep(time.Second)
	}
	t.Fatalf("debug output never showed %s\n%s\nconfig:\n%s", tc.want, logs(id), config)
	return ""
}

func assertRenamed(t *testing.T, output string, tc pipelineCase) {
	t.Helper()
	for _, warning := range []string{"paths were modified", "level=error", "level=warn"} {
		if strings.Contains(output, warning) {
			t.Errorf("pipeline logged %q:\n%s", warning, output)
		}
	}
	if !containsName(output, tc.want) {
		t.Errorf("renamed name %s missing from output:\n%s", tc.want, output)
	}
	if containsName(output, tc.gone) {
		t.Errorf("old name %s still present in output:\n%s", tc.gone, output)
	}
}

func containsName(output, name string) bool {
	for _, marker := range []string{"-> " + name + ":", "Name: " + name + "\n", "Name: " + name + "\r", "Name: " + name + `\n`} {
		if strings.Contains(output, marker) {
			return true
		}
	}
	return false
}

func logs(id string) string {
	output, _ := exec.Command("docker", "logs", id).CombinedOutput()
	return string(output)
}

func mustRun(t *testing.T, name string, args ...string) string {
	t.Helper()
	var stderr bytes.Buffer
	command := exec.Command(name, args...)
	command.Stderr = &stderr
	output, err := command.Output()
	if err != nil {
		t.Fatalf("%s %v: %v\n%s", name, args, err, stderr.String())
	}
	return string(output)
}
