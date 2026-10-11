/** Presentation-only thresholds approved 2026-10-11. Does not change scoring. */
export const STAR_THRESHOLDS = [0.20, 0.35, 0.50, 0.65, 0.85] as const;

export function starRating(accuracy: number | null, completed: boolean, seeked: boolean): number | null {
  if (!completed || seeked || accuracy === null || !Number.isFinite(accuracy) || accuracy < 0 || accuracy > 1) return null;
  return STAR_THRESHOLDS.filter(threshold => accuracy >= threshold).length;
}
