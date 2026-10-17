import { CollectionError } from './types';

export const MAX_METRIC_NAMES = 100000;
export const MAX_OWNERS_PER_SOURCE = 200000;
export const MAX_TARGET_INFO_SERIES = 50000;
export const MAX_TRACE_SERVICES = 5000;
export const MAX_LOG_SERVICES = 5000;

export function limitError(
  datasource: string,
  step: string,
  count: number,
  max: number,
  consequence: string
): CollectionError {
  return {
    datasource,
    step,
    message: `${count} found, over the ${max} the scorer accepts, so ${consequence}`,
  };
}
