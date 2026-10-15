package product

import "github.com/iambenzo/otel-semconv-compliance/pkg/finding"

const (
	kgDocs = "https://grafana.com/docs/grafana-cloud/platform/knowledge-graph/"
	aoDocs = "https://grafana.com/docs/grafana-cloud/observe-and-act/monitor-applications/application-observability/"

	kgApplicationMetrics = kgDocs + "get-started/manage-datasets/application/application-metrics/"
	kgPrerequisites      = kgDocs + "get-started/prerequisites/"
	kgInstrumentation    = kgDocs + "troubleshoot-infra-apps/explore-entity-catalog/instrumentation-quality/"
	kgLogsCorrelation    = kgDocs + "configure/telemetry-correlation/logs/"
	aoResourceAttributes = aoDocs + "setup/resource-attributes/"
	aoMetricsLabels      = aoDocs + "setup/metrics-labels/"
	aoInstrumentation    = aoDocs + "setup/instrumentation-quality/"
	aoConfigure          = aoDocs + "manual/configure/"
	aoService            = aoDocs + "manual/service/"
	otlpSendData         = "https://grafana.com/docs/grafana-cloud/send-data/otlp/send-data-otlp/"
	tempoTargetInfo      = "https://grafana.com/docs/tempo/latest/metrics-from-traces/span-metrics/span-metrics-metrics-generator/"

	environment           = "deployment.environment.name"
	deprecatedEnvironment = "deployment.environment"
)

var Products = []Product{knowledgeGraph(), applicationObservability()}

func knowledgeGraph() Product {
	requirements := []Requirement{}
	for _, signal := range []finding.Signal{finding.SignalMetrics, finding.SignalTraces} {
		requirements = append(requirements,
			required(signal, "service.name", kgApplicationMetrics),
			Requirement{Signal: signal, Attribute: environment, Alternatives: []string{deprecatedEnvironment}, Level: LevelRequired, Source: kgPrerequisites},
			recommended(signal, "service.namespace", kgApplicationMetrics),
			recommended(signal, "k8s.cluster.name", kgInstrumentation),
			recommended(signal, "k8s.namespace.name", kgInstrumentation),
			recommended(signal, "k8s.pod.name", kgInstrumentation),
			Requirement{Signal: signal, Attribute: "k8s.node.name", Alternatives: []string{"host.id"}, Level: LevelRecommended, Source: aoInstrumentation},
		)
	}
	requirements = append(requirements,
		required(finding.SignalLogs, "service.name", kgLogsCorrelation),
		recommended(finding.SignalLogs, "service.namespace", kgLogsCorrelation),
	)
	return Product{
		ID:           "knowledge-graph",
		Name:         "Knowledge Graph",
		Summary:      "Entity graph, Application Observability on the knowledge graph and the SLO wizard.",
		Requirements: requirements,
	}
}

func applicationObservability() Product {
	workloads := []string{"k8s.statefulset.name", "k8s.daemonset.name", "k8s.job.name", "k8s.cronjob.name", "k8s.replicaset.name"}
	return Product{
		ID:      "application-observability",
		Name:    "Application Observability",
		Summary: "The classic Application Observability app.",
		Requirements: []Requirement{
			required(finding.SignalTraces, "service.name", otlpSendData),
			required(finding.SignalTraces, deprecatedEnvironment, aoConfigure),
			{Signal: finding.SignalTraces, Attribute: "telemetry.sdk.name", Alternatives: []string{"telemetry.sdk.language", "telemetry.sdk.version"}, Level: LevelRequired, Source: tempoTargetInfo},
			recommended(finding.SignalTraces, "service.namespace", aoResourceAttributes),
			recommended(finding.SignalTraces, "telemetry.sdk.language", aoService),
			recommended(finding.SignalTraces, "k8s.cluster.name", aoInstrumentation),
			recommended(finding.SignalTraces, "k8s.namespace.name", aoInstrumentation),
			recommended(finding.SignalTraces, "k8s.pod.name", aoInstrumentation),
			{Signal: finding.SignalTraces, Attribute: "k8s.deployment.name", Alternatives: workloads, Level: LevelRecommended, Source: aoInstrumentation},
			required(finding.SignalMetrics, "service.name", aoMetricsLabels),
			recommended(finding.SignalMetrics, "service.namespace", aoMetricsLabels),
			recommended(finding.SignalMetrics, deprecatedEnvironment, aoMetricsLabels),
			required(finding.SignalLogs, "service.name", aoConfigure),
			recommended(finding.SignalLogs, "service.namespace", aoConfigure),
			recommended(finding.SignalLogs, deprecatedEnvironment, aoConfigure),
		},
	}
}

func required(signal finding.Signal, attribute, source string) Requirement {
	return Requirement{Signal: signal, Attribute: attribute, Level: LevelRequired, Source: source}
}

func recommended(signal finding.Signal, attribute, source string) Requirement {
	return Requirement{Signal: signal, Attribute: attribute, Level: LevelRecommended, Source: source}
}
