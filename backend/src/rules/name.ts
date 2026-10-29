// Name matching exactly as spec 6.1 defines it.

/**
 * Upper case; "." and "-" become spaces; every character other than A-Z and space is removed; title
 * tokens are dropped; spaces collapse; tokens are sorted alphabetically and joined by one space.
 */
export function normaliseName(name: string, titleTokens: readonly string[]): string {
  const titles = new Set(titleTokens.map((t) => t.toUpperCase()));
  return name
    .toUpperCase()
    .replace(/[.-]/g, ' ')
    .replace(/[^A-Z ]/g, '')
    .split(' ')
    .filter((token) => token !== '' && !titles.has(token))
    .sort()
    .join(' ');
}

/** Minimum number of single-character insertions, deletions or substitutions (two-row dynamic programme). */
export function levenshtein(a: string, b: string): number {
  let previous = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(
        (previous[j] as number) + 1,
        (current[j - 1] as number) + 1,
        (previous[j - 1] as number) + cost,
      );
    }
    previous = current;
  }
  return previous[b.length] as number;
}

/** 1 - distance / length of the longer normalised string; 1.0 when both are empty. Not rounded. */
export function nameSimilarity(a: string, b: string, titleTokens: readonly string[]): number {
  const x = normaliseName(a, titleTokens);
  const y = normaliseName(b, titleTokens);
  const longer = Math.max(x.length, y.length);
  return longer === 0 ? 1 : 1 - levenshtein(x, y) / longer;
}

/** Rounds to 4 decimals for output only (never used for comparisons). */
export const roundScore = (score: number): number => Math.round(score * 10_000) / 10_000;
export const formatScore = (score: number | null): string =>
  score === null ? '' : score.toFixed(4);

// Similarity is computed in floating point; compare with a tiny tolerance so that a score which is
// exactly 0.90 on paper (for example 1 - 3/30) is not lost to representation error.
const EPSILON = 1e-12;
export const atLeast = (value: number, threshold: number): boolean => value >= threshold - EPSILON;
export const below = (value: number, threshold: number): boolean => !atLeast(value, threshold);
