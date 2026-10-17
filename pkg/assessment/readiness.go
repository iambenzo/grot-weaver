package assessment

import (
	"slices"

	"github.com/iambenzo/otel-semconv-compliance/pkg/finding"
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
	row.Readiness = readinessRatio(row)
	return row
}

func readinessRatio(row ProductReadiness) scoring.Ratio {
	return shareOf(len(row.Present), len(row.Missing), len(row.Unknown))
}

func shareOf(present, missing, unknown int) scoring.Ratio {
	if unknown > 0 && missing == 0 {
		return scoring.Ratio{}
	}
	return scoring.Ratio{Numerator: float64(present), Denominator: float64(present + missing)}
}

type ServiceReadiness struct {
	Kind        finding.OwnerKind `json:"kind"`
	Name        string            `json:"name"`
	Product     string            `json:"product"`
	ProductName string            `json:"product_name"`
	Overall     scoring.Ratio     `json:"overall"`
	Signals     []SignalReadiness `json:"signals"`
}

type SignalReadiness struct {
	Signal             finding.Signal `json:"signal"`
	Readiness          scoring.Ratio  `json:"readiness"`
	Present            []string       `json:"present"`
	Missing            []string       `json:"missing"`
	Unknown            []string       `json:"unknown"`
	MissingRecommended []string       `json:"missing_recommended"`
}

type serviceProduct struct {
	kind    finding.OwnerKind
	name    string
	product string
}

func serviceReadiness(rows []ProductReadiness) []ServiceReadiness {
	services := []ServiceReadiness{}
	position := map[serviceProduct]int{}
	for _, row := range rows {
		key := serviceProduct{kind: row.Owner.Kind, name: row.Owner.Name, product: row.Product}
		index, seen := position[key]
		if !seen {
			index = len(services)
			position[key] = index
			services = append(services, ServiceReadiness{Kind: row.Owner.Kind, Name: row.Owner.Name, Product: row.Product, ProductName: row.ProductName, Signals: []SignalReadiness{}})
		}
		services[index].Signals = mergeSignal(services[index].Signals, row)
	}
	for index := range services {
		services[index].Overall = overallShare(services[index].Signals)
	}
	return services
}

func mergeSignal(signals []SignalReadiness, row ProductReadiness) []SignalReadiness {
	index := slices.IndexFunc(signals, func(signal SignalReadiness) bool { return signal.Signal == row.Signal })
	if index < 0 {
		signal := SignalReadiness{Signal: row.Signal, Present: slices.Clone(row.Present), Missing: slices.Clone(row.Missing), Unknown: slices.Clone(row.Unknown), MissingRecommended: slices.Clone(row.MissingRecommended)}
		signal.Readiness = shareOf(len(signal.Present), len(signal.Missing), len(signal.Unknown))
		return append(signals, signal)
	}
	merged := signals[index]
	merged.Present = union(merged.Present, row.Present)
	merged.Missing = without(union(merged.Missing, row.Missing), merged.Present)
	merged.Unknown = without(without(union(merged.Unknown, row.Unknown), merged.Present), merged.Missing)
	merged.MissingRecommended = slices.DeleteFunc(slices.Clone(merged.MissingRecommended), func(attribute string) bool {
		return !slices.Contains(row.MissingRecommended, attribute)
	})
	merged.Readiness = shareOf(len(merged.Present), len(merged.Missing), len(merged.Unknown))
	signals[index] = merged
	return signals
}

func overallShare(signals []SignalReadiness) scoring.Ratio {
	present, missing, unknown := 0, 0, 0
	for _, signal := range signals {
		present += len(signal.Present)
		missing += len(signal.Missing)
		unknown += len(signal.Unknown)
	}
	return shareOf(present, missing, unknown)
}

func union(first, second []string) []string {
	merged := slices.Clone(first)
	for _, attribute := range second {
		if !slices.Contains(merged, attribute) {
			merged = append(merged, attribute)
		}
	}
	return merged
}

func without(attributes, removed []string) []string {
	return slices.DeleteFunc(slices.Clone(attributes), func(attribute string) bool { return slices.Contains(removed, attribute) })
}
