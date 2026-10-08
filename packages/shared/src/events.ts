/**
 * Per-unit share for a special collection — mirrors public.event_share_paise():
 * ceil(total / expected payers), then rounded UP to the nearest multiple of `roundingPaise`.
 */
export function computeEventShare(totalPaise: number, expectedPayers: number, roundingPaise: number): number {
  if (expectedPayers < 1 || totalPaise <= 0) return 0;
  const r = Math.max(1, Math.trunc(roundingPaise));
  const raw = Math.ceil(totalPaise / expectedPayers);
  return Math.ceil(raw / r) * r;
}

export interface EventSplitSummary {
  inScope: number;
  expected: number;
  sharePaise: number;
  collectionPaise: number;
  roundingBufferPaise: number;
}

export function summariseEventSplit(
  totalPaise: number,
  inScope: number,
  excluded: number,
  roundingPaise: number,
): EventSplitSummary {
  const expected = Math.max(0, inScope - excluded);
  const sharePaise = computeEventShare(totalPaise, expected, roundingPaise);
  const collectionPaise = sharePaise * expected;
  return {
    inScope,
    expected,
    sharePaise,
    collectionPaise,
    roundingBufferPaise: Math.max(0, collectionPaise - totalPaise),
  };
}
