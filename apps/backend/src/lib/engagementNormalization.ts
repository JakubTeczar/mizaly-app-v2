// Ranks scraped posts/videos against the AVERAGE for their own account rather
// than in absolute terms, so a big/old account doesn't always look "best"
// just because it has more time and reach to accumulate likes. See
// docs/ROADMAP.md discussion on Inspiracje analytics for the rationale.
//
// - dailyRate: engagement accumulated per day since posting. Posts younger
//   than MIN_MATURITY_DAYS are still growing, so they're flagged !isMature
//   and excluded from their account's median (an immature post would drag
//   the median down and make itself look artificially "average").
// - outlierRatio: dailyRate divided by the account's own median dailyRate.
//   1.0 = typical for that account, 2.0 = twice its usual pace, etc.

const MIN_MATURITY_DAYS = 3;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

// Below this many mature posts for a group, the median is too thin to trust -
// a lone post is "its own median" (ratio always 1.0x) and two or three barely
// better. Callers should treat outlierRatio as unreliable until sampleSize
// reaches this, and show something like "za mało danych" instead of a number.
export const MIN_RELIABLE_SAMPLE_SIZE = 10;

export interface NormalizedScore {
  dailyRate: number;
  isMature: boolean;
  outlierRatio: number | null;
  // How many mature posts from this item's group (e.g. same account) fed into
  // the median outlierRatio is measured against - see MIN_RELIABLE_SAMPLE_SIZE.
  sampleSize: number;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

export function computeNormalizedScores<T>(
  items: T[],
  opts: {
    getEngagement: (item: T) => number;
    getPostedAt: (item: T) => Date | null;
    getGroupKey: (item: T) => string;
    now?: Date;
  }
): Map<T, NormalizedScore> {
  const now = opts.now ?? new Date();
  const results = new Map<T, NormalizedScore>();

  const ageDaysByItem = new Map<T, number>();
  for (const item of items) {
    const postedAt = opts.getPostedAt(item);
    const ageDays = postedAt ? Math.max(1, (now.getTime() - postedAt.getTime()) / MS_PER_DAY) : MIN_MATURITY_DAYS;
    ageDaysByItem.set(item, ageDays);
  }

  const dailyRateByGroup = new Map<string, number[]>();
  for (const item of items) {
    const ageDays = ageDaysByItem.get(item)!;
    const isMature = ageDays >= MIN_MATURITY_DAYS;
    if (!isMature) continue;
    const dailyRate = opts.getEngagement(item) / ageDays;
    const groupKey = opts.getGroupKey(item);
    const list = dailyRateByGroup.get(groupKey) ?? [];
    list.push(dailyRate);
    dailyRateByGroup.set(groupKey, list);
  }

  const medianByGroup = new Map<string, number>();
  for (const [groupKey, rates] of dailyRateByGroup) {
    medianByGroup.set(groupKey, median(rates));
  }

  for (const item of items) {
    const ageDays = ageDaysByItem.get(item)!;
    const isMature = ageDays >= MIN_MATURITY_DAYS;
    const dailyRate = opts.getEngagement(item) / ageDays;
    const groupKey = opts.getGroupKey(item);
    const groupMedian = medianByGroup.get(groupKey);
    const sampleSize = dailyRateByGroup.get(groupKey)?.length ?? 0;
    const outlierRatio = isMature && groupMedian && groupMedian > 0 ? dailyRate / groupMedian : null;
    results.set(item, { dailyRate, isMature, outlierRatio, sampleSize });
  }

  return results;
}
