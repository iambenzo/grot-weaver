package catalogue

import (
	"encoding/json"
	"fmt"
)

const (
	CoreFile     = "core.json"
	GenAIFile    = "genai.json"
	RenamesFile  = "renames.json"
	ManifestFile = "manifest.json"
)

type ReadFile func(name string) ([]byte, error)

type Catalogue struct {
	Manifest       Manifest
	Registry       Registry
	Renames        RenameHistory
	attributeIndex map[string]int
	metricIndex    map[string]int
	placements     map[string]Placement
	spanGroupRules []SpanGroupRule
}

func Load(read ReadFile) (*Catalogue, error) {
	var manifest Manifest
	if err := readJSON(read, ManifestFile, &manifest); err != nil {
		return nil, err
	}

	core, err := readRegistry(read, CoreFile, SourceCore)
	if err != nil {
		return nil, err
	}

	genAI, err := readRegistry(read, GenAIFile, SourceGenAI)
	if err != nil {
		return nil, err
	}

	var renames RenameHistory
	if err := readJSON(read, RenamesFile, &renames); err != nil {
		return nil, err
	}

	return New(manifest, Overlay(core, genAI), renames.inVersionOrder()), nil
}

func New(manifest Manifest, registry Registry, renames RenameHistory) *Catalogue {
	return &Catalogue{
		Manifest:       manifest,
		Registry:       registry,
		Renames:        renames,
		attributeIndex: indexByName(registry.Attributes, func(a Attribute) string { return a.Name }),
		metricIndex:    indexByName(registry.Metrics, func(m Metric) string { return m.Name }),
		placements:     placementsOf(registry),
		spanGroupRules: spanGroupRulesOf(registry),
	}
}

func readRegistry(read ReadFile, name string, source Source) (Registry, error) {
	var registry Registry
	if err := readJSON(read, name, &registry); err != nil {
		return Registry{}, err
	}
	return registry.withSource(source), nil
}

func readJSON(read ReadFile, name string, target any) error {
	content, err := read(name)
	if err != nil {
		return fmt.Errorf("read %s: %w", name, err)
	}
	if err := json.Unmarshal(content, target); err != nil {
		return fmt.Errorf("decode %s: %w", name, err)
	}
	return nil
}

func (r Registry) withSource(source Source) Registry {
	for i := range r.Attributes {
		r.Attributes[i].Source = source
	}
	for i := range r.Metrics {
		r.Metrics[i].Source = source
	}
	for i := range r.Spans {
		r.Spans[i].Source = source
	}
	for i := range r.Entities {
		r.Entities[i].Source = source
	}
	for i := range r.Events {
		r.Events[i].Source = source
	}
	return r
}
