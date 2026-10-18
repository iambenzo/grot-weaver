export function messageOf(error: unknown): string {
  if (error && typeof error === 'object') {
    const candidate = error as { data?: { error?: string; message?: string }; message?: string };
    return candidate.data?.error ?? candidate.data?.message ?? candidate.message ?? 'unknown error';
  }
  return String(error);
}
