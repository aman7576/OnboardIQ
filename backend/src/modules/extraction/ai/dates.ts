// Date reading with OCR repair. Output is always YYYY-MM-DD, and only real calendar dates are returned.
import { asDigits } from './ocr.js';
import { editDistance } from './text.js';
import { isRealIsoDate } from './validators.js';

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

export interface ReadDate {
  iso: string;
  repairs: number;
}

/** Finds the first date written DD/MM/YYYY or DD-Mon-YYYY in `text`. */
export function readDate(text: string): ReadDate | null {
  const slash = /([0-9A-Za-z|]{2})\s?\/\s?([0-9A-Za-z|]{2})\s?\/\s?([0-9A-Za-z|]{4})/.exec(text);
  if (slash) {
    const parts = [
      asDigits(slash[1] as string),
      asDigits(slash[2] as string),
      asDigits(slash[3] as string),
    ];
    if (parts.every((p) => p.ok)) {
      const iso = `${parts[2]?.value}-${parts[1]?.value}-${parts[0]?.value}`;
      if (isRealIsoDate(iso)) return { iso, repairs: parts.reduce((n, p) => n + p.repairs, 0) };
    }
  }
  const named = /([0-9A-Za-z|]{2})\s?-\s?([A-Za-z]{3})\s?-\s?([0-9A-Za-z|]{4})/.exec(text);
  if (named) {
    const day = asDigits(named[1] as string);
    const year = asDigits(named[3] as string);
    const abbreviation = (named[2] as string).toUpperCase();
    const month = MONTHS.findIndex((m) => editDistance(m, abbreviation) <= 1);
    if (day.ok && year.ok && month >= 0) {
      const iso = `${year.value}-${String(month + 1).padStart(2, '0')}-${day.value}`;
      if (isRealIsoDate(iso))
        return {
          iso,
          repairs: day.repairs + year.repairs + (MONTHS[month] === abbreviation ? 0 : 1),
        };
    }
  }
  return null;
}

/** A date in any form the readers know (or already YYYY-MM-DD) as YYYY-MM-DD, else undefined. */
export function normaliseDateText(text: string): string | undefined {
  if (isRealIsoDate(text)) return text;
  return readDate(text)?.iso;
}
