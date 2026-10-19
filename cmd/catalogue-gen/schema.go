package main

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"slices"
	"strings"

	"go.yaml.in/yaml/v3"

	"github.com/iambenzo/grot-weaver/pkg/catalogue"
)

const (
	schemaBaseURL         = "https://opentelemetry.io/schemas/"
	maxSchemaResponseSize = 8 << 20
)

type schemaFile struct {
	FileFormat string                    `yaml:"file_format"`
	SchemaURL  string                    `yaml:"schema_url"`
	Versions   map[string]*schemaVersion `yaml:"versions"`
}

type schemaVersion map[string]schemaSection

type schemaSection struct {
	Changes []schemaChange `yaml:"changes"`
}

type schemaChange struct {
	RenameAttributes *schemaAttributeRename `yaml:"rename_attributes"`
	RenameMetrics    map[string]string      `yaml:"rename_metrics"`
}

type schemaAttributeRename struct {
	AttributeMap   map[string]string `yaml:"attribute_map"`
	ApplyToMetrics []string          `yaml:"apply_to_metrics"`
}

var knownScopes = []catalogue.RenameScope{
	catalogue.ScopeAll, catalogue.ScopeSpans, catalogue.ScopeMetrics, catalogue.ScopeResources, catalogue.ScopeLogs,
}

func schemaURLFor(version string) string {
	return schemaBaseURL + strings.TrimPrefix(version, "v")
}

func fetchSchema(ctx context.Context, client *http.Client, url string) ([]byte, error) {
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
	return io.ReadAll(io.LimitReader(resp.Body, maxSchemaResponseSize))
}

func parseRenameHistory(content []byte) (catalogue.RenameHistory, error) {
	decoder := yaml.NewDecoder(bytes.NewReader(content))
	decoder.KnownFields(true)
	var file schemaFile
	if err := decoder.Decode(&file); err != nil {
		return catalogue.RenameHistory{}, fmt.Errorf("decode schema file: %w", err)
	}

	history := catalogue.RenameHistory{SchemaURL: file.SchemaURL}
	var errs []error
	for version, sections := range file.Versions {
		if sections == nil {
			continue
		}
		for scopeName, section := range *sections {
			scope := catalogue.RenameScope(scopeName)
			if !slices.Contains(knownScopes, scope) {
				errs = append(errs, fmt.Errorf("version %s: unknown section %q", version, scopeName))
				continue
			}
			history = appendChanges(history, version, scope, section.Changes)
		}
	}
	if err := errors.Join(errs...); err != nil {
		return catalogue.RenameHistory{}, err
	}
	return sortedHistory(history), nil
}

func appendChanges(history catalogue.RenameHistory, version string, scope catalogue.RenameScope, changes []schemaChange) catalogue.RenameHistory {
	for _, change := range changes {
		if change.RenameAttributes != nil {
			for from, to := range change.RenameAttributes.AttributeMap {
				history.Attributes = append(history.Attributes, catalogue.AttributeRename{
					From: from, To: to, Version: version, Scope: scope, Metrics: sortedCopy(change.RenameAttributes.ApplyToMetrics),
				})
			}
		}
		for from, to := range change.RenameMetrics {
			history.Metrics = append(history.Metrics, catalogue.MetricRename{From: from, To: to, Version: version})
		}
	}
	return history
}

func sortedHistory(history catalogue.RenameHistory) catalogue.RenameHistory {
	slices.SortFunc(history.Attributes, func(a, b catalogue.AttributeRename) int {
		if c := catalogue.CompareVersions(a.Version, b.Version); c != 0 {
			return c
		}
		if c := strings.Compare(string(a.Scope), string(b.Scope)); c != 0 {
			return c
		}
		if c := strings.Compare(a.From, b.From); c != 0 {
			return c
		}
		return slices.Compare(a.Metrics, b.Metrics)
	})
	slices.SortFunc(history.Metrics, func(a, b catalogue.MetricRename) int {
		if c := catalogue.CompareVersions(a.Version, b.Version); c != 0 {
			return c
		}
		return strings.Compare(a.From, b.From)
	})
	return history
}

func sortedCopy(values []string) []string {
	if len(values) == 0 {
		return nil
	}
	copied := slices.Clone(values)
	slices.Sort(copied)
	return copied
}
