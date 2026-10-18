export type ShareStatus = 'complete' | 'partial' | 'none';

export function shareStatus(share: number): ShareStatus {
  if (share >= 1) {
    return 'complete';
  }
  return share <= 0 ? 'none' : 'partial';
}

export function formatShare(share: number): string {
  const percent = Math.round(share * 100);
  if (share > 0 && percent === 0) {
    return '<1%';
  }
  if (share < 1 && percent === 100) {
    return '>99%';
  }
  return `${percent}%`;
}
