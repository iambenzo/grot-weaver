package catalogue

import (
	"encoding/json"
	"fmt"
	"io/fs"
)

const (
	CoreFile     = "core.json"
	GenAIFile    = "genai.json"
	RenamesFile  = "renames.json"
	ManifestFile = "manifest.json"
)

type Catalogue struct {
	Manifest       Manifest
	Registry       Registry
	Renames        RenameHistory
	attributeIndex map[string]int
	metricIndex    map[string]int
	placements     map[string]Placement
}

func Load(fsys fs.FS) (*Catalogue, error) {
	var manifest Manifest
	if err := readJSON(fsys, ManifestFile, &manifest); err != nil {
		return nil, err
	}

	core, err := readRegistry(fsys, CoreFile, SourceCore)
	if err != nil {
		return nil, err
	}

	genAI, err := readRegistry(fsys, GenAIFile, SourceGenAI)
	if err != nil {
		return nil, err
	}

	var renames RenameHistory
	if err := readJSON(fsys, RenamesFile, &renames); err != nil {
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
	}
}

func readRegistry(fsys fs.FS, name string, source Source) (Registry, error) {
	var registry Registry
	if err := readJSON(fsys, name, &registry); err != nil {
		return Registry{}, err
	}
	return registry.withSource(source), nil
}

func readJSON(fsys fs.FS, name string, target any) error {
	content, err := fs.ReadFile(fsys, name)
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
