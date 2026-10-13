package catalogue

import (
	"slices"
	"testing"
)

func Test_SpanGroupRules_generatedCatalogue(t *testing.T) {
	rules := loadGenerated(t).SpanGroupRules()

	byID := map[string]SpanGroupRule{}
	for _, rule := range rules {
		byID[rule.ID] = rule
	}
	server, found := byID["span.http.server"]
	if !found || server.SpanKind != "server" || server.Identifying != "http.request.method" {
		t.Fatalf("span.http.server = %+v", server)
	}
	if !slices.Equal(server.Required, []string{"http.request.method", "url.path", "url.scheme"}) || len(server.Recommended) == 0 {
		t.Errorf("span.http.server requirements = %+v", server)
	}
	if db := byID["span.db.client"]; db.Identifying != "db.system.name" {
		t.Errorf("span.db.client = %+v", db)
	}
	for _, specialised := range []string{"span.db.redis.client", "span.db.elasticsearch.client", "span.aws.client"} {
		if _, found := byID[specialised]; found {
			t.Errorf("%s should give way to the generic group", specialised)
		}
	}
	for _, rule := range rules {
		if rule.Identifying == "" || rule.SpanKind == "" {
			t.Errorf("incomplete rule %+v", rule)
		}
	}
}

func Test_spanGroupRulesOf_prefersTheMostGenericGroup(t *testing.T) {
	required := func(name string) AttributeRef {
		return AttributeRef{Name: name, RequirementLevel: RequirementLevel{Level: levelRequired}}
	}
	registry := Registry{Spans: []Span{
		{ID: "span.db.redis.client", SpanKind: "client", Attributes: []AttributeRef{required("db.operation.name")}},
		{ID: "span.db.client", SpanKind: "client", Attributes: []AttributeRef{required("db.system.name")}},
		{ID: "span.db.old.client", SpanKind: "client", Deprecated: &Deprecation{Reason: "obsoleted"}, Attributes: []AttributeRef{required("db.system")}},
		{ID: "span.aws.client", SpanKind: "client", Attributes: []AttributeRef{required("rpc.system")}},
	}}

	rules := spanGroupRulesOf(registry)

	if len(rules) != 1 || rules[0].ID != "span.db.client" {
		t.Errorf("rules = %+v", rules)
	}
}
