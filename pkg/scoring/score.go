package scoring

import (
	"encoding/json"

	"github.com/iambenzo/otel-semconv-compliance/pkg/finding"
)

type Ratio struct {
	Numerator   float64 `json:"numerator"`
	Denominator float64 `json:"denominator"`
}

func (r Ratio) Value() (float64, bool) {
	if r.Denominator == 0 {
		return 0, false
	}
	return r.Numerator / r.Denominator, true
}

func (r Ratio) add(other Ratio) Ratio {
	return Ratio{Numerator: r.Numerator + other.Numerator, Denominator: r.Denominator + other.Denominator}
}

func (r Ratio) MarshalJSON() ([]byte, error) {
	value, defined := r.Value()
	type ratioJSON struct {
		Value       *float64 `json:"value"`
		Numerator   float64  `json:"numerator"`
		Denominator float64  `json:"denominator"`
	}
	encoded := ratioJSON{Numerator: r.Numerator, Denominator: r.Denominator}
	if defined {
		encoded.Value = &value
	}
	return json.Marshal(encoded)
}

type Scores struct {
	NamingStable       Ratio `json:"naming_stable"`
	NamingRC           Ratio `json:"naming_release_candidate"`
	NamingExperimental Ratio `json:"naming_experimental"`
	Requirements       Ratio `json:"requirements"`
	Resource           Ratio `json:"resource"`
	Deprecated         int   `json:"deprecated"`
	Unclassified       int   `json:"unclassified"`
	Custom             int   `json:"custom"`
}

func (s Scores) add(other Scores) Scores {
	return Scores{
		NamingStable:       s.NamingStable.add(other.NamingStable),
		NamingRC:           s.NamingRC.add(other.NamingRC),
		NamingExperimental: s.NamingExperimental.add(other.NamingExperimental),
		Requirements:       s.Requirements.add(other.Requirements),
		Resource:           s.Resource.add(other.Resource),
		Deprecated:         s.Deprecated + other.Deprecated,
		Unclassified:       s.Unclassified + other.Unclassified,
		Custom:             s.Custom + other.Custom,
	}
}

type Key struct {
	Owner  finding.Owner  `json:"owner"`
	Signal finding.Signal `json:"signal"`
}

type RequirementCheck struct {
	Owner     finding.Owner
	Signal    finding.Signal
	Satisfied bool
	Volume    float64
}

type ResourceCheck struct {
	Owner  finding.Owner
	Signal finding.Signal
	Name   string
	Passed bool
}

type Options struct {
	VolumeWeighted bool
}

func Score(findings []finding.Finding, requirements []RequirementCheck, resources []ResourceCheck, options Options) map[Key]Scores {
	scores := map[Key]Scores{}
	for _, f := range distinctNames(findings) {
		key := Key{Owner: f.Owner, Signal: f.Signal}
		scores[key] = scores[key].add(namingContribution(f, options))
	}
	for _, check := range requirements {
		key := Key{Owner: check.Owner, Signal: check.Signal}
		scores[key] = scores[key].add(Scores{Requirements: outcome(check.Satisfied, weight(check.Volume, options))})
	}
	for _, check := range resources {
		key := Key{Owner: check.Owner, Signal: check.Signal}
		scores[key] = scores[key].add(Scores{Resource: outcome(check.Passed, 1)})
	}
	return scores
}

func RollUp(scores map[Key]Scores, group func(Key) Key) map[Key]Scores {
	rolled := map[Key]Scores{}
	for key, value := range scores {
		target := group(key)
		rolled[target] = rolled[target].add(value)
	}
	return rolled
}

func ByNamespace(key Key) Key {
	return Key{Owner: finding.Owner{Kind: key.Owner.Kind, Namespace: key.Owner.Namespace}, Signal: key.Signal}
}

func BySignal(key Key) Key {
	return Key{Signal: key.Signal}
}

func namingContribution(f finding.Finding, options Options) Scores {
	unit := weight(f.Volume, options)
	switch {
	case f.Type == finding.TypeConformant:
		return bucketRatio(f.Bucket, Ratio{Numerator: unit, Denominator: unit})
	case f.IsNamingViolation():
		contribution := bucketRatio(f.Bucket, Ratio{Denominator: unit})
		if f.Type == finding.TypeDeprecated {
			contribution.Deprecated = 1
		}
		return contribution
	case f.Type == finding.TypeNotInRegistry:
		return Scores{Unclassified: 1}
	case f.Type == finding.TypeCustom:
		return Scores{Custom: 1}
	default:
		return Scores{}
	}
}

func bucketRatio(bucket finding.Bucket, ratio Ratio) Scores {
	switch bucket {
	case finding.BucketStable:
		return Scores{NamingStable: ratio}
	case finding.BucketReleaseCandidate:
		return Scores{NamingRC: ratio}
	case finding.BucketExperimental:
		return Scores{NamingExperimental: ratio}
	default:
		return Scores{}
	}
}

func outcome(passed bool, unit float64) Ratio {
	if passed {
		return Ratio{Numerator: unit, Denominator: unit}
	}
	return Ratio{Denominator: unit}
}

func weight(volume float64, options Options) float64 {
	if options.VolumeWeighted {
		return volume
	}
	return 1
}

type nameKey struct {
	key      Key
	observed string
	kind     finding.Type
}

func distinctNames(findings []finding.Finding) []finding.Finding {
	index := map[nameKey]int{}
	var distinct []finding.Finding
	for _, f := range findings {
		k := nameKey{key: Key{Owner: f.Owner, Signal: f.Signal}, observed: f.Observed, kind: f.Type}
		if position, seen := index[k]; seen {
			distinct[position].Volume += f.Volume
			continue
		}
		index[k] = len(distinct)
		distinct = append(distinct, f)
	}
	return distinct
}
