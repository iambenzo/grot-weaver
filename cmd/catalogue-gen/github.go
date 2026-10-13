package main

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
)

const maxReleaseResponseBytes = 1 << 20

type githubRelease struct {
	TagName string `json:"tag_name"`
}

func fetchLatestReleaseTag(ctx context.Context, client *http.Client, baseURL, repository, token string) (string, error) {
	url := fmt.Sprintf("%s/repos/%s/releases/latest", baseURL, repository)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return "", err
	}
	req.Header.Set("Accept", "application/vnd.github+json")
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}

	resp, err := client.Do(req)
	if err != nil {
		return "", err
	}
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("GET %s: unexpected status %s", url, resp.Status)
	}

	var release githubRelease
	if err := json.NewDecoder(io.LimitReader(resp.Body, maxReleaseResponseBytes)).Decode(&release); err != nil {
		return "", fmt.Errorf("decode release: %w", err)
	}
	if release.TagName == "" {
		return "", fmt.Errorf("GET %s: release has no tag_name", url)
	}
	return release.TagName, nil
}
