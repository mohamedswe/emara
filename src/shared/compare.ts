/**
 * Deterministic ordinal comparison (UTF-16 code units), independent of locale.
 * Used wherever output order must be stable across machines.
 */
export function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
