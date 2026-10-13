package finding

import (
	"github.com/iambenzo/otel-semconv-compliance/pkg/catalogue"
	"github.com/iambenzo/otel-semconv-compliance/pkg/nameindex"
)

type Type string

const (
	TypeConformant                 Type = "conformant"
	TypeDeprecated                 Type = "deprecated"
	TypeUnitMismatch               Type = "unit_mismatch"
	TypeRequiredAttributeMissing   Type = "required_attribute_not_present"
	TypeRecommendedAttributeAbsent Type = "recommended_attribute_not_present"
	TypeMisplacedAttribute         Type = "misplaced_attribute"
	TypeNotInRegistry              Type = "not_in_registry"
	TypeCustom                     Type = "custom"
	TypeSDKDefaultServiceName      Type = "sdk_default_service_name"
	TypeMissingServiceName         Type = "missing_service_name"
)

type Level string

const (
	LevelNone        Level = ""
	LevelViolation   Level = "violation"
	LevelImprovement Level = "improvement"
	LevelInformation Level = "information"
)

type Bucket string

const (
	BucketStable           Bucket = "stable"
	BucketReleaseCandidate Bucket = "release_candidate"
	BucketExperimental     Bucket = "experimental"
	BucketUnclassified     Bucket = "unclassified"
)

type Signal string

const (
	SignalMetrics Signal = "metrics"
	SignalTraces  Signal = "traces"
	SignalLogs    Signal = "logs"
)

type OwnerKind string

const (
	OwnerService      OwnerKind = "service"
	OwnerPipeline     OwnerKind = "pipeline"
	OwnerSource       OwnerKind = "source"
	OwnerUnattributed OwnerKind = "unattributed"
)

type Owner struct {
	Kind      OwnerKind `json:"kind"`
	Namespace string    `json:"namespace,omitempty"`
	Name      string    `json:"name"`
}

type Finding struct {
	Type               Type                 `json:"type"`
	Level              Level                `json:"level,omitempty"`
	Signal             Signal               `json:"signal"`
	Owner              Owner                `json:"owner"`
	Observed           string               `json:"observed"`
	Expected           string               `json:"expected,omitempty"`
	Bucket             Bucket               `json:"bucket,omitempty"`
	Confidence         nameindex.Confidence `json:"confidence,omitempty"`
	Note               string               `json:"note,omitempty"`
	Source             catalogue.Source     `json:"source,omitempty"`
	Volume             float64              `json:"volume"`
	PipelineIntroduced bool                 `json:"pipeline_introduced,omitempty"`
}

var levels = map[Type]Level{
	TypeConformant:                 LevelNone,
	TypeDeprecated:                 LevelViolation,
	TypeUnitMismatch:               LevelViolation,
	TypeRequiredAttributeMissing:   LevelViolation,
	TypeRecommendedAttributeAbsent: LevelImprovement,
	TypeMisplacedAttribute:         LevelImprovement,
	TypeNotInRegistry:              LevelViolation,
	TypeCustom:                     LevelInformation,
	TypeSDKDefaultServiceName:      LevelViolation,
	TypeMissingServiceName:         LevelViolation,
}

func LevelOf(t Type) Level {
	return levels[t]
}

func (f Finding) IsNamingViolation() bool {
	return f.Type == TypeDeprecated || f.Type == TypeUnitMismatch
}
