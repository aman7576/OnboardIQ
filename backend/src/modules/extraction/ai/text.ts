// Text helpers for noisy OCR output. Document text is untrusted data: it is only ever read by these
// pure functions, never executed or followed.

/** A line made only of scanner debris such as "~ ~", ". ." or a lone quote mark. */
export const isNoiseLine = (line: string): boolean => /^[\s~."'`,;:|_\-*]*$/.test(line);

/** Removes debris tokens at the edges of a line ("~ ~", ". .", stray quotes and bars). */
export function cleanLine(line: string): string {
  // A footer that the scanner glued onto a content line ("... PIN 110086 Hackathon synthetic data ...") is cut off.
  let out = line.replace(/\s*H\s?a\s?c\s?k\s?a\s?t\s?h\s?o\s?n.*$/i, '').trim();
  let previous = '';
  while (out !== previous) {
    previous = out;
    out = out
      .replace(/^(?:[~"'`|]|\.(?=\s|$))\s*/, '')
      .replace(/\s*(?:[~"'`|]|(?<=\s)\.)$/, '')
      .trim();
  }
  return out;
}

export function cleanLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .filter((l) => !isNoiseLine(l))
    .map(cleanLine)
    .filter((l) => l !== '');
}

/** Upper-case letters only, with look-alike digits folded to letters: lets "INC0ME" match "INCOME". */
export const fold = (text: string): string =>
  text
    .toUpperCase()
    .replace(/0/g, 'O')
    .replace(/[1|]/g, 'I')
    .replace(/5/g, 'S')
    .replace(/8/g, 'B')
    .replace(/[^A-Z]/g, '');

export function editDistance(a: string, b: string): number {
  let previous = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++)
      current[j] = Math.min(
        (previous[j] as number) + 1,
        (current[j - 1] as number) + 1,
        (previous[j - 1] as number) + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    previous = current;
  }
  return previous[b.length] as number;
}

export const collapse = (s: string): string => s.replace(/\s+/g, ' ').trim();

/** "RAVI KUMAR SHARMA" -> "Ravi Kumar Sharma". Already mixed-case text is left as it is. */
export function titleCase(name: string): string {
  const s = collapse(name);
  return s === s.toUpperCase() ? s.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase()) : s;
}

/** Lines that are specimen banners / footers, not content. */
export const isBanner = (line: string): boolean => {
  const f = fold(line);
  return (
    f.includes('SPECIMEN') ||
    f.includes('VALIDDOCUMENT') ||
    f.includes('HACKATHON') ||
    f.includes('FICTIONAL')
  );
};
