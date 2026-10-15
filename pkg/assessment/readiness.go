package assessment

import (
	"github.com/iambenzo/otel-semconv-compliance/pkg/product"
	"github.com/iambenzo/otel-semconv-compliance/pkg/scoring"
)

type ProductReadiness struct {
	scoring.Key
	Product            string        `json:"product"`
	ProductName        string        `json:"product_name"`
	Readiness          scoring.Ratio `json:"readiness"`
	Present            []string      `json:"present"`
	Missing            []string      `json:"missing"`
	Unknown            []string      `json:"unknown"`
	MissingRecommended []string      `json:"missing_recommended"`
}

func (c *resourceCollector) readiness(products []product.Product) []ProductReadiness {
	rows := []ProductReadiness{}
	for _, key := range c.sortedKeys() {
		for _, candidate := range products {
			if required := candidate.For(key.Signal, product.LevelRequired); len(required) > 0 {
				rows = append(rows, c.observed[key].readinessFor(key, candidate, required))
			}
		}
	}
	return rows
}

func (o *observedResource) readinessFor(key scoring.Key, candidate product.Product, required []product.Requirement) ProductReadiness {
	row := ProductReadiness{
		Key: key, Product: candidate.ID, ProductName: candidate.Name,
		Present: []string{}, Missing: []string{}, Unknown: []string{}, MissingRecommended: []string{},
	}
	for _, requirement := range required {
		switch o.judgeAny(requirement.Names()) {
		case PresencePresent:
			row.Present = append(row.Present, requirement.Attribute)
		case PresenceMissing:
			row.Missing = append(row.Missing, requirement.Attribute)
		default:
			row.Unknown = append(row.Unknown, requirement.Attribute)
		}
	}
	for _, requirement := range candidate.For(key.Signal, product.LevelRecommended) {
		if o.judgeAny(requirement.Names()) == PresenceMissing {
			row.MissingRecommended = append(row.MissingRecommended, requirement.Attribute)
		}
	}
	row.Readiness = scoring.Ratio{Numerator: float64(len(row.Present)), Denominator: float64(len(row.Present) + len(row.Missing))}
	return row
}
