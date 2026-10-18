import { TranslationStrategy } from './types';

export interface StrategyLabel {
  label: string;
  example: string;
}

export const STRATEGY_LABELS: Record<TranslationStrategy, StrategyLabel> = {
  UnderscoreEscapingWithSuffixes: {
    label: 'underscores, with unit and type suffixes',
    example: 'http.server.request.duration becomes http_server_request_duration_seconds, and counters also get _total',
  },
  UnderscoreEscapingWithoutSuffixes: {
    label: 'underscores, no suffixes',
    example: 'http.server.request.duration becomes http_server_request_duration',
  },
  NoUTF8EscapingWithSuffixes: {
    label: 'dots kept, with unit and type suffixes',
    example: 'http.server.request.duration becomes http.server.request.duration_seconds, and counters also get _total',
  },
  NoTranslation: {
    label: 'names as sent',
    example: 'http.server.request.duration keeps its name, with no suffixes added',
  },
};

export function strategyLabel(strategy: string): string {
  return STRATEGY_LABELS[strategy as TranslationStrategy]?.label ?? strategy;
}

export function strategyExample(strategy: string): string | undefined {
  return STRATEGY_LABELS[strategy as TranslationStrategy]?.example;
}
