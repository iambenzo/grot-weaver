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

	"github.com/iambenzo/grot-weaver/pkg/catalogue"
)

const (
	latestVersion        = "latest"
	githubAPIBaseURL     = "https://api.github.com"
	coreRepository       = "open-telemetry/semantic-conventions"
	genAIRepository      = "open-telemetry/semantic-conventions-genai"
	pinnedGenAICommit    = "5293effb97f18ddb0602da884dadee6119d67679"
	defaultOutputDir     = "pkg/catalogue/data"
	defaultTemplatesDir  = "catalogue/templates"
	httpTimeout          = 30 * time.Second
	coreRegistryTemplate = "https://github.com/" + coreRepository + "/archive/refs/tags/%s.zip[model]"
	genAIRegistryFormat  = "https://github.com/" + genAIRepository + "/archive/%s.zip[model]"
)

var (
	releaseTagPattern = regexp.MustCompile(`^v\d+\.\d+\.\d+$`)
	commitPattern     = regexp.MustCompile(`^[0-9a-f]{40}$`)
)

type config struct {
	semconvVersion string
	genAICommit    string
	outputDir      string
	templatesDir   string
	summaryPath    string
}

type generatedFile struct {
	name    string
	content []byte
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

	httpClient := &http.Client{Timeout: httpTimeout}
	github := githubClient{
		httpClient: httpClient,
		baseURL:    githubAPIBaseURL,
		token:      os.Getenv("GITHUB_TOKEN"),
	}

	version, err := resolveSemconvVersion(ctx, github, cfg.semconvVersion)
	if err != nil {
		return err
	}
	previous := loadPrevious(cfg.outputDir)
	genAI, err := resolveGenAICommit(ctx, github, httpClient, cfg.genAICommit, version, previousGenAICommit(previous))
	if err != nil {
		return err
	}
	committedAt, err := github.commitDate(ctx, genAIRepository, genAI.commit)
	if err != nil {
		return fmt.Errorf("look up genai commit: %w", err)
	}

	coreRegistry := fmt.Sprintf(coreRegistryTemplate, version)
	genAIRegistry := fmt.Sprintf(genAIRegistryFormat, genAI.commit)

	core, err := generateCatalogue(ctx, coreRegistry, cfg.templatesDir)
	if err != nil {
		return fmt.Errorf("core catalogue: %w", err)
	}
	genAICatalogue, err := generateCatalogue(ctx, genAIRegistry, cfg.templatesDir)
	if err != nil {
		return fmt.Errorf("genai catalogue: %w", err)
	}

	schemaURL := schemaURLFor(version)
	renames, err := buildRenameHistory(ctx, httpClient, schemaURL)
	if err != nil {
		return fmt.Errorf("rename history: %w", err)
	}

	templateHash, err := hashDirectory(cfg.templatesDir)
	if err != nil {
		return fmt.Errorf("hash templates: %w", err)
	}

	manifestJSON, err := marshalIndented(catalogue.Manifest{
		Semconv:        catalogue.SemconvSource{Version: version, Registry: coreRegistry, SchemaURL: schemaURL},
		GenAI:          catalogue.GenAISource{Commit: genAI.commit, CommittedAt: committedAt, Registry: genAIRegistry},
		WeaverImage:    weaverImage,
		TemplateSHA256: templateHash,
	})
	if err != nil {
		return fmt.Errorf("encode manifest: %w", err)
	}

	files := []generatedFile{
		{name: catalogue.CoreFile, content: core},
		{name: catalogue.GenAIFile, content: genAICatalogue},
		{name: catalogue.RenamesFile, content: renames},
		{name: catalogue.ManifestFile, content: manifestJSON},
	}
	if cfg.summaryPath != "" {
		if err := writeSummary(cfg.summaryPath, previous, files, genAI.reason); err != nil {
			return err
		}
	}
	if err := writeFiles(cfg.outputDir, files...); err != nil {
		return err
	}

	_, err = fmt.Fprintf(stdout, "wrote %s: semconv %s, genai %s (%s)\n", cfg.outputDir, version, genAI.commit, genAI.reason)
	return err
}

