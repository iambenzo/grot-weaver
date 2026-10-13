package assessment

import (
	"strings"

	"github.com/iambenzo/otel-semconv-compliance/pkg/catalogue"
	"github.com/iambenzo/otel-semconv-compliance/pkg/finding"
	"github.com/iambenzo/otel-semconv-compliance/pkg/identity"
	"github.com/iambenzo/otel-semconv-compliance/pkg/nameindex"
)

var structuralLogKeys = map[string]bool{
	"detected_level": true, "observed_timestamp": true, "flags": true,
	"severity_number": true, "severity_text": true, "trace_id": true, "span_id": true,
	"scope_name": true, "scope_version": true, "scope_dropped_attributes_count": true,
	"service_name": true, "service_namespace": true,
}

type LogAttribution struct {
	Datasource string `json:"datasource"`
	identity.Attribution
	KeysMethod LogKeysMethod `json:"keys_method"`
	OTLP       bool          `json:"otlp"`
	SDK        SDK           `json:"sdk"`
}

func (a *Assessor) assessLogService(datasource string, service LogService, into *collected) {
	resolution := identity.ResolveLogService(service.ServiceName, service.ServiceNamespace, service.OTLPMarkers, service.Volume)
	owner := resolution.Attribution.Owner
	into.logAttributions = append(into.logAttributions, LogAttribution{
		Datasource:  datasource,
		Attribution: resolution.Attribution,
		KeysMethod:  service.KeysMethod,
		OTLP:        len(service.OTLPMarkers) > 0,
		SDK:         service.SDK,
	})
	into.findings = append(into.findings, resolution.Findings...)
	into.checks = append(into.checks, resolution.Checks...)
	into.totals[finding.SignalLogs] += service.Volume

	library := logLibrary(service.ScopeNames)
	at := finding.Observation{Owner: owner, Signal: finding.SignalLogs, Volume: service.Volume}
	seen := map[string]bool{}
	for _, key := range append(append([]string{}, service.StreamLabels...), service.MetadataKeys...) {
		if seen[key] || structuralLogKeys[key] || strings.HasPrefix(key, "__") {
			continue
		}
		seen[key] = true
		classified := a.classifier.Attribute(at, a.attributes.Match(key, nameindex.Context{Scope: catalogue.ScopeLogs}), catalogue.ScopeLogs)
		classified.Library = library
		into.findings = append(into.findings, classified)
	}
}

func logLibrary(scopes []string) *finding.Library {
	if len(scopes) != 1 {
		return nil
	}
	return &finding.Library{Name: scopes[0], Evidence: "scope_name in sampled log records", Confidence: nameindex.ConfidenceMedium}
}
