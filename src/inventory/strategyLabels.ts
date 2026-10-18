import { TranslationStrategy } from './types';

export interface StrategyLabel {
  label: string;
  example: string;
}

export const STRATEGY_LABELS: Record<TranslationStrategy, StrategyLabel> = {
  UnderscoreEscapingWithSuffixes: {
    label: 'underscores, with unit suffixes',
    example: 'http.server.request.duration is stored as http_server_request_duration_seconds',
  },
  UnderscoreEscapingWithoutSuffixes: {
    label: 'underscores, no unit suffixes',
    example: 'http.server.request.duration is stored as http_server_request_duration',
  },
  NoUTF8EscapingWithSuffixes: {
    label: 'dots kept, with unit suffixes',
    example: 'http.server.request.duration is stored as http.server.request.duration_seconds',
  },
  NoTranslation: {
    label: 'names as sent',
    example: 'http.server.request.duration is stored unchanged',
  },
};

export function strategyLabel(strategy: string): string {
  return STRATEGY_LABELS[strategy as TranslationStrategy]?.label ?? strategy;
}

export function strategyExample(strategy: string): string | undefined {
  return STRATEGY_LABELS[strategy as TranslationStrategy]?.example;
}