func loadPrevious(outputDir string) *catalogue.Catalogue {
	previous, err := catalogue.Load(readFrom(outputDir))
	if err != nil {
		return nil
	}
	return previous
}

func previousGenAICommit(previous *catalogue.Catalogue) string {
	if previous == nil {
		return ""
	}
	return previous.Manifest.GenAI.Commit
}

func writeSummary(path string, previous *catalogue.Catalogue, files []generatedFile, genAIReason string) error {
	staging, err := os.MkdirTemp("", "catalogue-next-")
	if err != nil {
		return err
	}
	defer func() { _ = os.RemoveAll(staging) }()
	if err := writeFiles(staging, files...); err != nil {
		return err
	}
	next, err := catalogue.Load(readFrom(staging))
	if err != nil {
		return fmt.Errorf("load generated catalogue: %w", err)
	}
	return os.WriteFile(path, []byte(summariseChanges(previous, next, genAIReason)), 0o644)
}

func parseConfig(args []string) (config, error) {
	flags := flag.NewFlagSet("catalogue-gen", flag.ContinueOnError)
	cfg := config{}
	flags.StringVar(&cfg.semconvVersion, "semconv", latestVersion, "semantic-conventions release tag, or \"latest\"")
	flags.StringVar(&cfg.genAICommit, "genai-commit", pinnedGenAICommit, "semantic-conventions-genai commit SHA, or \"auto\" for the latest commit compatible with the core version")
	flags.StringVar(&cfg.summaryPath, "summary", "", "write a markdown summary of catalogue changes to this file")
	flags.StringVar(&cfg.outputDir, "out", defaultOutputDir, "directory that receives the catalogue files")
	flags.StringVar(&cfg.templatesDir, "templates", defaultTemplatesDir, "Weaver templates directory")
	if err := flags.Parse(args); err != nil {
		return config{}, err
	}
	if cfg.semconvVersion != latestVersion && !releaseTagPattern.MatchString(cfg.semconvVersion) {
		return config{}, fmt.Errorf("semconv version %q is not a release tag like v1.44.0", cfg.semconvVersion)
	}
	if cfg.genAICommit != autoCommit && !commitPattern.MatchString(cfg.genAICommit) {
		return config{}, fmt.Errorf("genai commit %q is not a full 40-character SHA or \"auto\"", cfg.genAICommit)
	}
	return cfg, nil
}

func resolveSemconvVersion(ctx context.Context, github githubClient, requested string) (string, error) {
	if requested != latestVersion {
		return requested, nil
	}
	tag, err := github.latestReleaseTag(ctx, coreRepository)
	if err != nil {
		return "", fmt.Errorf("find latest semconv release: %w", err)
	}
	if !releaseTagPattern.MatchString(tag) {
		return "", fmt.Errorf("latest semconv release tag %q is not a release tag", tag)
	}
	return tag, nil
}

func generateCatalogue(ctx context.Context, registry, templatesDir string) ([]byte, error) {
	raw, err := generateWithWeaver(ctx, registry, templatesDir)
	if err != nil {
		return nil, err
	}
	return normaliseJSON(raw)
}

func buildRenameHistory(ctx context.Context, client *http.Client, schemaURL string) ([]byte, error) {
	content, err := fetchSchema(ctx, client, schemaURL)
	if err != nil {
		return nil, err
	}
	history, err := parseRenameHistory(content)
	if err != nil {
		return nil, err
	}
	return marshalIndented(history)
}

func writeFiles(outputDir string, files ...generatedFile) error {
	if err := os.MkdirAll(outputDir, 0o755); err != nil {
		return fmt.Errorf("create output directory: %w", err)
	}
	var errs []error
	for _, file := range files {
		errs = append(errs, os.WriteFile(filepath.Join(outputDir, file.name), file.content, 0o644))
	}
	return errors.Join(errs...)
}

func readFrom(dir string) catalogue.ReadFile {
	return func(name string) ([]byte, error) {
		return os.ReadFile(filepath.Join(dir, name))
	}
}
