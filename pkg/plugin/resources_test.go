package plugin

import (
	"context"
	"encoding/json"
	"net/http"
	"slices"
	"strings"
	"testing"

	"github.com/grafana/grafana-plugin-sdk-go/backend"

	"github.com/iambenzo/otel-semconv-compliance/pkg/catalogue"
)

type capturingSender struct {
	response *backend.CallResourceResponse
}

func (s *capturingSender) Send(response *backend.CallResourceResponse) error {
	s.response = response
	return nil
}

func newTestApp(t *testing.T) *App {
	t.Helper()
	instance, err := NewApp(context.Background(), backend.AppInstanceSettings{})
	if err != nil {
		t.Fatalf("new app: %v", err)
	}
	app, ok := instance.(*App)
	if !ok {
		t.Fatalf("instance is %T, want *App", instance)
	}
	return app
}

func callResource(t *testing.T, app *App, method, path string) *backend.CallResourceResponse {
	t.Helper()
	var sender capturingSender
	if err := app.CallResource(context.Background(), &backend.CallResourceRequest{Method: method, Path: path}, &sender); err != nil {
		t.Fatalf("call resource: %v", err)
	}
	if sender.response == nil {
		t.Fatal("no response")
	}
	return sender.response
}

func Test_CallResource_routes(t *testing.T) {
	app := newTestApp(t)
	tests := []struct {
		name       string
		method     string
		path       string
		wantStatus int
	}{
		{name: "catalogue summary", method: http.MethodGet, path: "catalogue", wantStatus: http.StatusOK},
		{name: "catalogue rejects post", method: http.MethodPost, path: "catalogue", wantStatus: http.StatusMethodNotAllowed},
		{name: "unknown route", method: http.MethodGet, path: "not_found", wantStatus: http.StatusNotFound},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := callResource(t, app, tt.method, tt.path).Status; got != tt.wantStatus {
				t.Errorf("status = %d, want %d", got, tt.wantStatus)
			}
		})
	}
}

func Test_CallResource_catalogueReturnsStampCountsAndStability(t *testing.T) {
	response := callResource(t, newTestApp(t), http.MethodGet, "catalogue")

	var summary catalogue.Summary
	if err := json.Unmarshal(response.Body, &summary); err != nil {
		t.Fatalf("decode: %v\n%s", err, response.Body)
	}
	manifest := summary.Manifest
	if manifest.Semconv.Version == "" || manifest.GenAI.Commit == "" || manifest.WeaverImage == "" || manifest.TemplateSHA256 == "" {
		t.Errorf("manifest stamp incomplete: %+v", manifest)
	}
	if summary.Counts.Attributes == 0 || summary.Counts.Metrics == 0 || summary.Counts.Spans == 0 {
		t.Errorf("counts empty: %+v", summary.Counts)
	}
	attributes := summary.Stability.Attributes
	total := attributes.Stable + attributes.ReleaseCandidate + attributes.Development + attributes.Alpha + attributes.Deprecated
	if total != summary.Counts.Attributes {
		t.Errorf("attribute stability breakdown sums to %d, want %d", total, summary.Counts.Attributes)
	}
}

func Test_CheckHealth_reportsCatalogueVersion(t *testing.T) {
	app := newTestApp(t)

	result, err := app.CheckHealth(context.Background(), &backend.CheckHealthRequest{})

	if err != nil || result.Status != backend.HealthStatusOk {
		t.Fatalf("health = %+v, err %v", result, err)
	}
	if !strings.Contains(result.Message, app.catalogue.Manifest.Semconv.Version) {
		t.Errorf("message %q does not name the semconv version", result.Message)
	}
}

func Test_CallResource_nameFormsListsEveryStoredSpelling(t *testing.T) {
	response := callResource(t, newTestApp(t), http.MethodGet, "catalogue/name-forms")
	if response.Status != http.StatusOK {
		t.Fatalf("status = %d", response.Status)
	}

	var body nameFormsResponse
	if err := json.Unmarshal(response.Body, &body); err != nil {
		t.Fatal(err)
	}
	if got := body.Stored["http_server_request_duration_seconds_bucket"]; !slices.Equal(got, []string{"http.server.request.duration"}) {
		t.Errorf("bucket entry = %v", got)
	}
	if got := body.Stored["http_server_duration"]; !slices.Equal(got, []string{"http.server.duration"}) {
		t.Errorf("history-only entry = %v", got)
	}
	t.Logf("%d stored names, %d bytes", len(body.Stored), len(response.Body))
}
