package plugin

import (
	"bytes"
	"compress/gzip"
	"context"
	"encoding/json"
	"net/http"
	"slices"
	"strings"
	"testing"

	"github.com/grafana/grafana-plugin-sdk-go/backend"

	"github.com/iambenzo/otel-semconv-compliance/pkg/assessment"
	"github.com/iambenzo/otel-semconv-compliance/pkg/catalogue"
	"github.com/iambenzo/otel-semconv-compliance/pkg/product"
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

func postScore(t *testing.T, app *App, body []byte) *backend.CallResourceResponse {
	t.Helper()
	return postScoreWith(t, app, body, nil)
}

func postScoreWith(t *testing.T, app *App, body []byte, headers map[string][]string) *backend.CallResourceResponse {
	t.Helper()
	var sender capturingSender
	request := &backend.CallResourceRequest{Method: http.MethodPost, Path: "score", Body: body, Headers: headers}
	if err := app.CallResource(context.Background(), request, &sender); err != nil {
		t.Fatalf("call resource: %v", err)
	}
	return sender.response
}

func Test_CallResource_score(t *testing.T) {
	app := newTestApp(t)
	valid := `{"inventory":{"window":{"start":1,"end":2},"traces":[{"uid":"tempo","services":[{"service_name":"checkout","span_count":3,"span_keys":[{"key":"http.method"}]}]}]}}`

	tests := []struct {
		name       string
		body       []byte
		wantStatus int
	}{
		{name: "valid inventory", body: []byte(valid), wantStatus: http.StatusOK},
		{name: "unknown field rejected", body: []byte(`{"inventory":{},"surprise":true}`), wantStatus: http.StatusBadRequest},
		{name: "invalid inventory rejected", body: []byte(`{"inventory":{"window":{"start":5,"end":1}}}`), wantStatus: http.StatusBadRequest},
		{name: "malformed json rejected", body: []byte(`{`), wantStatus: http.StatusBadRequest},
		{name: "oversized body rejected", body: []byte(`{"inventory":{"traces":[{"uid":"` + strings.Repeat("x", maxScoreRequestBytes) + `"}]}}`), wantStatus: http.StatusRequestEntityTooLarge},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := postScore(t, app, tt.body).Status; got != tt.wantStatus {
				t.Errorf("status = %d, want %d", got, tt.wantStatus)
			}
		})
	}

	var result assessment.Result
	if err := json.Unmarshal(postScore(t, app, []byte(valid)).Body, &result); err != nil {
		t.Fatal(err)
	}
	if len(result.Findings) == 0 || result.Findings[0].Observed != "http.method" || len(result.Owners) != 1 {
		t.Errorf("result = %+v", result)
	}
}

func Test_CallResource_spanGroups(t *testing.T) {
	response := callResource(t, newTestApp(t), http.MethodGet, "catalogue/span-groups")

	var rules []catalogue.SpanGroupRule
	if err := json.Unmarshal(response.Body, &rules); err != nil || response.Status != http.StatusOK || len(rules) == 0 {
		t.Fatalf("status %d err %v rules %d", response.Status, err, len(rules))
	}
}

func Test_CallResource_renamedAttributes(t *testing.T) {
	response := callResource(t, newTestApp(t), http.MethodGet, "catalogue/renamed-attributes")

	var renamed map[string][]string
	if err := json.Unmarshal(response.Body, &renamed); err != nil || response.Status != http.StatusOK {
		t.Fatalf("status %d err %v", response.Status, err)
	}
	if !slices.Contains(renamed["deployment.environment.name"], "deployment.environment") {
		t.Errorf("deployment.environment.name renamed from %v", renamed["deployment.environment.name"])
	}
}

func Test_CallResource_metricMatches(t *testing.T) {
	app := newTestApp(t)
	body := []byte(`{"names":["http_server_request_duration_seconds_bucket","http_server_duration_milliseconds_count","node_cpu_seconds_total"]}`)

	var sender capturingSender
	if err := app.CallResource(context.Background(), &backend.CallResourceRequest{Method: http.MethodPost, Path: "catalogue/metric-matches", Body: body}, &sender); err != nil {
		t.Fatal(err)
	}

	var response metricMatchesResponse
	if err := json.Unmarshal(sender.response.Body, &response); err != nil {
		t.Fatal(err)
	}
	want := []string{"http_server_request_duration_seconds_bucket", "http_server_duration_milliseconds_count"}
	if !slices.Equal(response.NeedsLabels, want) {
		t.Errorf("needs_labels = %v, want %v", response.NeedsLabels, want)
	}
}

func Test_CallResource_products(t *testing.T) {
	response := callResource(t, newTestApp(t), http.MethodGet, "products")

	var products []product.Product
	if err := json.Unmarshal(response.Body, &products); err != nil || response.Status != http.StatusOK {
		t.Fatalf("status %d err %v", response.Status, err)
	}
	if !slices.ContainsFunc(products, func(p product.Product) bool { return p.ID == "knowledge-graph" }) {
		t.Errorf("products = %+v, want knowledge-graph", products)
	}
}

