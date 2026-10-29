// Address repair for poor scans: split words are joined, merged words are split, and words are
// matched to a vocabulary (states and cities, plus words seen in clean development documents).
import { CITIES, SOCIETY_WORDS, STATES } from './lexicon.js';
import { asDigits } from './ocr.js';
import { collapse, editDistance } from './text.js';

const PLACES = [...STATES, ...CITIES];
const COMMON = [
  'No',
  'Road',
  'Street',
  'Society',
  'Flat',
  'House',
  'Door',
  'Plot',
  'Floor',
  'Building',
  'Lane',
  'Colony',
  'Layout',
  'Sector',
  'Block',
  'Main',
  'Cross',
  'Circle',
  'Bazaar',
  'Marg',
  'Nagar',
  'Vihar',
  'Garden',
  'Gardens',
  'Apartment',
  'Apartments',
  'Complex',
  'Villa',
  'Tower',
  'Towers',
];
const VOCAB = new Map<string, string>();
for (const w of [...COMMON, ...SOCIETY_WORDS, ...PLACES.flatMap((p) => p.split(' '))])
  VOCAB.set(w.toLowerCase(), w);

const letters = (s: string): string => s.replace(/[^A-Za-z]/g, '');

function nearest(word: string, candidates: Iterable<string>, tolerance: number): string | null {
  let best: string | null = null;
  let bestDistance = tolerance + 1;
  for (const c of candidates) {
    const d = editDistance(word.toLowerCase(), c.toLowerCase());
    if (d < bestDistance) [best, bestDistance] = [c, d];
  }
  return best;
}

const DIGIT_LOOKALIKE = /^[0-9OIlZSBGQD|]{1,5}$/;

function repairWord(token: string, afterHouseWord: boolean): { text: string; repaired: boolean } {
  // A house or flat number is digits: "I5" -> "15", "Z69" -> "269", "45O" -> "450".
  if (afterHouseWord && /\d/.test(token) && DIGIT_LOOKALIKE.test(token.replace(/[,.]$/, ''))) {
    const tail = /[,.]$/.exec(token)?.[0] ?? '';
    const r = asDigits(token.replace(/[,.]$/, ''));
    if (r.ok) return { text: r.value + tail, repaired: r.repairs > 0 };
  }
  // A word that mixes letters and digits ("5trect", "Mumb4i") is read with digits folded to letters.
  if ((token.match(/[A-Za-z]/g)?.length ?? 0) >= 3 && /\d/.test(token))
    token = token.replace(/0/g, 'o').replace(/1/g, 'l').replace(/5/g, 'S').replace(/8/g, 'B');
  const match = /^([^A-Za-z]*)([A-Za-z.]+)([^A-Za-z]*)$/.exec(token);
  if (!match) return { text: token, repaired: false };
  const [, before, body, after] = match as unknown as [string, string, string, string];
  const word = body.replace(/\.(?=[A-Za-z])/g, ''); // "Soc.iety" -> "Society"
  const stripped = word.replace(/\.$/, '');
  const dot = word.endsWith('.') ? '.' : '';
  if (VOCAB.has(stripped.toLowerCase())) {
    const canonical = VOCAB.get(stripped.toLowerCase()) as string;
    const same = canonical === body.replace(/\.$/, '');
    return { text: `${before}${canonical}${dot}${after}`, repaired: !same };
  }
  if (stripped.length < 3) return { text: token, repaired: false };
  const fix = nearest(stripped, VOCAB.values(), stripped.length > 6 ? 2 : 1);
  return fix
    ? { text: `${before}${fix}${dot}${after}`, repaired: true }
    : { text: token, repaired: false };
}

/** "Apartment s" -> "Apartments": two neighbouring pieces that together make a known word are joined. */
function joinSplitWords(tokens: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const a = tokens[i] as string;
    const b = tokens[i + 1];
    const joined = b === undefined ? '' : (a + b).replace(/[^A-Za-z]/g, '').toLowerCase();
    if (
      b !== undefined &&
      /^[A-Za-z]+$/.test(a) &&
      /^[A-Za-z]{1,3}$/.test(b) &&
      VOCAB.has(joined)
    ) {
      out.push(VOCAB.get(joined) as string);
      i++;
    } else out.push(a);
  }
  return out;
}

export interface RepairedAddress {
  value: string;
  repairs: number;
}

export function repairAddress(raw: string): RepairedAddress {
  let repairs = 0;
  // "GangaEnclave" -> "Ganga Enclave"; "DoorNo." -> "Door No."
  const spaced = raw
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/([A-Z])([A-Z][a-z])/g, '$1 $2') // "MGRoad" -> "MG Road"
    .replace(/\b(Door|House|Flat)No\b/g, '$1 No');
  if (spaced !== raw) repairs++;
  const segments = spaced
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  // A state name split by a stray comma ("Uttar, Pradesh") is one segment again.
  const tail = segments.slice(-2);
  if (
    tail.length === 2 &&
    STATES.some(
      (st) => editDistance(letters(st).toLowerCase(), letters(tail.join(' ')).toLowerCase()) <= 2,
    )
  ) {
    segments.splice(-2, 2, tail.join(' '));
    repairs++;
  }

  const fixed = segments.map((segment, index) => {
    const isPlace = index >= segments.length - 2;
    const compact = letters(segment);
    if (isPlace && compact.length >= 4) {
      // The last two segments are city and state: match them as a whole, ignoring stray spaces and dots.
      const exact = PLACES.find((p) => letters(p).toLowerCase() === compact.toLowerCase());
      if (exact) return exact === segment ? segment : (repairs++, exact);
      const close = nearest(
        compact,
        PLACES.map((p) => letters(p)),
        2,
      );
      if (close) {
        repairs++;
        return PLACES.find((p) => letters(p) === close) as string;
      }
    }
    return collapse(
      joinSplitWords(segment.split(/\s+/))
        .map((tok, i, all) => {
          const previous = (all[i - 1] ?? '').replace(/[^A-Za-z.]/g, '');
          const r = repairWord(tok, i > 0 && /^(?:no\.?|flat|house|door|plot)$/i.test(previous));
          if (r.repaired) repairs++;
          return r.text;
        })
        .join(' '),
    );
  });
  return { value: fixed.join(', '), repairs };
}
