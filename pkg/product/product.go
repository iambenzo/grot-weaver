package product

import "github.com/iambenzo/otel-semconv-compliance/pkg/finding"

type Level string

const (
	LevelRequired    Level = "required"
	LevelRecommended Level = "recommended"
)

type Requirement struct {
	Signal       finding.Signal `json:"signal"`
	Attribute    string         `json:"attribute"`
	Alternatives []string       `json:"alternatives,omitempty"`
	Level        Level          `json:"level"`
	Source       string         `json:"source"`
}

func (r Requirement) Names() []string {
	return append([]string{r.Attribute}, r.Alternatives...)
}

type Product struct {
	ID           string        `json:"id"`
	Name         string        `json:"name"`
	Summary      string        `json:"summary"`
	Requirements []Requirement `json:"requirements"`
}

func (p Product) For(signal finding.Signal, level Level) []Requirement {
	matching := []Requirement{}
	for _, requirement := range p.Requirements {
		if requirement.Signal == signal && requirement.Level == level {
			matching = append(matching, requirement)
		}
	}
	return matching
}
