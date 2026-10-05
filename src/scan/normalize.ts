// Cell-text normalization: numbers, plate sizes, material keys. Pure functions; a port of
// steelOptimaV2 tables/normalize.py.

// What the OCR gets wrong on stroke fonts is lookalikes, not digits: '×' for 'x',
// '[' / '丨' for 'L', 'm2' for 'm²', an ideographic space for a space.
export function fixHomoglyphs(text: string): string {
  return text
    .replace(/[×＊Ｘｘ]/g, 'x')
    .replace(/，/g, ',')
    .replace(/．/g, '.')
    .replace(/　/g, ' ')
    .replace(/[\[［丨|](?=\s*\d)/g, 'L')
    .replaceAll('m2', 'm²');
}

const NUM_RE = /^[+\-]?\d{1,3}(?:[,.]\d{3})*(?:[.,]\d+)?$|^[+\-]?\d+(?:[.,]\d+)?$/;
const PLATE_RE = /^(\d+(?:[.,]\d+)?)\s*[xX×]\s*(\d+(?:[.,]\d+)?)$/;
const PROFILE_RE = /([A-Za-z]{1,4})\s*\.?\s*(\d+(?:[.,]\d+)?(?:\s*[xX×]\s*\d+(?:[.,]\d+)?){1,3})/;
// Rolled sections named by a series and one size ("HEA200", "IPE 240"), with no "x". Upper case
// only and not glued to another capital, so "PIPE100" is not read as IPE100; a lower-case
// word the OCR merged in front ("ColumnHEA200") still matches.
const SERIES_RE = /(?<![A-Z])(HEA|HEB|HEM|IPE|IPN|INP|UPN|UNP|UPE)\s*(\d{2,4})(?![\dxX×.,])/;
const THK_RE =/THK\s*\.?\s*(\d+(?:[.,]\d+)?)\s*mm/i;
const AREA_RE = /^(\d+(?:[.,]\d+)?)\s*m²$/;

// the OCR merges words ("LegL160x160x15"), so the letters captured before the numbers are
// trimmed to the longest known designator suffix
const PROFILE_DESIGNATORS = new Set([
  'L', 'PL', 'U', 'C', 'T', 'I', 'H', 'W', 'HEA', 'HEB', 'HEM', 'IPE', 'IPN', 'UPN', 'UNP',
  'RHS', 'SHS', 'CHS', 'FL', 'EA', 'UA', 'SQ', 'RB',
]);

function trimDesignator(letters: string): string {
  const upper = letters.toUpperCase();
  for (let size = upper.length; size > 0; size--) {
    if (PROFILE_DESIGNATORS.has(upper.slice(-size))) return upper.slice(-size);
  }
  return upper;
}

/** A plain number or null, never a guess: '80x40', '0.6495 m²' and Hebrew text return null. */
export function parseNumber(raw: string | null | undefined): number | null {
  if (!raw) return null;
  // the recognizer sprinkles spaces into letter-spaced digits ("3 2.2"); a numeric cell
  // holds one value, and a bad merge fails the row's own arithmetic anyway
  let text = fixHomoglyphs(raw).replace(/[ '"]/g, '');
  if (!NUM_RE.test(text)) return null;
  // the last of '.' or ',' is the decimal separator; the other is grouping
  if (text.lastIndexOf('.') > text.lastIndexOf(',')) text = text.replaceAll(',', '');
  else text = text.replaceAll('.', '').replaceAll(',', '.');
  const value = Number(text);
  return Number.isFinite(value) ? value : null;
}

export function parseArea(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const m = AREA_RE.exec(fixHomoglyphs(raw).trim());
  return m ? parseNumber(m[1]) : null;
}

/** 'Connection Plate THK 14 mm' -> 14 */
export function parseThk(text: string | null | undefined): number | null {
  if (!text) return null;
  const m = THK_RE.exec(fixHomoglyphs(text));
  return m ? parseNumber(m[1]) : null;
}

/** '450x174' -> [450, 174] */
export function parsePlate(raw: string | null | undefined): [number, number] | null {
  if (!raw) return null;
  const m = PLATE_RE.exec(fixHomoglyphs(raw).trim());
  if (!m) return null;
  const a = parseNumber(m[1]), b = parseNumber(m[2]);
  return a === null || b === null ? null : [a, b];
}

/**
 * 'Diagonal L 60x60x6' -> key 'L60X60X6', rest 'Diagonal'; null when the text names no profile.
 * `rest` is the text around the designation, which is what is left to say about the part.
 */
export function splitProfile(text: string): { key: string; rest: string } | null {
  const fixed = fixHomoglyphs(text);
  const m = PROFILE_RE.exec(fixed);
  if (!m) {
    const series = SERIES_RE.exec(fixed);
    if (!series) return null;
    const around = `${fixed.slice(0, series.index)} ${fixed.slice(series.index + series[0].length)}`;
    return { key: series[1]! + series[2]!, rest: around.replace(/\s+/g, ' ').trim() };
  }
  const designator = trimDesignator(m[1]!);
  // letters the OCR glued on in front of the designator ("LegL160...") belong to the rest
  const before = fixed.slice(0, m.index) + m[1]!.slice(0, m[1]!.length - designator.length);
  const after = fixed.slice(m.index + m[0].length);
  return {
    key: designator + m[2]!.replace(/\s/g, '').replaceAll(',', '.').toUpperCase(),
    rest: `${before} ${after}`.replace(/\s+/g, ' ').trim(),
  };
}

export function profileKey(text: string): string | null {
  return splitProfile(text)?.key ?? null;
}

export const UNIT_TO_MM: Record<string, number> = { mm: 1, cm: 10, m: 1000 };
