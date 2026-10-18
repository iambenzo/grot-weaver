# OTel Semconv Compliance

Scores how well your telemetry follows the [OpenTelemetry semantic conventions](https://opentelemetry.io/docs/specs/semconv/) and shows where to fix it.

The app reads the metric names, and the attribute and label keys, that your services send to Prometheus, Tempo and Loki. It checks them against the semantic conventions registry bundled with the plugin and tells you, service by service, which names are out of date, which units are wrong and which required attributes are missing.

## What it scans

- **Metrics** from Prometheus-compatible datasources: metric names, label keys and `target_info`.
- **Traces** from Tempo: span and resource attribute keys, and the instrumentation libraries that emit them.
- **Logs** from Loki: stream labels and structured metadata keys.

Every query runs through Grafana's datasource proxy as you, the signed-in user. The app only reads, never writes, and only sees the datasources you can query. Datasources you cannot see are named on the page, and the scores leave them out.

## How scores work

Each signal gets separate scores, so one weak area does not hide behind a good average:

- **Naming: Stable, Release candidate, Experimental**: the share of names in each stability bucket that use the current semantic convention name, including the forms Prometheus stores them in.
- **Requirements**: required attributes present where they could be checked.
- **Resource**: `service.name` is set and is not the SDK default.
- **Required resource attributes**: your own list from the app settings, scored separately from semantic convention conformance.
- **Coverage**: the share of volume that came from an OpenTelemetry SDK and is tied to a service.

Every score shows what it was counted from, for example "10 of 12 names". By default each name counts once per service; turn on volume weighting in the settings to count names by series, spans or log lines instead. "N/A" means there was nothing to score.

## Reading partial results

Large stacks take a while to scan, so scores appear as each datasource answers and the status panel says how far the scan has got. Your last complete scan of the same time range is kept in your browser for up to seven days, so returning to the page shows it at once while a fresh scan runs.

When a check had to be limited, for example volume sampled because TraceQL metrics are unavailable, the affected scores say "Based on limited data", and **Limited checks** in the status panel lists every limit.

## From finding to fix

1. On the **Overview**, start with **Services, worst first**, or with **Top violations**, which lists the names seen across the most services.
2. Open a service to see each finding with its level (violation, improvement or information) and its share of the signal's volume.
3. Expand a finding for its evidence in Explore, where it can be found, and the ways to fix it:
   - **Instrumentation**: which library or SDK emits the name, and how to upgrade or configure it.
   - **Pipeline rule**: for names that can be renamed safely, an OpenTelemetry Collector or Grafana Alloy processor that renames them, as a stopgap.
   - **Raise with owner**: a summary to paste into a ticket.
4. Where the [Grafana Assistant](https://grafana.com/docs/grafana-cloud/platform/grafana-assistant/) app is installed, **Ask Assistant** on a finding or a top violation opens it with a prompt about that finding, for example to find the dashboards, alert rules and recording rules that use an old name.

## Grafana Assistant

The Ask Assistant buttons appear when the Grafana Assistant app is installed. It answers on Grafana Cloud and on a self-managed Grafana connected to Grafana Cloud; on one that is not connected yet, the Assistant offers to set it up instead. The prompt opens unsent so you can edit it first. It holds the finding: its type, signal and scope, the metric, span or log attribute names as sent and as expected, the registry note, the semantic conventions version, the service and namespace, and library names and versions. On the overview it names up to ten affected services and adds the time range; on a service page it adds the datasource name and evidence query when there is one. Nothing goes to the Assistant until you send it. An admin can hide the buttons in the app settings.

## Requirements

- Grafana 13.2.0 or later.
- At least one Prometheus, Tempo or Loki datasource. Other plugin types can be added for each signal in the app settings.

## Settings

Open **Administration > Plugins and data > Plugins > OTel Semconv Compliance > Configuration** to change which datasources are scanned, the default time window, query limits, volume weighting, your custom attribute namespaces, required resource attributes and service-to-pipeline mappings. The app can also check GitHub once a day for a newer semantic conventions release; new registry versions arrive with plugin updates.
