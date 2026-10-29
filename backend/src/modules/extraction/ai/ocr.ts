// OCR-error correction (spec AI-2): characters a scanner confuses are repaired only where the field's
// structure says which kind of character belongs there. Every repair is counted, because a value that
// needed repair is less certain and gets a lower confidence.
const TO_DIGIT: Record<string, string> = {
  O: '0',
  Q: '0',
  D: '0',
  o: '0',
  I: '1',
  l: '1',
  i: '1',
  '|': '1',
  Z: '2',
  z: '2',
  S: '5',
  s: '5',
  G: '6',
  B: '8',
  b: '6',
  g: '9',
  q: '9',
};
const TO_LETTER: Record<string, string> = {
  '0': 'O',
  '1': 'I',
  '2': 'Z',
  '5': 'S',
  '6': 'G',
  '8': 'B',
};

export interface Repaired {
  value: string;
  repairs: number;
  ok: boolean;
}

/** Reads `chars` as digits, repairing letter look-alikes. ok=false if a character cannot be a digit. */
export function asDigits(raw: string): Repaired {
  let repairs = 0;
  let ok = true;
  const value = [...raw]
    .map((c) => {
      if (/[0-9]/.test(c)) return c;
      const d = TO_DIGIT[c];
      if (d === undefined) {
        ok = false;
        return c;
      }
      repairs++;
      return d;
    })
    .join('');
  return { value, repairs, ok };
}

/** Reads `raw` as letters, repairing digit look-alikes. */
export function asLetters(raw: string): Repaired {
  let repairs = 0;
  let ok = true;
  const value = [...raw.toUpperCase()]
    .map((c) => {
      if (/[A-Z]/.test(c)) return c;
      const l = TO_LETTER[c];
      if (l === undefined) {
        ok = false;
        return c;
      }
      repairs++;
      return l;
    })
    .join('');
  return { value, repairs, ok };
}

/** PAN structure AAAAA9999A: letters in positions 1-5 and 10, digits in 6-9. */
export function repairPan(token: string): Repaired {
  if (token.length !== 10) return { value: token, repairs: 0, ok: false };
  const parts = [
    asLetters(token.slice(0, 5)),
    asDigits(token.slice(5, 9)),
    asLetters(token.slice(9)),
  ];
  return {
    value: parts.map((p) => p.value).join(''),
    repairs: parts.reduce((n, p) => n + p.repairs, 0),
    ok: parts.every((p) => p.ok),
  };
}
