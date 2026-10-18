export interface GuideItem {
  term?: string;
  meaning: string;
}

export const SIGNAL_TILES_HELP: GuideItem[] = [
  {
    term: 'Naming',
    meaning:
      'Share of names in each stability bucket that use the current semconv name. Each name counts once per service, or by its volume when volume weighting is on, as the page header says. N/A means none from that bucket were seen, or, with volume weighting, none had measured volume.',
  },
  { term: 'Requirements', meaning: 'Attributes semconv marks as required, present where they could be checked.' },
  { term: 'Resource', meaning: 'service.name is set and is not the SDK default.' },
  {
    term: 'Required resource attributes',
    meaning: 'Your list from the plugin settings, per service. Scored on its own, not part of the semconv scores.',
  },
  { term: 'Coverage', meaning: 'Share of volume that came from an OTel SDK and is tied to a service.' },
  { meaning: 'The line under each score shows what it was counted from, or why there is nothing to score.' },
  {
    term: 'Status',
    meaning:
      'All pass (green) is 100%, Some fail (orange) is between 0% and 100%, None pass (red) is 0%. Coverage and the counts are context, so they have no status.',
  },
];

export const TOP_VIOLATIONS_HELP: GuideItem[] = [
  { meaning: 'Violations seen across the most services come first, so one fix in a shared library helps most.' },
  { meaning: 'Expand a row to open each affected service on this signal.' },
];

export const SERVICES_HELP: GuideItem[] = [
  { meaning: 'Lowest naming score first. Open a service to see its findings and how to fix them.' },
  {
    term: 'Lowest naming score',
    meaning: 'The lowest of the service’s stable, release-candidate and experimental naming scores across all signals.',
  },
  { term: 'Violations', meaning: 'Findings at violation level for the service, across all signals.' },
  {
    term: 'Required resource attributes',
    meaning:
      'The share of your required resource attributes found, of those that could be checked. Kept out of the score.',
  },
  {
    term: 'Metrics, Traces, Logs: stable naming',
    meaning: 'The share of that signal’s stable names that are current.',
  },
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
    term: 'Counts',
    meaning:
      'The line under each share says how many needed attributes are present out of those checked. Attributes that could not be checked are left out of the share and counted separately; if none are missing but some could not be checked, the share shows Not checkable instead of 100%.',
  },
  {
    term: 'Overall',
    meaning: 'All needed attributes across every assessed signal this service sends, added together.',
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
    meaning:
      'Violations need fixing, improvements are recommended, information is context. Rows sort by level, then impact.',
  },
  {
    term: 'Impact',
    meaning:
      "The volume this finding applies to, such as the series of the affected metric or the service's spans, as a share of all of this signal's volume in the scan. 0% means that volume was zero or could not be measured.",
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
