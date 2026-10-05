// What kind of table is this grid, and what is each column? A port of the deterministic half
// of steelOptimaV2 tables/classify.py. There is no vision model here: a grid whose header ink
// cannot be read comes back "unknown" and is shown to the operator, never guessed at.
import { fixHomoglyphs, parseNumber } from './normalize';
import type { CellRead } from './ocr';

export type ColumnRole =
  | 'item_no' | 'qty' | 'description' | 'profile' | 'diameter' | 'unit_length'
  | 'total_length' | 'unit_weight' | 'total_weight' | 'level' | 'other';

export type TableKind = 'materials' | 'unknown' | 'other';
export type HeaderPosition = 'top' | 'bottom';

export interface Classification {
  kind: TableKind;
  columnRoles: ColumnRole[];
  headerRows: number;
  headerPosition: HeaderPosition;
  confidence: number;
}

/** (headerPosition, headerRows, per-column reads). headerRows is 0 for a strip OUTSIDE the ruling. */
export type HeaderCandidate = [HeaderPosition, number, CellRead[]];

// first hit wins, more specific phrases first
const HEADER_KEYWORDS: [string, ColumnRole][] = [
  ['total length', 'total_length'],
  ['total weight', 'total_weight'],
  ['unit weight', 'unit_weight'],
  ['unit length', 'unit_length'],
  ['item description', 'description'],
  ['description', 'description'],
  ['item number', 'item_no'],
  ['item', 'item_no'],
  ['qty', 'qty'],
  ['quantity', 'qty'],
  ['profile', 'profile'],
  ['section', 'profile'],
  ['diameter', 'diameter'],
  ['dia.', 'diameter'],
  ['length', 'unit_length'],
  ['weight', 'total_weight'],
  ['level', 'level'],
  ['notes', 'other'],
];

// the words that say "this is the table we need"
const MATERIAL_MARKERS = [
  'weight', 'kg', 'mm', 'cm', 'length', 'total', 'qty', 'quantity', 'pcs', 'dia', 'profile', 'section', 'size',
  'משקל', 'אורך', 'קוטר', 'כמות', 'מידה', 'פרופיל', 'סה"כ',
];

// The recognizer drops stray spaces into wide header lettering ("Item Descri ption", measured
// on the NCD sheet), so header words are matched with all whitespace removed.
const squash = (text: string) => fixHomoglyphs(text).toLowerCase().replace(/\s+/g, '');

export function hasMaterialMarkers(texts: string[]): boolean {
  return texts.some((text) => {
    const squashed = squash(text);
    return MATERIAL_MARKERS.some((marker) => squashed.includes(marker));
  });
}

export function dataRowIndices(nRows: number, cls: Classification): number[] {
  const rows = Array.from({ length: nRows }, (_, i) => i);
  const h = Math.min(cls.headerRows, nRows - 1);
  if (h <= 0) return rows;
  return cls.headerPosition === 'top' ? rows.slice(h) : rows.slice(0, -h);
}

export function classifyHeuristic(candidates: [HeaderPosition, number, string[]][]): Classification {
  const nCols = candidates[0]?.[2].length ?? 0;
  let best: Classification = { kind: 'unknown', columnRoles: [], headerRows: 1, headerPosition: 'top', confidence: 0 };
  let bestKnown = -1;
  for (const [position, headerRows, texts] of candidates) {
    const roles = texts.map((cellText): ColumnRole => {
      const text = squash(cellText);
      return HEADER_KEYWORDS.find(([keyword]) => text.includes(keyword.replaceAll(' ', '')))?.[1] ?? 'other';
    });
    const known = roles.filter((r) => r !== 'other').length;
    if (known > bestKnown) {
      bestKnown = known;
      const hasDim = roles.some((r) => r === 'unit_length' || r === 'total_length' || r === 'diameter' || r === 'profile');
      best = {
        kind: roles.includes('qty') && hasDim ? 'materials' : 'unknown',
        columnRoles: roles,
        headerRows,
        headerPosition: position,
        confidence: known >= 3 ? 0.5 : 0.2,
      };
    }
  }
  if (best.columnRoles.length === 0) best.columnRoles = Array<ColumnRole>(nCols).fill('other');
  return best;
}

