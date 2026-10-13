package catalogue

import (
	"slices"
	"strings"
)

const (
	levelRequired    = "required"
	levelRecommended = "recommended"
	spanGroupPrefix  = "span."
)

type SpanGroupRule struct {
	ID          string    `json:"id"`
	SpanKind    string    `json:"span_kind"`
	Identifying string    `json:"identifying"`
	Required    []string  `json:"required"`
	Recommended []string  `json:"recommended"`
	Stability   Stability `json:"stability"`
}

func (c *Catalogue) SpanGroupRules() []SpanGroupRule {
	return c.spanGroupRules
}

func spanGroupRulesOf(registry Registry) []SpanGroupRule {
	generic := map[string]SpanGroupRule{}
	for _, span := range registry.Spans {
		rule, ok := ruleFor(span)
		if !ok {
			continue
		}
		key := rule.SpanKind + "|" + namespaceOf(span.ID)
		if existing, seen := generic[key]; seen && segments(existing.ID) <= segments(rule.ID) {
			continue
		}
		generic[key] = rule
	}
	rules := make([]SpanGroupRule, 0, len(generic))
	for _, rule := range generic {
		rules = append(rules, rule)
	}
	slices.SortFunc(rules, func(a, b SpanGroupRule) int { return strings.Compare(a.ID, b.ID) })
	return rules
}

func ruleFor(span Span) (SpanGroupRule, bool) {
	if span.Deprecated != nil || span.SpanKind == "" {
		return SpanGroupRule{}, false
	}
	namespace := namespaceOf(span.ID)
	rule := SpanGroupRule{ID: span.ID, SpanKind: span.SpanKind, Stability: span.Stability}
	for _, ref := range span.Attributes {
		switch ref.RequirementLevel.Level {
		case levelRequired:
			rule.Required = append(rule.Required, ref.Name)
			if rule.Identifying == "" && strings.HasPrefix(ref.Name, namespace+".") {
				rule.Identifying = ref.Name
			}
		case levelRecommended:
			rule.Recommended = append(rule.Recommended, ref.Name)
		}
	}
	return rule, rule.Identifying != ""
}

func namespaceOf(spanID string) string {
	namespace, _, _ := strings.Cut(strings.TrimPrefix(spanID, spanGroupPrefix), ".")
	return namespace
}

func segments(spanID string) int {
	return strings.Count(spanID, ".")
}
