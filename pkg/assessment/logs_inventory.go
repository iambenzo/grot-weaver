package assessment

import "fmt"

const MaxLogServices = 5000

type LogKeysMethod string

const (
	MethodDetectedFields LogKeysMethod = "detected_fields"
	MethodSample         LogKeysMethod = "sample"
)

type LogDatasource struct {
	UID      string       `json:"uid"`
	Labels   []string     `json:"labels"`
	Services []LogService `json:"services"`
}

type LogService struct {
	ServiceName      string        `json:"service_name"`
	ServiceNamespace string        `json:"service_namespace"`
	StreamLabels     []string      `json:"stream_labels"`
	MetadataKeys     []string      `json:"metadata_keys"`
	KeysMethod       LogKeysMethod `json:"keys_method"`
	SampledLines     int           `json:"sampled_lines"`
	OTLPMarkers      []string      `json:"otlp_markers"`
	ScopeNames       []string      `json:"scope_names"`
	SDK              SDK           `json:"sdk"`
	Volume           float64       `json:"volume"`
}

func (d LogDatasource) validate() error {
	if d.UID == "" {
		return fmt.Errorf("%w: log datasource without uid", ErrInvalidInventory)
	}
	if len(d.Services) > MaxLogServices || len(d.Labels) > MaxLabelsPerSet {
		return fmt.Errorf("%w: log datasource %s exceeds size limits", ErrInvalidInventory, d.UID)
	}
	for _, service := range d.Services {
		if err := service.validate(); err != nil {
			return fmt.Errorf("log datasource %s: %w", d.UID, err)
		}
	}
	return nil
}

func (s LogService) validate() error {
	if len(s.ServiceName) > MaxNameLength || len(s.ServiceNamespace) > MaxNameLength {
		return fmt.Errorf("%w: log service name longer than %d", ErrInvalidInventory, MaxNameLength)
	}
	if s.Volume < 0 || s.SampledLines < 0 {
		return fmt.Errorf("%w: log service %q has negative counts", ErrInvalidInventory, s.ServiceName)
	}
	if s.KeysMethod != "" && s.KeysMethod != MethodDetectedFields && s.KeysMethod != MethodSample {
		return fmt.Errorf("%w: log service %q has unknown keys method %q", ErrInvalidInventory, s.ServiceName, s.KeysMethod)
	}
	for _, list := range [][]string{s.StreamLabels, s.MetadataKeys, s.OTLPMarkers, s.ScopeNames} {
		if len(list) > MaxLabelsPerSet {
			return fmt.Errorf("%w: log service %q has too many keys", ErrInvalidInventory, s.ServiceName)
		}
		for _, item := range list {
			if item == "" || len(item) > MaxNameLength {
				return fmt.Errorf("%w: log service %q has an empty or overlong key", ErrInvalidInventory, s.ServiceName)
			}
		}
	}
	return nil
}
