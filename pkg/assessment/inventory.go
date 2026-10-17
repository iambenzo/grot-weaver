package assessment

import (
	"errors"
	"fmt"
	"path"
	"slices"
)

const (
	MaxDatasources      = 50
	MaxServicesPerTrace = 5000
	MaxKeysPerService   = 2000
	MaxNameLength       = 512
)

type Window struct {
	Start int64 `json:"start"`
	End   int64 `json:"end"`
}

type Inventory struct {
	Window           Window                 `json:"window"`
	Traces           []TraceDatasource      `json:"traces"`
	Metrics          []MetricDatasource     `json:"metrics"`
	Logs             []LogDatasource        `json:"logs"`
	Reclassification []ReclassificationRule `json:"reclassification,omitempty"`
	CustomNamespaces []string               `json:"custom_namespaces,omitempty"`
	PipelineMappings []PipelineMapping      `json:"pipeline_mappings,omitempty"`

	RequiredResourceAttributes []string `json:"required_resource_attributes,omitempty"`
}

const MaxCustomNamespaces = 200

func (inv Inventory) ReclassificationRules() []ReclassificationRule {
	if inv.Reclassification == nil {
		return DefaultReclassification
	}
	return inv.Reclassification
}

type TraceDatasource struct {
	UID      string         `json:"uid"`
	Services []TraceService `json:"services"`
}

type TraceService struct {
	ServiceName      string            `json:"service_name"`
	ServiceNamespace string            `json:"service_namespace"`
	SpanCount        float64           `json:"span_count"`
	ResourceKeys     []KeyObservation  `json:"resource_keys"`
	SpanKeys         []KeyObservation  `json:"span_keys"`
	SpanGroups       []SpanGroupSample `json:"span_groups"`
	SDK              SDK               `json:"sdk"`
	Unknown          []UnknownPart     `json:"unknown,omitempty"`
}

type UnknownPart string

const (
	UnknownNamespace    UnknownPart = "service_namespace"
	UnknownResourceKeys UnknownPart = "resource_keys"
	UnknownStreamLabels UnknownPart = "stream_labels"
	UnknownVolume       UnknownPart = "volume"
)

var unknownParts = []UnknownPart{UnknownNamespace, UnknownResourceKeys, UnknownStreamLabels, UnknownVolume}

func validateUnknown(parts []UnknownPart) error {
	if len(parts) > len(unknownParts) {
		return fmt.Errorf("%w: more unknown parts than exist", ErrInvalidInventory)
	}
	for index, part := range parts {
		if !slices.Contains(unknownParts, part) {
			return fmt.Errorf("%w: unknown part %q", ErrInvalidInventory, part)
		}
		if slices.Contains(parts[:index], part) {
			return fmt.Errorf("%w: unknown part %q listed twice", ErrInvalidInventory, part)
		}
	}
	return nil
}

type SpanGroupSample struct {
	Group   string         `json:"group"`
	Sampled int            `json:"sampled"`
	Present map[string]int `json:"present"`
}

type KeyObservation struct {
	Key    string  `json:"key"`
	Volume float64 `json:"volume"`
}

type SDK struct {
	Name     string `json:"name,omitempty"`
	Language string `json:"language,omitempty"`
	Version  string `json:"version,omitempty"`
	Distro   string `json:"distro,omitempty"`
}

var ErrInvalidInventory = errors.New("invalid inventory")

