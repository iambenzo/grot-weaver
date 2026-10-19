package nameindex

import (
	"slices"
	"strings"

	"github.com/prometheus/otlptranslator"

	"github.com/iambenzo/grot-weaver/pkg/catalogue"
)

type Confidence string

const (
	ConfidenceHigh   Confidence = "high"
	ConfidenceMedium Confidence = "medium"
	ConfidenceLow    Confidence = "low"
)

type Form string

const (
	FormDotted     Form = "dotted"
	FormUnderscore Form = "underscore"
)

type Classification string

const (
	ClassMatched       Classification = "matched"
	ClassNotInRegistry Classification = "not_in_registry"
	ClassCustom        Classification = "custom"
)

type AttributeMatch struct {
	Observed       string                `json:"observed"`
	Classification Classification        `json:"classification"`
	Form           Form                  `json:"form,omitempty"`
	ViaTemplate    bool                  `json:"via_template,omitempty"`
	Attribute      *catalogue.Attribute  `json:"attribute,omitempty"`
	Alternatives   []catalogue.Attribute `json:"alternatives,omitempty"`
	Confidence     Confidence            `json:"confidence,omitempty"`
}

type templatePrefix struct {
	prefix    string
	form      Form
	attribute catalogue.Attribute
}

type Context struct {
	Scope  catalogue.RenameScope
	Metric string
}

type AttributeIndex struct {
	catalogue     *catalogue.Catalogue
	byForm        map[string][]catalogue.Attribute
	scopedHistory map[string][]string
	templates     []templatePrefix
	namespaces    []string
	customRoots   []string
}

const templateTypePrefix = "template["

var (
	collapsingNamer  = otlptranslator.LabelNamer{}
	preservingNamer  = otlptranslator.LabelNamer{PreserveMultipleUnderscores: true}
	underscoreNamers = []otlptranslator.LabelNamer{collapsingNamer, preservingNamer}
)

func NewAttributeIndex(c *catalogue.Catalogue, customNamespaces []string) *AttributeIndex {
	index := &AttributeIndex{catalogue: c, byForm: map[string][]catalogue.Attribute{}, scopedHistory: map[string][]string{}}
	for _, attribute := range c.Registry.Attributes {
		if !strings.Contains(attribute.Name, ".") {
			index.addContextual(attribute.Name)
			continue
		}
		index.add(attribute)
	}
	index.addHistory()
	slices.SortFunc(index.templates, func(a, b templatePrefix) int { return len(b.prefix) - len(a.prefix) })
	slices.Sort(index.namespaces)
	index.namespaces = slices.Compact(index.namespaces)
	for _, namespace := range customNamespaces {
		index.customRoots = append(index.customRoots, spellings(namespace)...)
	}
	return index
}

func (i *AttributeIndex) addHistory() {
	for _, rename := range i.catalogue.Renames.Attributes {
		if i.indexed(rename.From) {
			continue
		}
		if rename.Scope == catalogue.ScopeAll {
			if historic, found := i.catalogue.Attribute(rename.From, catalogue.ScopeAll, ""); found {
				i.add(historic)
			}
			continue
		}
		i.addContextual(rename.From)
	}
}

func (i *AttributeIndex) addContextual(name string) {
	for _, form := range spellings(name) {
		if !slices.Contains(i.scopedHistory[form], name) {
			i.scopedHistory[form] = append(i.scopedHistory[form], name)
		}
	}
}

func (i *AttributeIndex) indexed(name string) bool {
	return slices.ContainsFunc(i.byForm[name], func(a catalogue.Attribute) bool { return a.Name == name })
}

func (i *AttributeIndex) add(attribute catalogue.Attribute) {
	if namespace, _, found := strings.Cut(attribute.Name, "."); found {
		i.namespaces = append(i.namespaces, spellings(namespace)...)
	}
	if strings.HasPrefix(attribute.Type, templateTypePrefix) {
		i.templates = append(i.templates, templatePrefix{prefix: attribute.Name + ".", form: FormDotted, attribute: attribute})
		for _, underscore := range underscoreForms(attribute.Name) {
			i.templates = append(i.templates, templatePrefix{prefix: underscore + "_", form: FormUnderscore, attribute: attribute})
		}
	}
	for _, form := range spellings(attribute.Name) {
		if !slices.ContainsFunc(i.byForm[form], func(existing catalogue.Attribute) bool { return existing.Name == attribute.Name }) {
			i.byForm[form] = append(i.byForm[form], attribute)
		}
	}
}

func (i *AttributeIndex) Match(observed string, in Context) AttributeMatch {
	if candidates, found := i.byForm[observed]; found {
		return chooseCandidate(observed, candidates)
	}
	if historic := i.scopedHistoryMatches(observed, in); len(historic) > 0 {
		return chooseCandidate(observed, historic)
	}
	for _, template := range i.templates {
		if strings.HasPrefix(observed, template.prefix) && len(observed) > len(template.prefix) {
			attribute := template.attribute
			return AttributeMatch{Observed: observed, Classification: ClassMatched, Form: template.form, ViaTemplate: true, Attribute: &attribute, Confidence: ConfidenceHigh}
		}
	}
	if hasAnyRoot(observed, i.customRoots) || !hasAnyRoot(observed, i.namespaces) {
		return AttributeMatch{Observed: observed, Classification: ClassCustom}
	}
	return AttributeMatch{Observed: observed, Classification: ClassNotInRegistry, Form: formOf(observed)}
}

func (i *AttributeIndex) scopedHistoryMatches(observed string, in Context) []catalogue.Attribute {
	var matches []catalogue.Attribute
	for _, name := range i.scopedHistory[observed] {
		if _, applies := i.catalogue.Renames.ResolveAttribute(name, in.Scope, in.Metric); !applies {
			continue
		}
		if historic, found := i.catalogue.Attribute(name, in.Scope, in.Metric); found {
			matches = append(matches, historic)
		}
	}
	return matches
}

func chooseCandidate(observed string, candidates []catalogue.Attribute) AttributeMatch {
	ordered, confidence := rankCandidates(candidates, func(a catalogue.Attribute) bool { return a.Deprecated == nil })
	chosen := ordered[0]
	form := FormUnderscore
	if observed == chosen.Name {
		form = FormDotted
	}
	return AttributeMatch{
		Observed:       observed,
		Classification: ClassMatched,
		Form:           form,
		Attribute:      &chosen,
		Alternatives:   ordered[1:],
		Confidence:     confidence,
	}
}

func spellings(name string) []string {
	return append([]string{name}, underscoreForms(name)...)
}

func underscoreForms(name string) []string {
	var forms []string
	for _, namer := range underscoreNamers {
		form, err := namer.Build(name)
		if err != nil || form == name || slices.Contains(forms, form) {
			continue
		}
		forms = append(forms, form)
	}
	return forms
}

func formOf(observed string) Form {
	if strings.Contains(observed, ".") {
		return FormDotted
	}
	return FormUnderscore
}

func hasAnyRoot(observed string, roots []string) bool {
	return slices.ContainsFunc(roots, func(root string) bool {
		return strings.HasPrefix(observed, root+".") || strings.HasPrefix(observed, root+"_")
	})
}
