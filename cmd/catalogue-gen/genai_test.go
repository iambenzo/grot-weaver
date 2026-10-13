package main

import (
	"strings"
	"testing"
)

func Test_coreDependencyOf(t *testing.T) {
	tests := []struct {
		name        string
		manifest    string
		want        string
		wantFailure bool
	}{
		{name: "git registry path", manifest: "dependencies:\n  - schema_url: https://opentelemetry.io/schemas/1.44.0\n    registry_path: https://github.com/open-telemetry/semantic-conventions.git@v1.44.0[model]\n", want: "v1.44.0"},
		{name: "archive style path", manifest: "dependencies:\n  - registry_path: https://github.com/open-telemetry/semantic-conventions@v1.45.0[model]\n", want: "v1.45.0"},
		{name: "no core dependency", manifest: "dependencies:\n  - registry_path: https://example.com/other@v1.0.0\n", wantFailure: true},
		{name: "invalid yaml", manifest: "dependencies: [", wantFailure: true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := coreDependencyOf([]byte(tt.manifest))
			if tt.wantFailure {
				if err == nil {
					t.Fatalf("expected error, got %q", got)
				}
				return
			}
			if err != nil || got != tt.want {
				t.Errorf("got (%q, %v), want %q", got, err, tt.want)
			}
		})
	}
}

func Test_chooseGenAICommit(t *testing.T) {
	compatible := chooseGenAICommit("new", "v1.45.0", "v1.45.0", "old")
	if compatible.commit != "new" || !strings.Contains(compatible.reason, "depends on core v1.45.0") {
		t.Errorf("compatible = %+v", compatible)
	}

	behind := chooseGenAICommit("new", "v1.44.0", "v1.45.0", "old")
	if behind.commit != "old" || !strings.Contains(behind.reason, "kept genai commit old") {
		t.Errorf("behind = %+v", behind)
	}
}
