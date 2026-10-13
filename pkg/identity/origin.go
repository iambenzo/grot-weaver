package identity

import (
	"strings"

	"github.com/iambenzo/otel-semconv-compliance/pkg/nameindex"
)

type Origin string

const (
	OriginSDK              Origin = "sdk"
	OriginCollectorScraped Origin = "collector_scraped"
	OriginNonOTel          Origin = "non_otel"
)

const (
	sdkLabelPrefix         = "telemetry_sdk_"
	prometheusReceiverPath = "/receiver/prometheusreceiver"
	ScopeNameLabel         = "otel_scope_name"
	ScopeVersionLabel      = "otel_scope_version"
)

var structuralTargetLabels = map[string]bool{"job": true, "instance": true}

var scrapeTargetLabels = map[string]bool{
	"server_address": true,
	"server_port":    true,
	"url_scheme":     true,
	"net_host_name":  true,
	"net_host_port":  true,
	"http_scheme":    true,
}

type OriginClassification struct {
	Origin     Origin               `json:"origin"`
	Confidence nameindex.Confidence `json:"confidence"`
	Reason     string               `json:"reason"`
}

func ClassifyOrigin(targetInfo map[string]string, found bool, scopeName string) OriginClassification {
	if strings.HasSuffix(scopeName, prometheusReceiverPath) {
		return OriginClassification{Origin: OriginCollectorScraped, Confidence: nameindex.ConfidenceHigh, Reason: "series carry the collector prometheus receiver scope"}
	}
	if !found {
		return OriginClassification{Origin: OriginNonOTel, Confidence: nameindex.ConfidenceMedium, Reason: "no target_info for this job or instance"}
	}
	if HasSDKLabels(targetInfo) {
		return OriginClassification{Origin: OriginSDK, Confidence: nameindex.ConfidenceHigh, Reason: "target_info carries telemetry_sdk_* labels"}
	}
	if onlyScrapeTargetLabels(targetInfo) {
		return OriginClassification{Origin: OriginCollectorScraped, Confidence: nameindex.ConfidenceMedium, Reason: "target_info carries only scrape-target labels"}
	}
	return OriginClassification{Origin: OriginSDK, Confidence: nameindex.ConfidenceMedium, Reason: "target_info carries resource attributes but no telemetry_sdk_* labels"}
}

func HasSDKLabels(labels map[string]string) bool {
	for key := range labels {
		if strings.HasPrefix(key, sdkLabelPrefix) {
			return true
		}
	}
	return false
}

func ScrapeTargetLabels(labels map[string]string) []string {
	var keys []string
	for key := range labels {
		if scrapeTargetLabels[key] {
			keys = append(keys, key)
		}
	}
	return keys
}

func onlyScrapeTargetLabels(labels map[string]string) bool {
	scrape := 0
	for key := range labels {
		switch {
		case structuralTargetLabels[key]:
		case scrapeTargetLabels[key]:
			scrape++
		default:
			return false
		}
	}
	return scrape > 0
}
