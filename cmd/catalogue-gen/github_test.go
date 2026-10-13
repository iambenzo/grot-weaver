package main

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
)

type stubResponse struct {
	status int
	body   string
}

func newStubGitHub(t *testing.T, response stubResponse, token string) (githubClient, *http.Request) {
	t.Helper()
	captured := &http.Request{}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		*captured = *r.Clone(context.Background())
		w.WriteHeader(response.status)
		_, _ = w.Write([]byte(response.body))
	}))
	t.Cleanup(server.Close)
	return githubClient{httpClient: server.Client(), baseURL: server.URL, token: token}, captured
}

func Test_githubClient_latestReleaseTag(t *testing.T) {
	tests := []struct {
		name        string
		response    stubResponse
		token       string
		wantTag     string
		wantAuth    string
		wantFailure bool
	}{
		{name: "returns tag", response: stubResponse{http.StatusOK, `{"tag_name":"v1.44.0"}`}, wantTag: "v1.44.0"},
		{name: "sends token when given", response: stubResponse{http.StatusOK, `{"tag_name":"v1.44.0"}`}, token: "abc", wantTag: "v1.44.0", wantAuth: "Bearer abc"},
		{name: "fails on non-200", response: stubResponse{http.StatusForbidden, `{}`}, wantFailure: true},
		{name: "fails on missing tag", response: stubResponse{http.StatusOK, `{}`}, wantFailure: true},
		{name: "fails on invalid json", response: stubResponse{http.StatusOK, `{`}, wantFailure: true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			client, captured := newStubGitHub(t, tt.response, tt.token)

			tag, err := client.latestReleaseTag(context.Background(), coreRepository)

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
			if captured.URL.Path != "/repos/"+coreRepository+"/releases/latest" {
				t.Errorf("path = %q", captured.URL.Path)
			}
			if got := captured.Header.Get("Authorization"); got != tt.wantAuth {
				t.Errorf("authorization = %q, want %q", got, tt.wantAuth)
			}
		})
	}
}

func Test_githubClient_commitDate(t *testing.T) {
	tests := []struct {
		name        string
		response    stubResponse
		wantDate    string
		wantFailure bool
	}{
		{name: "returns committer date", response: stubResponse{http.StatusOK, `{"commit":{"committer":{"date":"2026-10-12T19:05:02Z"}}}`}, wantDate: "2026-10-12T19:05:02Z"},
		{name: "fails on missing date", response: stubResponse{http.StatusOK, `{"commit":{}}`}, wantFailure: true},
		{name: "fails on not found", response: stubResponse{http.StatusNotFound, `{}`}, wantFailure: true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			client, captured := newStubGitHub(t, tt.response, "")

			date, err := client.commitDate(context.Background(), genAIRepository, pinnedGenAICommit)

			if tt.wantFailure {
				if err == nil {
					t.Fatalf("expected error, got date %q", date)
				}
				return
			}
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if date != tt.wantDate {
				t.Errorf("date = %q, want %q", date, tt.wantDate)
			}
			if captured.URL.Path != "/repos/"+genAIRepository+"/commits/"+pinnedGenAICommit {
				t.Errorf("path = %q", captured.URL.Path)
			}
		})
	}
}
