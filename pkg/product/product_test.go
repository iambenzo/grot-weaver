package product

import (
	"slices"
	"strings"
	"testing"

	"github.com/iambenzo/grot-weaver/pkg/finding"
)

var signals = []finding.Signal{finding.SignalMetrics, finding.SignalTraces, finding.SignalLogs}

func Test_Products_everyRequirementIsSourcedAndValid(t *testing.T) {
	seen := map[string]bool{}
	for _, product := range Products {
		if seen[product.ID] || product.ID == "" || product.Name == "" {
			t.Errorf("product %+v has a duplicate or empty id or name", product)
		}
		seen[product.ID] = true
		for _, requirement := range product.Requirements {
			if !strings.HasPrefix(requirement.Source, "https://grafana.com/docs/") {
				t.Errorf("%s %s source %q is not a grafana.com docs link", product.ID, requirement.Attribute, requirement.Source)
			}
			if !slices.Contains(signals, requirement.Signal) {
				t.Errorf("%s %s has unknown signal %q", product.ID, requirement.Attribute, requirement.Signal)
			}
			if requirement.Level != LevelRequired && requirement.Level != LevelRecommended {
				t.Errorf("%s %s has unknown level %q", product.ID, requirement.Attribute, requirement.Level)
			}
		}
	}
}

func Test_Products_everySignalWithRequirementsHasARequiredOne(t *testing.T) {
	for _, product := range Products {
		for _, signal := range signals {
			if len(product.For(signal, LevelRecommended)) > 0 && len(product.For(signal, LevelRequired)) == 0 {
				t.Errorf("%s has recommended %s attributes but no required ones", product.ID, signal)
			}
		}
	}
}

func Test_Product_For_filtersBySignalAndLevel(t *testing.T) {
	product := Product{Requirements: []Requirement{
		{Signal: finding.SignalTraces, Attribute: "a", Level: LevelRequired},
		{Signal: finding.SignalTraces, Attribute: "b", Level: LevelRecommended},
		{Signal: finding.SignalLogs, Attribute: "c", Level: LevelRequired},
	}}

	got := product.For(finding.SignalTraces, LevelRequired)

	if len(got) != 1 || got[0].Attribute != "a" {
		t.Errorf("For = %+v, want only a", got)
	}
}

func Test_Requirement_Names_putsTheAttributeBeforeItsAlternatives(t *testing.T) {
	requirement := Requirement{Attribute: "deployment.environment.name", Alternatives: []string{"deployment.environment"}}

	if got := requirement.Names(); !slices.Equal(got, []string{"deployment.environment.name", "deployment.environment"}) {
		t.Errorf("Names = %v", got)
	}
}
