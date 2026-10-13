package assessment

import (
	"errors"
	"fmt"
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
	Window Window            `json:"window"`
	Traces []TraceDatasource `json:"traces"`
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
	return nil
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
