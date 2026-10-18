export interface GuideItem {
  term?: string;
  meaning: string;
}

export const SIGNAL_TILES_HELP: GuideItem[] = [
  {
    term: 'Naming',
    meaning:
      'Share of names in each stability bucket that use the current semconv name. Each name counts once, or by volume when volume weighting is on, as the page header says. N/A means none from that bucket were seen.',
  },
  { term: 'Requirements', meaning: 'Attributes semconv marks as required, present where they could be checked.' },
  { term: 'Resource', meaning: 'service.name is set and is not the SDK default.' },
  {
    term: 'Required resource attributes',
    meaning: 'Your list from the plugin settings, per service. Scored on its own, not part of the semconv scores.',
  },
  { term: 'Coverage', meaning: 'Share of volume that came from an OTel SDK and is tied to a service.' },
  { meaning: 'The line under each score shows what it was counted from, or why there is nothing to score.' },
];

export const TOP_VIOLATIONS_HELP: GuideItem[] = [
  { meaning: 'Violations seen across the most services come first, so one fix in a shared library helps most.' },
];

export const SERVICES_HELP: GuideItem[] = [
  { meaning: 'Lowest naming score first. Open a service to see its findings and how to fix them.' },
  { term: 'Metrics, Traces, Logs', meaning: 'The share of that signal using stable semconv names.' },
  { term: 'Required attributes', meaning: 'The share of required resource attributes found, kept out of the score.' },
  {
    meaning:
      'Pipelines, Sources and Unattributed below hold telemetry no service owns. Fix those in the collector, Alloy or scrape config.',
  },
];

export const RESOURCE_ATTRIBUTES_HELP: GuideItem[] = [
  { meaning: 'Your required list from the plugin settings, checked on each signal this service sends.' },
  {
    term: 'Not checkable',
    meaning: 'The data needed to judge it was not collected, for example no target_info series for metrics.',
  },
];

export const PRODUCT_READINESS_HELP: GuideItem[] = [
  {
    meaning:
      'Share of the attributes each Grafana Cloud product needs that this service sends, per signal. Kept out of every score.',
  },
  {
    term: 'Also unlocks',
    meaning: 'Recommended attributes that turn on extra features, such as linking to Kubernetes.',
  },
  {
    term: 'Not checkable',
    meaning:
      'Shown when nothing is missing but some needed attributes could not be judged from what was collected, for example no target_info series.',
  },
  { term: 'N/A', meaning: 'The product needs nothing from this signal, or the service does not send it.' },
  {
    term: 'Knowledge Graph',
    meaning:
      'Checked against the rules for new stacks. Older stacks may use k8s.cluster.name as the environment instead.',
  },
  {
    term: 'Application Observability',
    meaning:
      'The classic app filters on deployment.environment by default, so deployment.environment.name alone does not count.',
  },
];

export const FINDINGS_HELP: GuideItem[] = [
  { meaning: 'One row per name that differs from semconv on the selected signal.' },
  {
    term: 'Levels',
    meaning: 'Violations need fixing, improvements are recommended, information is context.',
  },
  {
    term: 'Fixing',
    meaning:
      'Expand a row for the evidence in Explore and three fixes: change the instrumentation, add a pipeline rule as a stopgap, or copy a summary for the owner.',
  },
];

export const HOPS_HELP: GuideItem[] = [
  {
    meaning:
      'Collectors or Alloy pipelines likely to carry this service, inferred from collector self-metrics, resource attributes and names. Use them to decide where a pipeline rule goes.',
  },
];
