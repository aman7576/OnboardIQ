// Sanctions and PEP screening (spec 6.1). The declared full_name is compared with each entry's name
// and alias using the same normalisation and similarity as the identity check.
//   MATCH    similarity >= match threshold and the entry dob is empty or equal to the declared dob
//   POSSIBLE similarity >= match threshold with a different dob, or similarity from the possible
//            threshold up to (not including) the match threshold
import { atLeast, nameSimilarity } from './name.js';
import type { EngineConfig, Screening, ScreeningHit, WatchlistEntry } from './types.js';

export function screen(
  declaredName: string,
  declaredDob: string,
  entries: readonly WatchlistEntry[],
  config: EngineConfig,
): Screening {
  const hits: ScreeningHit[] = [];
  for (const entry of entries) {
    const candidates = [
      { on: 'name' as const, text: entry.name },
      ...(entry.alias ? [{ on: 'alias' as const, text: entry.alias }] : []),
    ];
    const best = candidates
      .map((c) => ({
        ...c,
        similarity: nameSimilarity(declaredName, c.text, config.name_title_tokens),
      }))
      .reduce((a, b) => (b.similarity > a.similarity ? b : a));

    const strong = atLeast(best.similarity, config.watchlist_match_threshold);
    if (!strong && !atLeast(best.similarity, config.watchlist_possible_threshold)) continue;
    const dobEqual = entry.dob === null ? null : entry.dob === declaredDob;
    hits.push({
      entryId: entry.id,
      matchedOn: best.on,
      matchedText: best.text,
      similarity: best.similarity,
      entryDob: entry.dob,
      declaredDob,
      dobEqual,
      result: strong && dobEqual !== false ? 'MATCH' : 'POSSIBLE',
    });
  }
  const result = hits.some((h) => h.result === 'MATCH')
    ? 'MATCH'
    : hits.length > 0
      ? 'POSSIBLE'
      : 'NONE';
  return { result, hits };
}
