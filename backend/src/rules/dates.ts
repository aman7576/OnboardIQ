// Dates are compared as calendar dates (YYYY-MM-DD), never as timestamps.
const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;

export function parseIsoDate(value: string): { y: number; m: number; d: number } {
  const match = ISO.exec(value);
  if (!match) throw new Error(`not a YYYY-MM-DD date: ${value}`);
  const [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const check = new Date(Date.UTC(y, m - 1, d));
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== m - 1 || check.getUTCDate() !== d)
    throw new Error(`not a real calendar date: ${value}`);
  return { y, m, d };
}

const toUtcDay = (value: string): number => {
  const { y, m, d } = parseIsoDate(value);
  return Date.UTC(y, m - 1, d) / 86_400_000;
};

/** Whole days from `from` to `to` (positive when `to` is later). */
export const daysBetween = (from: string, to: string): number => toUtcDay(to) - toUtcDay(from);

/** Completed years on `onDate`. */
export function ageOn(dob: string, onDate: string): number {
  const b = parseIsoDate(dob);
  const t = parseIsoDate(onDate);
  return t.y - b.y - (t.m < b.m || (t.m === b.m && t.d < b.d) ? 1 : 0);
}

const isLeap = (y: number): boolean => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;

/** Adds whole years; a 29 February that does not exist in the target year becomes 28 February. */
export function addYears(date: string, years: number): string {
  const { y, m, d } = parseIsoDate(date);
  const target = y + years;
  const day = m === 2 && d === 29 && !isLeap(target) ? 28 : d;
  return `${String(target).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}