func (inv Inventory) Validate() error {
	if inv.Window.End < inv.Window.Start {
		return fmt.Errorf("%w: window ends before it starts", ErrInvalidInventory)
	}
	if len(inv.Traces) > MaxDatasources {
		return fmt.Errorf("%w: %d trace datasources exceeds %d", ErrInvalidInventory, len(inv.Traces), MaxDatasources)
	}
	for _, datasource := range inv.Traces {
		if err := datasource.validate(); err != nil {
			return err
		}
	}
	if len(inv.Metrics) > MaxDatasources {
		return fmt.Errorf("%w: %d metric datasources exceeds %d", ErrInvalidInventory, len(inv.Metrics), MaxDatasources)
	}
	for _, datasource := range inv.Metrics {
		if err := datasource.validate(); err != nil {
			return err
		}
	}
	if len(inv.Logs) > MaxDatasources {
		return fmt.Errorf("%w: %d log datasources exceeds %d", ErrInvalidInventory, len(inv.Logs), MaxDatasources)
	}
	for _, datasource := range inv.Logs {
		if err := datasource.validate(); err != nil {
			return err
		}
	}
	if len(inv.CustomNamespaces) > MaxCustomNamespaces {
		return fmt.Errorf("%w: %d custom namespaces exceeds %d", ErrInvalidInventory, len(inv.CustomNamespaces), MaxCustomNamespaces)
	}
	for _, namespace := range inv.CustomNamespaces {
		if namespace == "" || len(namespace) > MaxNameLength {
			return fmt.Errorf("%w: empty or overlong custom namespace", ErrInvalidInventory)
		}
	}
	for _, mapping := range inv.PipelineMappings {
		if _, err := path.Match(mapping.Match, ""); err != nil || mapping.Match == "" || mapping.Pipeline == "" || len(mapping.Pipeline) > MaxNameLength {
			return fmt.Errorf("%w: malformed pipeline mapping %q -> %q", ErrInvalidInventory, mapping.Match, mapping.Pipeline)
		}
	}
	if err := validateRequiredAttributes(inv.RequiredResourceAttributes); err != nil {
		return err
	}
	return validateReclassification(inv.Reclassification)
}

func (d TraceDatasource) validate() error {
	if d.UID == "" {
		return fmt.Errorf("%w: trace datasource without uid", ErrInvalidInventory)
	}
	if len(d.Services) > MaxServicesPerTrace {
		return fmt.Errorf("%w: datasource %s has %d services, limit %d", ErrInvalidInventory, d.UID, len(d.Services), MaxServicesPerTrace)
	}
	for _, service := range d.Services {
		if err := service.validate(); err != nil {
			return fmt.Errorf("datasource %s: %w", d.UID, err)
		}
	}
	return nil
}

func (s TraceService) validate() error {
	if len(s.ServiceName) > MaxNameLength || len(s.ServiceNamespace) > MaxNameLength {
		return fmt.Errorf("%w: service name longer than %d", ErrInvalidInventory, MaxNameLength)
	}
	if err := validateUnknown(s.Unknown); err != nil {
		return err
	}
	if len(s.ResourceKeys)+len(s.SpanKeys) > MaxKeysPerService {
		return fmt.Errorf("%w: service %q has more than %d keys", ErrInvalidInventory, s.ServiceName, MaxKeysPerService)
	}
	for _, key := range append(append([]KeyObservation{}, s.ResourceKeys...), s.SpanKeys...) {
		if key.Key == "" || len(key.Key) > MaxNameLength {
			return fmt.Errorf("%w: service %q has an empty or overlong key", ErrInvalidInventory, s.ServiceName)
		}
		if key.Volume < 0 {
			return fmt.Errorf("%w: key %q has negative volume", ErrInvalidInventory, key.Key)
		}
	}
	if s.SpanCount < 0 {
		return fmt.Errorf("%w: service %q has negative span count", ErrInvalidInventory, s.ServiceName)
	}
	if len(s.SpanGroups) > MaxKeysPerService {
		return fmt.Errorf("%w: service %q has too many span group samples", ErrInvalidInventory, s.ServiceName)
	}
	for _, sample := range s.SpanGroups {
		if err := sample.validate(); err != nil {
			return fmt.Errorf("service %q: %w", s.ServiceName, err)
		}
	}
	return nil
}

func (g SpanGroupSample) validate() error {
	if g.Group == "" || g.Sampled < 0 || len(g.Present) > MaxKeysPerService {
		return fmt.Errorf("%w: malformed span group sample %q", ErrInvalidInventory, g.Group)
	}
	for attribute, count := range g.Present {
		if count < 0 || count > g.Sampled || len(attribute) > MaxNameLength {
			return fmt.Errorf("%w: span group %q has impossible presence for %q", ErrInvalidInventory, g.Group, attribute)
		}
	}
	return nil
}
