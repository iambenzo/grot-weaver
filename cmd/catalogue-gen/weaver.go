package main

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
)

const (
	weaverImage        = "otel/weaver:v0.27.0@sha256:3049b4079049d4abb1b5632f511ada2c33505a1c60f3f8535e93f87f0696f056"
	weaverTarget       = "compact"
	weaverOutputFile   = "compact.json"
	containerTemplates = "/templates"
	containerOutput    = "/out"
)

func generateWithWeaver(ctx context.Context, registry, templatesDir string) ([]byte, error) {
	absoluteTemplates, err := filepath.Abs(templatesDir)
	if err != nil {
		return nil, fmt.Errorf("resolve templates directory: %w", err)
	}

	outputDir, err := os.MkdirTemp("", "catalogue-gen-")
	if err != nil {
		return nil, fmt.Errorf("create weaver output directory: %w", err)
	}
	defer func() { _ = os.RemoveAll(outputDir) }()

	cmd := exec.CommandContext(ctx, "docker", weaverArgs(registry, absoluteTemplates, outputDir)...)
	if output, err := cmd.CombinedOutput(); err != nil {
		return nil, fmt.Errorf("run weaver for %s: %w\n%s", registry, err, output)
	}

	return os.ReadFile(filepath.Join(outputDir, weaverOutputFile))
}

func weaverArgs(registry, templatesDir, outputDir string) []string {
	return []string{
		"run", "--rm",
		"-v", templatesDir + ":" + containerTemplates + ":ro",
		"-v", outputDir + ":" + containerOutput,
		weaverImage,
		"registry", "generate",
		"-r", registry,
		"-t", containerTemplates,
		weaverTarget, containerOutput,
	}
}
