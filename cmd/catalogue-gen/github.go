package main

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
)

const maxGitHubResponseBytes = 1 << 20

type githubClient struct {
	httpClient *http.Client
	baseURL    string
	token      string
}

type githubRelease struct {
	TagName string `json:"tag_name"`
}

type githubCommit struct {
	Commit struct {
		Committer struct {
			Date string `json:"date"`
		} `json:"committer"`
	} `json:"commit"`
}

func (c githubClient) latestReleaseTag(ctx context.Context, repository string) (string, error) {
	var release githubRelease
	if err := c.getJSON(ctx, fmt.Sprintf("/repos/%s/releases/latest", repository), &release); err != nil {
		return "", err
	}
	if release.TagName == "" {
		return "", fmt.Errorf("latest release of %s has no tag_name", repository)
	}
	return release.TagName, nil
}

func (c githubClient) commitDate(ctx context.Context, repository, sha string) (string, error) {
	var commit githubCommit
	if err := c.getJSON(ctx, fmt.Sprintf("/repos/%s/commits/%s", repository, sha), &commit); err != nil {
		return "", err
	}
	if commit.Commit.Committer.Date == "" {
		return "", fmt.Errorf("commit %s of %s has no committer date", sha, repository)
	}
	return commit.Commit.Committer.Date, nil
}

func (c githubClient) getJSON(ctx context.Context, path string, target any) error {
	url := c.baseURL + path
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return err
	}
	req.Header.Set("Accept", "application/vnd.github+json")
	if c.token != "" {
		req.Header.Set("Authorization", "Bearer "+c.token)
	}

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return err
	}
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("GET %s: unexpected status %s", url, resp.Status)
	}
	if err := json.NewDecoder(io.LimitReader(resp.Body, maxGitHubResponseBytes)).Decode(target); err != nil {
		return fmt.Errorf("decode %s: %w", url, err)
	}
	return nil
}
