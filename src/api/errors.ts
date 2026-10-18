export function messageOf(error: unknown): string {
  if (!error || typeof error !== 'object') {
    return String(error);
  }
  const candidate = error as { data?: { error?: unknown; message?: unknown }; message?: unknown; status?: unknown };
  const text = [candidate.data?.error, candidate.data?.message, candidate.message].find(isNonEmptyString);
  if (text) {
    return text;
  }
  return typeof candidate.status === 'number' ? `request failed with status ${candidate.status}` : 'unknown error';
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}
