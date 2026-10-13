package main

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
)

func Test_fetchLatestReleaseTag(t *testing.T) {
	tests := []struct {
		name        string
		status      int
		body        string
		token       string
		wantTag     string
		wantAuth    string
		wantFailure bool
	}{
		{name: "returns tag", status: http.StatusOK, body: `{"tag_name":"v1.44.0"}`, wantTag: "v1.44.0"},
		{name: "sends token when given", status: http.StatusOK, body: `{"tag_name":"v1.44.0"}`, token: "abc", wantTag: "v1.44.0", wantAuth: "Bearer abc"},
		{name: "fails on non-200", status: http.StatusForbidden, body: `{}`, wantFailure: true},
		{name: "fails on missing tag", status: http.StatusOK, body: `{}`, wantFailure: true},
		{name: "fails on invalid json", status: http.StatusOK, body: `{`, wantFailure: true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			var gotPath, gotAuth string
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				gotPath = r.URL.Path
				gotAuth = r.Header.Get("Authorization")
				w.WriteHeader(tt.status)
				_, _ = w.Write([]byte(tt.body))
			}))
			t.Cleanup(server.Close)

			tag, err := fetchLatestReleaseTag(context.Background(), server.Client(), server.URL, coreRepository, tt.token)

			if tt.wantFailure {
				if err == nil {
					t.Fatalf("expected error, got tag %q", tag)
				}
				return
			}
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if tag != tt.wantTag {
				t.Errorf("tag = %q, want %q", tag, tt.wantTag)
			}
			if gotPath != "/repos/"+coreRepository+"/releases/latest" {
				t.Errorf("path = %q", gotPath)
			}
			if gotAuth != tt.wantAuth {
				t.Errorf("authorization = %q, want %q", gotAuth, tt.wantAuth)
			}
		})
	}
}
