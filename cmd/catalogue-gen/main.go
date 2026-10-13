package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"time"
)

const (
	latestVersion        = "latest"
	githubAPIBaseURL     = "https://api.github.com"
	coreRepository       = "open-telemetry/semantic-conventions"
	coreCatalogueFile    = "core.json"
	manifestFile         = "manifest.json"
	defaultOutputDir     = "pkg/catalogue/data"
	defaultTemplatesDir  = "catalogue/templates"
	httpTimeout          = 30 * time.Second
	coreRegistryTemplate = "https://github.com/" + coreRepository + "/archive/refs/tags/%s.zip[model]"
)

var releaseTagPattern = regexp.MustCompile(`^v\d+\.\d+\.\d+$`)

type config struct {
	semconvVersion string
	outputDir      string
	templatesDir   string
}

type manifest struct {
	Semconv        registrySource `json:"semconv"`
	WeaverImage    string         `json:"weaver_image"`
	TemplateSHA256 string         `json:"template_sha256"`
}

type registrySource struct {
	Version  string `json:"version"`
	Registry string `json:"registry"`
}

func main() {
	if err := run(context.Background(), os.Args[1:], os.Stdout); err != nil {
		fmt.Fprintln(os.Stderr, "catalogue-gen:", err)
		os.Exit(1)
	}
}

func run(ctx context.Context, args []string, stdout io.Writer) error {
	cfg, err := parseConfig(args)
	if err != nil {
		return err
	}

	version, err := resolveSemconvVersion(ctx, cfg.semconvVersion)
	if err != nil {
		return err
	}

	registry := fmt.Sprintf(coreRegistryTemplate, version)
	raw, err := generateWithWeaver(ctx, registry, cfg.templatesDir)
	if err != nil {
		return err
	}

	catalogue, err := normaliseJSON(raw)
	if err != nil {
		return fmt.Errorf("normalise core catalogue: %w", err)
	}

	templateHash, err := hashDirectory(cfg.templatesDir)
	if err != nil {
		return fmt.Errorf("hash templates: %w", err)
	}

	built := manifest{
		Semconv:        registrySource{Version: version, Registry: registry},
		WeaverImage:    weaverImage,
		TemplateSHA256: templateHash,
	}
	if err := writeOutputs(cfg.outputDir, catalogue, built); err != nil {
		return err
	}

	_, err = fmt.Fprintf(stdout, "wrote %s catalogue for semconv %s\n", cfg.outputDir, version)
	return err
}

func parseConfig(args []string) (config, error) {
	flags := flag.NewFlagSet("catalogue-gen", flag.ContinueOnError)
	cfg := config{}
	flags.StringVar(&cfg.semconvVersion, "semconv", latestVersion, "semantic-conventions release tag, or \"latest\"")
	flags.StringVar(&cfg.outputDir, "out", defaultOutputDir, "directory that receives the catalogue files")
	flags.StringVar(&cfg.templatesDir, "templates", defaultTemplatesDir, "Weaver templates directory")
	if err := flags.Parse(args); err != nil {
		return config{}, err
	}
	if cfg.semconvVersion != latestVersion && !releaseTagPattern.MatchString(cfg.semconvVersion) {
		return config{}, fmt.Errorf("semconv version %q is not a release tag like v1.44.0", cfg.semconvVersion)
	}
	return cfg, nil
}

func resolveSemconvVersion(ctx context.Context, requested string) (string, error) {
	if requested != latestVersion {
		return requested, nil
	}
	client := &http.Client{Timeout: httpTimeout}
	tag, err := fetchLatestReleaseTag(ctx, client, githubAPIBaseURL, coreRepository, os.Getenv("GITHUB_TOKEN"))
	if err != nil {
		return "", fmt.Errorf("find latest semconv release: %w", err)
	}
	if !releaseTagPattern.MatchString(tag) {
		return "", fmt.Errorf("latest semconv release tag %q is not a release tag", tag)
	}
	return tag, nil
}

func writeOutputs(outputDir string, catalogue []byte, built manifest) error {
	if err := os.MkdirAll(outputDir, 0o755); err != nil {
		return fmt.Errorf("create output directory: %w", err)
	}
	manifestJSON, err := marshalIndented(built)
	if err != nil {
		return fmt.Errorf("encode manifest: %w", err)
	}
	return errors.Join(
		os.WriteFile(filepath.Join(outputDir, coreCatalogueFile), catalogue, 0o644),
		os.WriteFile(filepath.Join(outputDir, manifestFile), manifestJSON, 0o644),
	)
}
