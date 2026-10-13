package main

import (
	"slices"
	"testing"
)

func Test_parseConfig(t *testing.T) {
	tests := []struct {
		name        string
		args        []string
		wantVersion string
		wantFailure bool
	}{
		{name: "defaults to latest", args: nil, wantVersion: latestVersion},
		{name: "accepts release tag", args: []string{"-semconv", "v1.44.0"}, wantVersion: "v1.44.0"},
		{name: "rejects tag without v", args: []string{"-semconv", "1.44.0"}, wantFailure: true},
		{name: "rejects url injection", args: []string{"-semconv", "v1.44.0.zip[model]#"}, wantFailure: true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			cfg, err := parseConfig(tt.args)
			if tt.wantFailure {
				if err == nil {
					t.Fatalf("expected error, got %+v", cfg)
				}
				return
			}
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if cfg.semconvVersion != tt.wantVersion {
				t.Errorf("version = %q, want %q", cfg.semconvVersion, tt.wantVersion)
			}
		})
	}
}

func Test_weaverArgs_usesPinnedImageAndReadOnlyTemplates(t *testing.T) {
	args := weaverArgs("registry-url", "/abs/templates", "/tmp/out")

	if !slices.Contains(args, weaverImage) {
		t.Errorf("args do not use pinned image: %v", args)
	}
	if !slices.Contains(args, "/abs/templates:/templates:ro") {
		t.Errorf("templates not mounted read-only: %v", args)
	}
	if i := slices.Index(args, "-r"); i < 0 || args[i+1] != "registry-url" {
		t.Errorf("registry not passed: %v", args)
	}
}
