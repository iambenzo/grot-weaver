package identity

import (
	"github.com/iambenzo/otel-semconv-compliance/pkg/finding"
	"github.com/iambenzo/otel-semconv-compliance/pkg/nameindex"
	"github.com/iambenzo/otel-semconv-compliance/pkg/scoring"
)

const (
	SourceLogServiceNameOTLP    Source = "service_name with OTLP markers"
	SourceLogServiceNameDerived Source = "service_name, origin not OTLP; identity may be derived"
	SourceLokiFallback          Source = "Loki unknown_service fallback"
)

func ResolveLogService(serviceName, serviceNamespace string, otlpMarkers []string, volume float64) Resolution {
	if serviceName == "" || serviceName == sdkDefaultPrefix {
		owner := finding.Owner{Kind: finding.OwnerUnattributed, Name: unattributedName}
		source := SourceNone
		if serviceName == sdkDefaultPrefix {
			source = SourceLokiFallback
		}
		return Resolution{
			Attribution: Attribution{Owner: owner, Source: source, Confidence: nameindex.ConfidenceMedium},
			Findings:    []finding.Finding{logIdentityFinding(owner, finding.TypeMissingServiceName, serviceName, nameindex.ConfidenceMedium, volume)},
			Checks:      []scoring.ResourceCheck{logCheck(owner, CheckServiceNamePresent, false)},
		}
	}

	owner := finding.Owner{Kind: finding.OwnerService, Namespace: serviceNamespace, Name: serviceName}
	attribution := Attribution{Owner: owner, Source: SourceLogServiceNameOTLP, Confidence: nameindex.ConfidenceHigh}
	if len(otlpMarkers) == 0 {
		attribution = Attribution{Owner: owner, Source: SourceLogServiceNameDerived, Confidence: nameindex.ConfidenceLow}
	}
	resolution := Resolution{
		Attribution: attribution,
		Checks:      []scoring.ResourceCheck{logCheck(owner, CheckServiceNamePresent, true)},
	}
	isDefault := IsSDKDefaultServiceName(serviceName)
	resolution.Checks = append(resolution.Checks, logCheck(owner, CheckServiceNameNotDefault, !isDefault))
	if isDefault {
		resolution.Findings = []finding.Finding{logIdentityFinding(owner, finding.TypeSDKDefaultServiceName, serviceName, nameindex.ConfidenceHigh, volume)}
	}
	return resolution
}

func logIdentityFinding(owner finding.Owner, t finding.Type, observed string, confidence nameindex.Confidence, volume float64) finding.Finding {
	return finding.Finding{
		Type:       t,
		Level:      finding.LevelOf(t),
		Signal:     finding.SignalLogs,
		Owner:      owner,
		Observed:   observed,
		Expected:   "service.name",
		Confidence: confidence,
		Volume:     volume,
	}
}

func logCheck(owner finding.Owner, name string, passed bool) scoring.ResourceCheck {
	return scoring.ResourceCheck{Owner: owner, Signal: finding.SignalLogs, Name: name, Passed: passed}
}
