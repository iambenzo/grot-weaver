package catalogue

import (
	"encoding/json"
	"fmt"
)

type Stability string

const (
	StabilityStable           Stability = "stable"
	StabilityReleaseCandidate Stability = "release_candidate"
	StabilityDevelopment      Stability = "development"
	StabilityAlpha            Stability = "alpha"
)

type Source string

const (
	SourceCore          Source = "core"
	SourceGenAI         Source = "genai"
	SourceRenameHistory Source = "rename_history"
)

type Deprecation struct {
	Reason    string `json:"reason"`
	RenamedTo string `json:"renamed_to,omitempty"`
	Note      string `json:"note,omitempty"`
}

type RequirementLevel struct {
	Level     string `json:"level"`
	Condition string `json:"condition,omitempty"`
}

func (r *RequirementLevel) UnmarshalJSON(data []byte) error {
	var level string
	if err := json.Unmarshal(data, &level); err == nil {
		*r = RequirementLevel{Level: level}
		return nil
	}
	var conditional map[string]string
	if err := json.Unmarshal(data, &conditional); err != nil {
		return fmt.Errorf("requirement level must be a string or a single-key object: %w", err)
	}
	if len(conditional) != 1 {
		return fmt.Errorf("requirement level object must have one key, got %d", len(conditional))
	}
	for level, condition := range conditional {
		*r = RequirementLevel{Level: level, Condition: condition}
	}
	return nil
}

type AttributeRef struct {
	Name             string           `json:"name"`
	RequirementLevel RequirementLevel `json:"requirement_level"`
	Role             string           `json:"role,omitempty"`
}

type Attribute struct {
	Name       string       `json:"name"`
	Type       string       `json:"type"`
	Stability  Stability    `json:"stability"`
	Deprecated *Deprecation `json:"deprecated"`
	Source     Source       `json:"source"`
}

type Metric struct {
	Name       string         `json:"name"`
	Instrument string         `json:"instrument"`
	Unit       string         `json:"unit"`
	Stability  Stability      `json:"stability"`
	Deprecated *Deprecation   `json:"deprecated"`
	Attributes []AttributeRef `json:"attributes"`
	Source     Source         `json:"source"`
}

type Span struct {
	ID         string         `json:"id"`
	SpanKind   string         `json:"span_kind"`
	Stability  Stability      `json:"stability"`
	Deprecated *Deprecation   `json:"deprecated"`
	Attributes []AttributeRef `json:"attributes"`
	Source     Source         `json:"source"`
}

type Entity struct {
	Name       string         `json:"name"`
	Stability  Stability      `json:"stability"`
	Deprecated *Deprecation   `json:"deprecated"`
	Attributes []AttributeRef `json:"attributes"`
	Source     Source         `json:"source"`
}

type Event struct {
	Name       string         `json:"name"`
	Stability  Stability      `json:"stability"`
	Deprecated *Deprecation   `json:"deprecated"`
	Attributes []AttributeRef `json:"attributes"`
	Source     Source         `json:"source"`
}

type Registry struct {
	Attributes []Attribute `json:"attributes"`
	Metrics    []Metric    `json:"metrics"`
	Spans      []Span      `json:"spans"`
	Entities   []Entity    `json:"entities"`
	Events     []Event     `json:"events"`
}

type Manifest struct {
	Semconv        SemconvSource `json:"semconv"`
	GenAI          GenAISource   `json:"genai"`
	WeaverImage    string        `json:"weaver_image"`
	TemplateSHA256 string        `json:"template_sha256"`
}

type SemconvSource struct {
	Version   string `json:"version"`
	Registry  string `json:"registry"`
	SchemaURL string `json:"schema_url"`
}

type GenAISource struct {
	Commit      string `json:"commit"`
	CommittedAt string `json:"committed_at"`
	Registry    string `json:"registry"`
}
