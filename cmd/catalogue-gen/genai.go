package main

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"net/http"
	"regexp"

	"go.yaml.in/yaml/v3"
)

const (
	autoCommit             = "auto"
	genAIBranch            = "main"
	genAIManifestURLFormat = "https://raw.githubusercontent.com/" + genAIRepository + "/%s/model/manifest.yaml"
	maxManifestBytes       = 1 << 20
)

var coreDependencyPattern = regexp.MustCompile(`semantic-conventions(?:\.git)?@(v\d+\.\d+\.\d+)`)

type genAIManifest struct {
	Dependencies []struct {
		RegistryPath string `yaml:"registry_path"`
	} `yaml:"dependencies"`
}

type genAIChoice struct {
	commit string
	reason string
}

func coreDependencyOf(manifest []byte) (string, error) {
	var parsed genAIManifest
	if err := yaml.NewDecoder(bytes.NewReader(manifest)).Decode(&parsed); err != nil {
		return "", fmt.Errorf("decode genai manifest: %w", err)
	}
	for _, dependency := range parsed.Dependencies {
		if match := coreDependencyPattern.FindStringSubmatch(dependency.RegistryPath); match != nil {
			return match[1], nil
		}
	}
	return "", fmt.Errorf("genai manifest declares no semantic-conventions dependency")
}

func chooseGenAICommit(latestCommit, latestDependency, coreVersion, previousCommit string) genAIChoice {
	if latestDependency == coreVersion {
		return genAIChoice{commit: latestCommit, reason: fmt.Sprintf("latest genai commit %s depends on core %s", latestCommit, coreVersion)}
	}
	return genAIChoice{
		commit: previousCommit,
		reason: fmt.Sprintf("kept genai commit %s: latest genai commit %s depends on core %s, not %s", previousCommit, latestCommit, latestDependency, coreVersion),
	}
}

func (c githubClient) latestCommit(ctx context.Context, repository, branch string) (string, error) {
	var commit struct {
		SHA string `json:"sha"`
	}
	if err := c.getJSON(ctx, fmt.Sprintf("/repos/%s/commits/%s", repository, branch), &commit); err != nil {
		return "", err
	}
	if !commitPattern.MatchString(commit.SHA) {
		return "", fmt.Errorf("latest %s commit %q is not a full SHA", repository, commit.SHA)
	}
	return commit.SHA, nil
}

func fetchGenAIManifest(ctx context.Context, client *http.Client, commit string) ([]byte, error) {
	url := fmt.Sprintf(genAIManifestURLFormat, commit)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, err
	}
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("GET %s: unexpected status %s", url, resp.Status)
	}
	return io.ReadAll(io.LimitReader(resp.Body, maxManifestBytes))
}

func resolveGenAICommit(ctx context.Context, github githubClient, client *http.Client, requested, coreVersion, previousCommit string) (genAIChoice, error) {
	if requested != autoCommit {
		return genAIChoice{commit: requested, reason: "genai commit given explicitly"}, nil
	}
	latest, err := github.latestCommit(ctx, genAIRepository, genAIBranch)
	if err != nil {
		return genAIChoice{}, fmt.Errorf("find latest genai commit: %w", err)
	}
	manifest, err := fetchGenAIManifest(ctx, client, latest)
	if err != nil {
		return genAIChoice{}, err
	}
	dependency, err := coreDependencyOf(manifest)
	if err != nil {
		return genAIChoice{}, err
	}
	if previousCommit == "" {
		previousCommit = pinnedGenAICommit
	}
	return chooseGenAICommit(latest, dependency, coreVersion, previousCommit), nil
}
