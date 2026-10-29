// Field parsers, one per document type. They read cleaned lines and return normalised candidates.
// Strict mode (repair = false) is the regex-only first version: no debris removal, no OCR repair.
import { repairAddress } from './address.js';
import { readDate } from './dates.js';
import { asDigits, asLetters, repairPan } from './ocr.js';
import { collapse, editDistance, fold, isBanner, titleCase } from './text.js';

export interface Candidate {
  value: string;
  repairs: number;
}
export type Found = Record<string, Candidate | undefined>;

interface Mode {
  repair: boolean;
}

/** Text after the first ':' of the first line that starts with `label` (OCR-tolerant when repairing). */
function labelled(
  lines: string[],
  label: string,
  m: Mode,
  tolerance = 1,
): { index: number; value: string } | null {
  for (const [index, line] of lines.entries()) {
    const colon = line.indexOf(':');
    const head = colon >= 0 ? line.slice(0, colon) : line;
    const value = colon >= 0 ? line.slice(colon + 1).trim() : '';
    const same = m.repair
      ? editDistance(fold(head), label) <= tolerance
      : head.trim().toUpperCase() === label_text(label);
    if (same && (colon >= 0 || m.repair)) return { index, value };
  }
  return null;
}
// strict mode compares the plain label text; labels are given folded (no spaces), so rebuild the spacing
const SPACED: Record<string, string> = {
  CONSUMERNAME: 'CONSUMER NAME',
  BILLDATE: 'BILL DATE',
  SUPPLYADDRESS: 'SUPPLY ADDRESS',
  STATEMENTDATE: 'STATEMENT DATE',
  VALIDTILL: 'VALID TILL',
  NAME: 'NAME',
  DOB: 'DOB',
  ADDRESS: 'ADDRESS',
  PIN: 'PIN',
};
const label_text = (folded: string): string => SPACED[folded] ?? folded;

