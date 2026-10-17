import { CollectionError } from './types';

const PERMISSION_STATUSES = [401, 403];

export async function guardStep<T>(
  errors: CollectionError[],
  datasource: string,
  step: string,
  task: () => Promise<T>
): Promise<T | undefined> {
  try {
    return await task();
  } catch (error) {
    errors.push(toCollectionError(datasource, step, error));
    return undefined;
  }
}

export function toCollectionError(datasource: string, step: string, error: unknown): CollectionError {
  if (!error || typeof error !== 'object') {
    return { datasource, step, message: String(error) };
  }
  const candidate = error as { data?: unknown; message?: string; status?: number };
  const collectionError: CollectionError = { datasource, step, message: messageFrom(candidate) };
  if (typeof candidate.status === 'number') {
    collectionError.status = candidate.status;
  }
  return collectionError;
}

export function errorMessage(error: unknown): string {
  return toCollectionError('', '', error).message;
}

export function isPermissionDenied(error: CollectionError): boolean {
  return error.status !== undefined && PERMISSION_STATUSES.includes(error.status);
}

function messageFrom(candidate: { data?: unknown; message?: string; status?: number }): string {
  if (typeof candidate.data === 'string' && candidate.data) {
    return candidate.data;
  }
  const data = (candidate.data ?? {}) as { error?: unknown; message?: unknown };
  const fromData = [data.error, data.message].find((value): value is string => typeof value === 'string');
  return fromData ?? candidate.message ?? `request failed with status ${candidate.status ?? 'unknown'}`;
}
