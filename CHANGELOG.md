# Changelog

## 0.1.0 (2026-10-19)

First release. GROT Weaver scores how well the telemetry in your stack follows the OpenTelemetry semantic conventions and shows, service by service, where to fix it.

### Scanning

- Reads metric names and label keys from Prometheus and Mimir, span and resource attribute keys from Tempo, and stream labels and structured metadata from Loki, as the signed-in user and read-only.
- Detects how each Prometheus datasource stores OpenTelemetry names (translation strategy), with an override per datasource in the settings.
- Picks the time range from the time picker, with a configurable default, and keeps Tempo searches within Tempo's maximum search range.
- Shows scores as each datasource answers, says which checks were limited and why, and keeps your last full scan in your browser for seven days so the page opens on it while a fresh scan runs.
- Handles large stacks with bounded queries: up to 5,000 services per Tempo or Loki datasource and 100,000 metric names per Prometheus datasource. A datasource over its limit is skipped and named in the scan status. Once a scan has collected more than 1,000 services, scores appear when it finishes instead of as each datasource answers.

### Scoring

- Checks names against the bundled semantic conventions registry v1.44.0, the GenAI semantic conventions (bundled from the semantic-conventions-genai repository at a fixed commit), and the rename history between versions. Optionally checks GitHub once a day and says when a newer semantic conventions release exists.
- Finds deprecated names, unit mismatches, names unknown inside a semantic convention namespace, missing required attributes, attributes at the wrong scope, and missing or SDK-default service names. On sampled spans it also checks span groups for missing recommended attributes.
- Scores naming per stability level (Stable, Release candidate, Experimental), requirements, resource identity and coverage per signal, each with what it was counted from. Volume weighting is optional.
- Checks your own required resource attributes per service and signal, separately from semantic convention conformance.
- Shows readiness for Knowledge Graph and Application Observability per service and signal, with the attributes that are missing.

### From finding to fix

- Overview with scores per signal, top violations across services, and services ranked worst first.
- Service page with each finding's level and impact, and a link to its evidence in Explore where a query can be built for it.
- Fix options for each finding: the instrumentation library or SDK to upgrade or configure, when it can be identified; an OpenTelemetry Collector or Grafana Alloy rule for names that can be renamed safely; and a summary to raise with the service owner.
- Pipeline hop candidates: the collector or Alloy pipelines a service's telemetry may pass through, ranked from your configured mappings and clues in the telemetry, for you to confirm.

### Grafana Assistant

- Where the Grafana Assistant app is installed, Ask Assistant on a finding or top violation opens the Assistant with a prompt about that finding, for example to find the dashboards, alert rules and recording rules that use an old name.
- On the overview and service pages, the Assistant receives a summary of the page so you can ask what to fix first. An admin can turn the integration off.

### Requirements

- Grafana 13.2.0 or later.
- At least one Prometheus, Tempo or Loki datasource. Other datasource plugin types can be added per signal in the settings.