function readName(raw: string, m: Mode): Candidate | undefined {
  let repairs = 0;
  let text = raw;
  if (m.repair) {
    text = raw.replace(/[|~"`]/g, ' ').replace(/(?<=[A-Za-z])\.(?=[A-Za-z])/g, '');
    text = text
      .split(/\s+/)
      .map((tok) => {
        if (!/\d/.test(tok)) return tok;
        const r = asLetters(tok);
        repairs += r.repairs;
        return r.value;
      })
      .join(' ');
  }
  text = collapse(text);
  return text ? { value: titleCase(text), repairs } : undefined;
}

function readPincode(raw: string, m: Mode): Candidate | undefined {
  const re = m.repair ? /(?<![0-9A-Za-z])([0-9A-Za-z|]{6})(?![0-9A-Za-z])/ : /\b(\d{6})\b/;
  const found = re.exec(raw);
  if (!found) return undefined;
  const r = asDigits(found[1] as string);
  return r.ok ? { value: r.value, repairs: r.repairs } : undefined;
}

function readAddress(raw: string, m: Mode): Candidate | undefined {
  const text = collapse(raw.replace(/[|~"`]/g, ' '));
  if (!text) return undefined;
  if (!m.repair) return { value: text, repairs: 0 };
  const r = repairAddress(text);
  return { value: r.value, repairs: r.repairs };
}

/** "…, Mumbai, Maharashtra, PIN 400001" -> address and pincode. */
function splitAddressPin(raw: string, m: Mode): { address?: Candidate; pincode?: Candidate } {
  const split = /^(.*?)[,\s]*P\.?[I1]\.?N\b\W*((?:[0-9A-Za-z|]\s?){6})\s*$/i.exec(raw.trim());
  if (!split)
    return { ...(readAddress(raw, m) ? { address: readAddress(raw, m) as Candidate } : {}) };
  const address = readAddress(split[1] as string, m);
  const pincode = readPincode((split[2] as string).replace(/\s/g, ''), m);
  return { ...(address ? { address } : {}), ...(pincode ? { pincode } : {}) };
}

const withDate = (raw: string | undefined): Candidate | undefined => {
  const d = raw ? readDate(raw) : null;
  return d ? { value: d.iso, repairs: d.repairs } : undefined;
};

export function parsePan(lines: string[], m: Mode): Found {
  const label = lines.findIndex((l) =>
    m.repair
      ? editDistance(fold(l), 'PERMANENTACCOUNTNUMBER') <= 4
      : /Permanent Account Number/i.test(l),
  );
  let pan: Candidate | undefined;
  for (const line of lines.slice(label >= 0 ? label + 1 : 0)) {
    for (const t of line.split(/\s+/)) {
      const tok = t.replace(/[^A-Za-z0-9]/g, '');
      if (tok.length !== 10 || (tok.slice(5, 9).match(/[0-9]/g)?.length ?? 0) < 2) continue;
      const r = m.repair
        ? repairPan(tok)
        : { ok: /^[A-Z]{5}[0-9]{4}[A-Z]$/.test(tok), value: tok, repairs: 0 };
      if (r.ok && (!pan || r.repairs < pan.repairs)) pan = { value: r.value, repairs: r.repairs };
    }
    if (pan) break;
  }
  // "Name" label: its own line, or at the end of the PAN line when two lines were merged.
  const nameAt = lines.findIndex((l) => {
    const f = fold(l);
    return (
      !f.includes('FATHER') &&
      (m.repair ? f.endsWith('NAME') && f.length <= 'NAME'.length + 8 : /(^|\s)Name$/.test(l))
    );
  });
  const nameLine = nameAt >= 0 ? lines.slice(nameAt + 1).find((l) => !isBanner(l)) : undefined;
  const dobAt = lines.findIndex((l) =>
    m.repair ? editDistance(fold(l).slice(0, 11), 'DATEOFBIRTH') <= 2 : /Date of Birth/i.test(l),
  );
  const dobRaw = dobAt >= 0 ? `${lines[dobAt] ?? ''} ${lines[dobAt + 1] ?? ''}` : undefined;
  return {
    ...(nameLine ? { name: readName(nameLine, m) } : {}),
    dob: withDate(dobRaw),
    pan_number: pan,
  };
}

export /** "Address:" with OCR damage ("Addr,ess:"): the text before the first colon reads as ADDRESS. */
const isAddressLabel = (line: string): boolean => {
  const colon = line.indexOf(':');
  return colon > 0 && colon <= 12 && editDistance(fold(line.slice(0, colon)), 'ADDRESS') <= 1;
};

export function parseAadhaar(lines: string[], m: Mode): Found {
  const dobAt = lines.findIndex((l) => (m.repair ? /D[O0]B/i.test(l) : /DOB/.test(l)));
  const dobLine = dobAt >= 0 ? (lines[dobAt] as string) : '';
  const dateLine = dobLine.replace(/^.*?D[O0]B\W*/i, '');
  const nameBeforeDob = /^(.*?)\s*D[O0]B\b/i.exec(dobLine)?.[1] ?? '';
  let name: Candidate | undefined = /^[A-Za-z][A-Za-z .'|-]{2,}$/.test(nameBeforeDob)
    ? readName(nameBeforeDob, m)
    : undefined;
  for (let i = dobAt - 1; i >= 0 && !name; i--) {
    const l = lines[i] as string;
    if (isBanner(l) || fold(l).includes('AADHAAR') || fold(l).includes('RESIDENT')) continue;
    if (/^[A-Za-z][A-Za-z .'|-]+$/.test(l)) name = readName(l, m);
    break;
  }
  const folded = lines.map(fold);
  const female = m.repair
    ? folded.some((f) => f === 'FEMALE' || editDistance(f, 'FEMALE') <= 1)
    : lines.some((l) => /^FEMALE$/.test(l));
  const male = m.repair
    ? folded.some((f) => f === 'MALE' || editDistance(f, 'MALE') <= 1)
    : lines.some((l) => /^MALE$/.test(l));

  // Address runs from "Address:" up to and including the masked-number line.
  const at = lines.findIndex((l) => (m.repair ? isAddressLabel(l) : /^Address:/.test(l)));
  let address: Candidate | undefined;
  let pincode: Candidate | undefined;
  let last4: Candidate | undefined;
  if (at >= 0) {
    const block: string[] = [];
    for (const l of lines.slice(at)) {
      const x = /X{2,}/i.exec(l);
      block.push(x ? l.slice(0, x.index) : l);
      if (x) {
        const tail = l
          .slice(x.index)
          .replace(/^[Xx\s.]+/, '')
          .replace(/[^A-Za-z0-9]/g, '');
        const digits = asDigits(tail.slice(-4));
        if (tail.length >= 4 && (digits.ok || m.repair))
          last4 = digits.ok ? { value: digits.value, repairs: digits.repairs } : undefined;
        break;
      }
    }
    const joined = collapse(block.join(' ').replace(/^[^:]{0,12}:\s*/, ''));
    const pin = /^(.*?)[\s,]*-\s*([0-9A-Za-z|]{6})\s*$/.exec(joined);
    address = readAddress(pin ? (pin[1] as string) : joined, m);
    pincode = pin ? readPincode(pin[2] as string, m) : undefined;
  }
  return {
    ...(name ? { name } : {}),
    dob: withDate(dateLine),
    ...(female
      ? { gender: { value: 'F', repairs: 0 } }
      : male
        ? { gender: { value: 'M', repairs: 0 } }
        : {}),
    aadhaar_last4: last4,
    address,
    pincode,
  };
}

export function parseBill(lines: string[], m: Mode): Found {
  const name = labelled(lines, 'CONSUMERNAME', m, 2);
  const date = labelled(lines, 'BILLDATE', m);
  const addr = labelled(lines, 'SUPPLYADDRESS', m, 2);
  const parts = addr ? splitAddressPin(addr.value, m) : {};
  return {
    ...(name ? { name: readName(name.value, m) } : {}),
    document_date: withDate(date?.value),
    ...parts,
  };
}

export function parseLicence(lines: string[], m: Mode): Found {
  const name = labelled(lines, 'NAME', m, 0);
  const dob = labelled(lines, 'DOB', m);
  const valid = labelled(lines, 'VALIDTILL', m);
  const addr = labelled(lines, 'ADDRESS', m);
  const parts = addr ? splitAddressPin(addr.value, m) : {};
  return {
    ...(name ? { name: readName(name.value, m) } : {}),
    dob: withDate(dob?.value),
    valid_until: withDate(valid?.value),
    ...parts,
  };
}

const ADDRESS_START = ['Flat', 'Door', 'House', 'Plot'];

export function parseBank(lines: string[], m: Mode): Found {
  const title = lines.findIndex((l) =>
    m.repair
      ? editDistance(fold(l).slice(0, 16), 'ACCOUNTSTATEMENT') <= 3
      : /Account Statement/i.test(l),
  );
  const pinAt = lines.findIndex(
    (l, i) => i > title && (m.repair ? /^P[I1]N\s*[:.]/i.test(l) : /^PIN:/.test(l)),
  );
  const date = labelled(lines, 'STATEMENTDATE', m, 2);
  let name: Candidate | undefined;
  let address: Candidate | undefined;
  if (title >= 0 && pinAt > title) {
    const block = collapse(
      lines
        .slice(title + 1, pinAt)
        .filter((l) => !isBanner(l))
        .join(' '),
    );
    const tokens = block.split(' ');
    const cut = tokens.findIndex(
      (t, i) =>
        i > 0 &&
        (/\d/.test(t) ||
          ADDRESS_START.some(
            (s) =>
              editDistance(t.replace(/[^A-Za-z]/g, '').toLowerCase(), s.toLowerCase()) <=
              (m.repair ? 1 : 0),
          )),
    );
    const nameText = cut > 0 ? tokens.slice(0, cut).join(' ') : block;
    name = readName(nameText, m);
    address = cut > 0 ? readAddress(tokens.slice(cut).join(' '), m) : undefined;
  }
  const pinValue = pinAt >= 0 ? (lines[pinAt] as string).replace(/^P[I1]N\s*[:.]\s*/i, '') : '';
  return {
    ...(name ? { name } : {}),
    address,
    pincode: readPincode(pinValue, m),
    document_date: withDate(date?.value),
  };
}
