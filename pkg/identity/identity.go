package identity

import (
	"strings"

	"github.com/iambenzo/otel-semconv-compliance/pkg/finding"
	"github.com/iambenzo/otel-semconv-compliance/pkg/nameindex"
	"github.com/iambenzo/otel-semconv-compliance/pkg/scoring"
)

const (
	sdkDefaultPrefix           = "unknown_service"
	CheckServiceNamePresent    = "service.name present"
	CheckServiceNameNotDefault = "service.name is not the SDK default"
	unattributedName           = "unattributed"
)

type Source string

const (
	SourceServiceNameAttribute Source = "resource.service.name"
	SourceNone                 Source = "none"
)

type Attribution struct {
	Owner      finding.Owner        `json:"owner"`
	Source     Source               `json:"source"`
	Confidence nameindex.Confidence `json:"confidence"`
}

type Resolution struct {
	Attribution Attribution
	Findings    []finding.Finding
	Checks      []scoring.ResourceCheck
}

func ResolveTraceService(serviceName, serviceNamespace string, volume float64) Resolution {
	if serviceName == "" {
		owner := finding.Owner{Kind: finding.OwnerUnattributed, Name: unattributedName}
		return Resolution{
			Attribution: Attribution{Owner: owner, Source: SourceNone, Confidence: nameindex.ConfidenceHigh},
			Findings:    []finding.Finding{identityFinding(owner, finding.TypeMissingServiceName, "", volume)},
			Checks:      []scoring.ResourceCheck{check(owner, CheckServiceNamePresent, false)},
		}
	}

	owner := finding.Owner{Kind: finding.OwnerService, Namespace: serviceNamespace, Name: serviceName}
	resolution := Resolution{
		Attribution: Attribution{Owner: owner, Source: SourceServiceNameAttribute, Confidence: nameindex.ConfidenceHigh},
		Checks:      []scoring.ResourceCheck{check(owner, CheckServiceNamePresent, true)},
	}
	isDefault := IsSDKDefaultServiceName(serviceName)
	resolution.Checks = append(resolution.Checks, check(owner, CheckServiceNameNotDefault, !isDefault))
	if isDefault {
		resolution.Findings = append(resolution.Findings, identityFinding(owner, finding.TypeSDKDefaultServiceName, serviceName, volume))
	}
	return resolution
}

func IsSDKDefaultServiceName(serviceName string) bool {
	return serviceName == sdkDefaultPrefix || strings.HasPrefix(serviceName, sdkDefaultPrefix+":")
}

func identityFinding(owner finding.Owner, t finding.Type, observed string, volume float64) finding.Finding {
	return finding.Finding{
		Type:       t,
		Level:      finding.LevelOf(t),
		Signal:     finding.SignalTraces,
		Owner:      owner,
		Observed:   observed,
		Expected:   "service.name",
		Confidence: nameindex.ConfidenceHigh,
		Volume:     volume,
	}
}

func check(owner finding.Owner, name string, passed bool) scoring.ResourceCheck {
	return scoring.ResourceCheck{Owner: owner, Signal: finding.SignalTraces, Name: name, Passed: passed}
}
