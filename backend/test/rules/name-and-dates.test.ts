import { describe, expect, it } from 'vitest';
import { addYears, ageOn, daysBetween, parseIsoDate } from '../../src/rules/dates.js';
import {
  atLeast,
  formatScore,
  levenshtein,
  nameSimilarity,
  normaliseName,
  roundScore,
} from '../../src/rules/name.js';
import { reference } from './fixtures.js';

const titles = reference.config.name_title_tokens;

describe('name normalisation (spec 6.1)', () => {
  it('uses the title tokens from the configuration file', () => {
    expect(titles).toEqual(['MR', 'MRS', 'MS', 'MISS', 'DR', 'SHRI', 'SMT', 'KUMARI']);
  });
  it('upper-cases, sorts tokens and joins with one space (spec calculation check)', () => {
    expect(normaliseName('Ravi Kumar Sharma', titles)).toBe('KUMAR RAVI SHARMA');
    expect(normaliseName('Ravi K Sharma', titles)).toBe('K RAVI SHARMA');
  });
  it('replaces "." and "-" by spaces and removes every other non A-Z character', () => {
    expect(normaliseName('Dr. A.B-Rao', titles)).toBe('A B RAO');
    expect(normaliseName("O'Neil 2nd", titles)).toBe('ND ONEIL'); // apostrophe and digit dropped, tokens sorted
    expect(normaliseName('Zoë Müller', titles)).toBe('MLLER ZO');
  });
  it('drops every title token and collapses spaces', () => {
    expect(normaliseName('  Mr   Shri Smt Kumari Miss Ms Mrs Dr  Anil  ', titles)).toBe('ANIL');
    expect(normaliseName('Mr. Anil', titles)).toBe(normaliseName('anil', titles));
  });
  it('ignores token order', () => {
    expect(nameSimilarity('Sharma Ravi Kumar', 'Ravi Kumar Sharma', titles)).toBe(1);
  });
});

describe('Levenshtein similarity', () => {
  it('computes the distance', () => {
    expect(levenshtein('KITTEN', 'SITTING')).toBe(3);
    expect(levenshtein('', 'ABC')).toBe(3);
    expect(levenshtein('ABC', 'ABC')).toBe(0);
  });
  it('example 4: distance 4 over 17 characters = 0.7647', () => {
    expect(levenshtein('KUMAR RAVI SHARMA', 'K RAVI SHARMA')).toBe(4);
    const score = nameSimilarity('Ravi Kumar Sharma', 'Ravi K Sharma', titles);
    expect(score).toBeCloseTo(1 - 4 / 17, 12);
    expect(formatScore(score)).toBe('0.7647');
  });
  it('is 1.0 when both normalised names are empty', () => {
    expect(nameSimilarity('Mr.', 'Dr', titles)).toBe(1);
  });
  it('is rounded to 4 decimals for output only; the comparison keeps full precision', () => {
    const score = 1 - 4 / 17;
    expect(score).not.toBe(0.7647);
    expect(roundScore(score)).toBe(0.7647);
    expect(formatScore(null)).toBe('');
    expect(formatScore(1)).toBe('1.0000');
  });
  it('treats an exact-on-paper 0.90 as 0.90 (floating-point tolerance)', () => {
    expect(atLeast(1 - 3 / 30, 0.9)).toBe(true);
    expect(atLeast(0.8999, 0.9)).toBe(false);
  });
});

describe('calendar dates', () => {
  it('computes completed years', () => {
    expect(ageOn('2008-03-04', '2026-03-04')).toBe(18); // birthday today
    expect(ageOn('2008-03-05', '2026-03-04')).toBe(17); // birthday tomorrow
    expect(ageOn('2008-09-10', '2026-03-04')).toBe(17);
    expect(ageOn('2000-02-29', '2026-02-28')).toBe(25);
  });
  it('counts whole days', () => {
    expect(daysBetween('2025-12-04', '2026-03-04')).toBe(90);
    expect(daysBetween('2026-03-05', '2026-03-04')).toBe(-1);
  });
  it('adds years; a missing 29 February becomes 28 February', () => {
    expect(addYears('2026-03-04', 10)).toBe('2036-03-04');
    expect(addYears('2024-02-29', 2)).toBe('2026-02-28');
    expect(addYears('2024-02-29', 10)).toBe('2034-02-28');
    expect(addYears('2024-02-29', 4)).toBe('2028-02-29'); // exists: kept (see README "open questions")
  });
  it('rejects non-dates', () => {
    expect(() => parseIsoDate('2026-02-30')).toThrow(/real calendar date/);
    expect(() => parseIsoDate('04/03/2026')).toThrow(/YYYY-MM-DD/);
  });
});
