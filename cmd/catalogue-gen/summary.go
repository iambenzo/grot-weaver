package main

import (
	"fmt"
	"slices"
	"strings"

	"github.com/iambenzo/otel-semconv-compliance/pkg/catalogue"
)

type entryState struct {
	stability  catalogue.Stability
	deprecated bool
}

type changeSet struct {
	added, removed, deprecated, restability []string
}

func summariseChanges(previous, next *catalogue.Catalogue, genAIReason string) string {
	var builder strings.Builder
	fmt.Fprintf(&builder, "## Catalogue update\n\n")
	fmt.Fprintf(&builder, "- semconv: %s → %s\n", versionOf(previous), next.Manifest.Semconv.Version)
	fmt.Fprintf(&builder, "- GenAI: %s\n\n", genAIReason)
	writeChanges(&builder, "Attributes", diff(attributeStates(previous), attributeStates(next)))
	writeChanges(&builder, "Metrics", diff(metricStates(previous), metricStates(next)))
	return builder.String()
}

func versionOf(c *catalogue.Catalogue) string {
	if c == nil || c.Manifest.Semconv.Version == "" {
		return "(none)"
	}
	return c.Manifest.Semconv.Version
}

func attributeStates(c *catalogue.Catalogue) map[string]entryState {
	states := map[string]entryState{}
	if c == nil {
		return states
	}
	for _, attribute := range c.Registry.Attributes {
		states[attribute.Name] = entryState{stability: attribute.Stability, deprecated: attribute.Deprecated != nil}
	}
	return states
}

func metricStates(c *catalogue.Catalogue) map[string]entryState {
	states := map[string]entryState{}
	if c == nil {
		return states
	}
	for _, metric := range c.Registry.Metrics {
		states[metric.Name] = entryState{stability: metric.Stability, deprecated: metric.Deprecated != nil}
	}
	return states
}

func diff(previous, next map[string]entryState) changeSet {
	var changes changeSet
	for name, state := range next {
		old, existed := previous[name]
		switch {
		case !existed:
			changes.added = append(changes.added, name)
		case state.deprecated && !old.deprecated:
			changes.deprecated = append(changes.deprecated, name)
		case state.stability != old.stability:
			changes.restability = append(changes.restability, fmt.Sprintf("%s (%s → %s)", name, old.stability, state.stability))
		}
	}
	for name := range previous {
		if _, kept := next[name]; !kept {
			changes.removed = append(changes.removed, name)
		}
	}
	for _, list := range [][]string{changes.added, changes.removed, changes.deprecated, changes.restability} {
		slices.Sort(list)
	}
	return changes
}

func writeChanges(builder *strings.Builder, title string, changes changeSet) {
	fmt.Fprintf(builder, "### %s\n\n", title)
	sections := []struct {
		label string
		names []string
	}{
		{"Added", changes.added},
		{"Removed", changes.removed},
		{"Newly deprecated", changes.deprecated},
		{"Stability changed", changes.restability},
	}
	for _, section := range sections {
		fmt.Fprintf(builder, "- %s: %d\n", section.label, len(section.names))
		for _, name := range section.names {
			fmt.Fprintf(builder, "  - `%s`\n", name)
		}
	}
	builder.WriteString("\n")
}
