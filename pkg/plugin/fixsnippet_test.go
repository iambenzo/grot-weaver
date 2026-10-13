package plugin

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"testing"

	"github.com/grafana/grafana-plugin-sdk-go/backend"
)

func postFixSnippet(t *testing.T, app *App, body string) (int, fixSnippetResponse) {
	t.Helper()
	var sender capturingSender
	request := &backend.CallResourceRequest{Method: http.MethodPost, Path: "fix-snippet", Body: []byte(body)}
	if err := app.CallResource(context.Background(), request, &sender); err != nil {
		t.Fatalf("call resource: %v", err)
	}
	var response fixSnippetResponse
	if sender.response.Status == http.StatusOK {
		if err := json.Unmarshal(sender.response.Body, &response); err != nil {
			t.Fatalf("decode: %v", err)
		}
	}
	return sender.response.Status, response
}

func Test_FixSnippet(t *testing.T) {
	app := newTestApp(t)
	tests := []struct {
		name          string
		body          string
		wantStatus    int
		wantAvailable bool
		wantText      string
	}{
		{
			name:          "renamed span attribute from a score result",
			body:          `{"finding":{"type":"deprecated","level":"violation","signal":"traces","owner":{"kind":"service","name":"checkout"},"observed":"http.method","scope":"spans","matched":"http.method","expected":"http.request.method","volume":3,"impact_share":0.2}}`,
			wantStatus:    http.StatusOK,
			wantAvailable: true,
			wantText:      `set(span.attributes["http.request.method"], span.attributes["http.method"])`,
		},
		{
			name:       "metric renamed with a unit change gets no rule",
			body:       `{"finding":{"type":"deprecated","level":"violation","signal":"metrics","owner":{"kind":"service","name":"checkout"},"observed":"http_server_duration_milliseconds","matched":"http.server.duration","expected":"http.server.request.duration","volume":1,"impact_share":0}}`,
			wantStatus: http.StatusOK,
			wantText:   "Rename it where the metric is produced",
		},
		{name: "unknown fields are rejected", body: `{"finding":{},"extra":1}`, wantStatus: http.StatusBadRequest},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			status, response := postFixSnippet(t, app, tt.body)
			if status != tt.wantStatus {
				t.Fatalf("status = %d, want %d", status, tt.wantStatus)
			}
			if status != http.StatusOK {
				return
			}
			rule := response.PipelineRule
			text := rule.Collector + rule.Reason
			if rule.Available != tt.wantAvailable || !strings.Contains(text, tt.wantText) {
				t.Errorf("rule = %+v", rule)
			}
		})
	}
}
