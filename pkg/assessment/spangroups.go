package assessment

import (
	"fmt"

	"github.com/iambenzo/grot-weaver/pkg/catalogue"
	"github.com/iambenzo/grot-weaver/pkg/finding"
	"github.com/iambenzo/grot-weaver/pkg/nameindex"
	"github.com/iambenzo/grot-weaver/pkg/scoring"
)

const downstreamCaveat = "may have been removed between the service and storage"

func (a *Assessor) spanGroupFindings(owner finding.Owner, samples []SpanGroupSample, volume float64) ([]finding.Finding, []scoring.RequirementCheck) {
	rules := map[string]catalogue.SpanGroupRule{}
	for _, rule := range a.catalogue.SpanGroupRules() {
		rules[rule.ID] = rule
	}
	var findings []finding.Finding
	var checks []scoring.RequirementCheck
	for _, sample := range samples {
		rule, known := rules[sample.Group]
		if !known || sample.Sampled == 0 {
			continue
		}
		for _, attribute := range rule.Required {
			present := sample.Present[attribute]
			satisfied := present == sample.Sampled
			checks = append(checks, scoring.RequirementCheck{Owner: owner, Signal: finding.SignalTraces, Satisfied: satisfied, Volume: volume})
			if !satisfied {
				findings = append(findings, requirementFinding(owner, rule, attribute, finding.TypeRequiredAttributeMissing, sample, volume))
			}
		}
		for _, attribute := range rule.Recommended {
			if sample.Present[attribute] < sample.Sampled {
				findings = append(findings, requirementFinding(owner, rule, attribute, finding.TypeRecommendedAttributeAbsent, sample, volume))
			}
		}
	}
	return findings, checks
}

func requirementFinding(owner finding.Owner, rule catalogue.SpanGroupRule, attribute string, t finding.Type, sample SpanGroupSample, volume float64) finding.Finding {
	missing := sample.Sampled - sample.Present[attribute]
	return finding.Finding{
		Type:       t,
		Level:      finding.LevelOf(t),
		Signal:     finding.SignalTraces,
		Owner:      owner,
		Observed:   rule.ID,
		Scope:      catalogue.ScopeSpans,
		Expected:   attribute,
		Confidence: nameindex.ConfidenceMedium,
		Note:       fmt.Sprintf("missing on %d of %d sampled %s spans; %s", missing, sample.Sampled, rule.ID, downstreamCaveat),
		Volume:     volume,
	}
}