func gzipped(t *testing.T, data []byte) []byte {
	t.Helper()
	var buffer bytes.Buffer
	writer := gzip.NewWriter(&buffer)
	if _, err := writer.Write(data); err != nil {
		t.Fatal(err)
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	return buffer.Bytes()
}

func Test_CallResource_score_compression(t *testing.T) {
	app := newTestApp(t)
	valid := []byte(`{"inventory":{"window":{"start":1,"end":2},"traces":[{"uid":"tempo","services":[{"service_name":"checkout","span_count":3,"span_keys":[{"key":"http.method"}]}]}]}}`)
	gzipRequest := map[string][]string{"Content-Encoding": {"gzip"}}

	t.Run("gzip request body is decoded", func(t *testing.T) {
		response := postScoreWith(t, app, gzipped(t, valid), gzipRequest)
		if response.Status != http.StatusOK {
			t.Fatalf("status = %d, body %s", response.Status, response.Body)
		}
		var result assessment.Result
		if err := json.Unmarshal(response.Body, &result); err != nil || len(result.Owners) != 1 {
			t.Errorf("result = %+v, err %v", result, err)
		}
	})

	t.Run("response is gzipped when the client accepts it", func(t *testing.T) {
		response := postScoreWith(t, app, valid, map[string][]string{"Accept-Encoding": {"gzip, deflate, br"}})
		if got := response.Headers["Content-Encoding"]; !slices.Equal(got, []string{"gzip"}) {
			t.Fatalf("content encoding = %v", got)
		}
		reader, err := gzip.NewReader(bytes.NewReader(response.Body))
		if err != nil {
			t.Fatal(err)
		}
		var result assessment.Result
		if err := json.NewDecoder(reader).Decode(&result); err != nil || len(result.Owners) != 1 {
			t.Errorf("result = %+v, err %v", result, err)
		}
	})

	t.Run("decompressed body over the limit is rejected", func(t *testing.T) {
		bomb := gzipped(t, []byte(`{"inventory":{"traces":[{"uid":"`+strings.Repeat("x", maxDecodedScoreRequestBytes)+`"}]}}`))
		if got := postScoreWith(t, app, bomb, gzipRequest).Status; got != http.StatusRequestEntityTooLarge {
			t.Errorf("status = %d, want %d", got, http.StatusRequestEntityTooLarge)
		}
	})

	t.Run("gzip with a corrupt checksum is rejected", func(t *testing.T) {
		zipped := gzipped(t, valid)
		zipped[len(zipped)-5] ^= 0xff
		if got := postScoreWith(t, app, zipped, gzipRequest).Status; got != http.StatusBadRequest {
			t.Errorf("status = %d, want %d", got, http.StatusBadRequest)
		}
	})

	t.Run("data after the JSON value is rejected", func(t *testing.T) {
		for name, body := range map[string][]byte{
			"plain": append(slices.Clone(valid), []byte(` {"inventory":{}}`)...),
			"gzip":  gzipped(t, append(slices.Clone(valid), []byte(`garbage`)...)),
		} {
			headers := map[string][]string(nil)
			if name == "gzip" {
				headers = gzipRequest
			}
			if got := postScoreWith(t, app, body, headers).Status; got != http.StatusBadRequest {
				t.Errorf("%s: status = %d, want %d", name, got, http.StatusBadRequest)
			}
		}
	})

	t.Run("content encoding is matched without regard to case", func(t *testing.T) {
		response := postScoreWith(t, app, gzipped(t, valid), map[string][]string{"Content-Encoding": {"GZip"}})
		if response.Status != http.StatusOK {
			t.Errorf("status = %d, body %s", response.Status, response.Body)
		}
	})

	t.Run("gzip refused with q=0 gets a plain response that varies by encoding", func(t *testing.T) {
		response := postScoreWith(t, app, valid, map[string][]string{"Accept-Encoding": {"br, gzip;q=0"}})
		if got := response.Headers["Content-Encoding"]; len(got) != 0 {
			t.Errorf("content encoding = %v, want none", got)
		}
		if got := response.Headers["Vary"]; !slices.Equal(got, []string{"Accept-Encoding"}) {
			t.Errorf("vary = %v", got)
		}
	})

	t.Run("accept encoding is parsed with every parameter and the wildcard", func(t *testing.T) {
		for header, want := range map[string]bool{
			"gzip":                true,
			"GZIP;q=0.5":          true,
			"gzip;foo=bar;q=0":    false,
			"br, gzip;q=0":        false,
			"*":                   true,
			"*;q=0":               false,
			"gzip;q=0, *":         false,
			"br, deflate":         false,
			"gzip;q=not-a-number": false,
			"":                    false,
		} {
			if got := acceptsGzip(header); got != want {
				t.Errorf("acceptsGzip(%q) = %v, want %v", header, got, want)
			}
		}
	})

	t.Run("whitespace after the JSON value is accepted", func(t *testing.T) {
		if got := postScoreWith(t, app, append(slices.Clone(valid), []byte("\n  \t")...), nil).Status; got != http.StatusOK {
			t.Errorf("status = %d, want %d", got, http.StatusOK)
		}
	})

	t.Run("body that is not gzip is rejected", func(t *testing.T) {
		if got := postScoreWith(t, app, valid, gzipRequest).Status; got != http.StatusBadRequest {
			t.Errorf("status = %d, want %d", got, http.StatusBadRequest)
		}
	})
}