const READABLE_RATIO = 0.5; // share of inked header WORDS the OCR must have read
// English printed headers read at 0.886-1.00; Hebrew stroke ink comes back as plausible Latin
// garbage at 0.25-0.82. Text alone cannot separate them; confidence can.
const READ_CONF_MIN = 0.85;
const TABULAR_MIN_ROWS = 4;
const TABULAR_MIN_COLS = 3;
const TABULAR_MIN_NUMERIC_SHARE = 0.5;

export type GateReason = 'printed_headers' | 'marker_words' | 'readable_no_markers' | 'unreadable_not_tabular' | 'unreadable_ink';

export interface GateDecision {
  classification: Classification;
  reason: GateReason;
}

const filled = (c: CellRead) => (c.value ?? '').trim() !== '';

function numericShare(reads: CellRead[]): number {
  const inked = reads.filter(filled);
  if (inked.length === 0) return 0;
  return inked.filter((c) => parseNumber(c.value) !== null).length / inked.length;
}

// The evidence of last resort for grids whose words cannot be read: digits are
// language-neutral, so whichever of the first and last grid rows is a data row is mostly numbers.
function looksTabular(candidates: HeaderCandidate[], nRows: number, nCols: number): boolean {
  if (nRows < TABULAR_MIN_ROWS || nCols < TABULAR_MIN_COLS) return false;
  const gridRows = candidates.filter(([, headerRows]) => headerRows === 1).map(([, , reads]) => reads);
  if (gridRows.length === 0) return false;
  return Math.max(...gridRows.map(numericShare)) >= TABULAR_MIN_NUMERIC_SHARE;
}

/**
 * Decide whether a grid is a materials table, something to show the operator, or junk.
 * "other" is dropped; "unknown" is surfaced. A table that is silently dropped costs the whole
 * sheet, so only a grid whose header WAS read and names nothing material is dropped.
 */
export function gateDecision(candidates: HeaderCandidate[], nCols: number, nRows: number): GateDecision {
  const heuristic = classifyHeuristic(candidates.map(([pos, hr, reads]) => [pos, hr, reads.map((c) => c.value ?? '')]));
  const allReads = candidates.flatMap(([, , reads]) => reads);
  const inked = allReads.filter((c) => c.source !== 'empty');
  // readability is judged on words only: digits come back at ~1.0 in any script
  const words = inked.filter((c) => parseNumber(c.value) === null);
  const readOk = words.filter((c) => filled(c) && c.conf >= READ_CONF_MIN);
  const readable = words.length === 0 || readOk.length / words.length >= READABLE_RATIO;
  const markers = hasMaterialMarkers(allReads.map((c) => c.value ?? ''));
  const rejected: Classification = {
    kind: 'other',
    columnRoles: Array<ColumnRole>(nCols).fill('other'),
    headerRows: 0,
    headerPosition: 'top',
    confidence: 0.4,
  };

  if (heuristic.kind === 'materials') return { classification: heuristic, reason: 'printed_headers' };
  if (markers) return { classification: heuristic, reason: 'marker_words' };
  if (readable || inked.length === 0) return { classification: rejected, reason: 'readable_no_markers' };
  if (!looksTabular(candidates, nRows, nCols)) return { classification: rejected, reason: 'unreadable_not_tabular' };
  return { classification: { ...heuristic, kind: 'unknown' }, reason: 'unreadable_ink' };
}

const WEIGHT_LINE_RE = /total\s*weight\D{0,3}(\d[\d.,]*)/i;

/** 'Total Weight: 3814.4 kg' printed beside the table. */
export function declaredTotalWeight(lines: string[]): number | null {
  for (const line of lines) {
    const m = WEIGHT_LINE_RE.exec(fixHomoglyphs(line).replaceAll(' ', ''));
    const value = m ? parseNumber(m[1]!.replace(/[.,]$/, '')) : null;
    if (value !== null) return value;
  }
  return null;
}
