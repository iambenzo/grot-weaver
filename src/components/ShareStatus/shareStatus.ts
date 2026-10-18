export type ShareStatus = 'complete' | 'partial' | 'none';

export function shareStatus(share: number): ShareStatus {
  if (share >= 1) {
    return 'complete';
  }
  return share <= 0 ? 'none' : 'partial';
}
