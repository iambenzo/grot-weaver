import { GuideItem } from './PageGuide';

export const OVERVIEW_GUIDE: GuideItem[] = [
  {
    term: 'Naming tiles',
    meaning:
      'The share of distinct names in each stability bucket that use the current semconv name. Deprecated or near-miss names lower it. N/A means no names from that bucket were seen.',
  },
  {
    term: 'Requirements and Resource',
    meaning:
      'Requirements: attributes semconv marks as required, where they could be checked. Resource: service.name is set and is not the SDK default.',
  },
  {
    term: 'Required resource attributes',
    meaning:
      'Your own list from the plugin settings, checked per service and signal. It is scored on its own and does not change the semconv scores.',
  },
  {
    term: 'Coverage',
    meaning: 'The share of telemetry volume that came from an OTel SDK and could be tied to a service.',
  },
  {
    term: 'Top violations and services',
    meaning:
      'Violations seen across the most services come first. The services table lists the lowest naming score first; open a service to see its findings and fixes.',
  },
  {
    term: 'Pipelines, Sources and Unattributed',
    meaning:
      'Telemetry no service owns: names added by a collector or Alloy, non-OTel or scraped sources, and telemetry with no service.name. Fix these in the pipeline, not in the service.',
  },
];

export const SERVICE_GUIDE: GuideItem[] = [
  {
    term: 'Required resource attributes',
    meaning:
      'Present, Missing or Not checkable for each attribute on each signal. Not checkable means the data needed to judge it was not collected, for example no target_info for metrics.',
  },
  {
    term: 'Findings',
    meaning:
      'One row per name that differs from semconv, on the selected signal. Violations need fixing, improvements are recommended, information is for context. Confidence says how sure the match is.',
  },
  {
    term: 'Fixing',
    meaning:
      'Expand a row for an Explore link to the evidence and three fixes: change the instrumentation, add a pipeline rule as a stopgap, or copy a summary to send to the owner.',
  },
  {
    term: 'Candidate pipeline hops',
    meaning: 'The collectors or Alloy pipelines most likely to carry this service, to place a pipeline rule.',
  },
];

export const SETTINGS_GUIDE: GuideItem[] = [
  {
    term: 'Datasources',
    meaning: 'Which datasource types are read for each signal, and which datasources are never queried.',
  },
  {
    term: 'Scoring',
    meaning: 'Volume weighting, your custom namespaces, and the required resource attributes checked on every service.',
  },
  {
    term: 'Applying changes',
    meaning: 'Saved settings apply the next time the Overview or Service page loads.',
  },
];
