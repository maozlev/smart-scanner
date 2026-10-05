// A table the scanner could not understand, mapped by the operator: they say what each column
// holds and which rows are headers, and every data row becomes a cut-list line. Numbers come
// from the OCR; text the OCR was not sure of is left empty for a person to type, because
// Hebrew stroke lettering comes back as confident-looking Latin garbage.
import { UNIT_TO_MM, parseNumber, parsePlate } from './normalize';
import type { CellRead } from './ocr';
import type { CutLine } from './table';

export type ManualRole = 'ignore' | 'type' | 'label' | 'length' | 'width' | 'size' | 'qty';

export const MANUAL_ROLE_TEXT: Record<ManualRole, string> = {
  ignore: 'לא בשימוש',
  type: 'סוג חומר',
  label: 'סימון',
  length: 'אורך',
  width: 'רוחב',
  size: 'אורך × רוחב',
  qty: 'כמות',
};

export type LengthUnit = 'mm' | 'cm' | 'm';

export interface ManualMapping {
  roles: ManualRole[]; // one per column
  headerTop: number; // grid rows skipped at the top
  headerBottom: number; // and at the bottom
  unit: LengthUnit; // what the length and width columns are written in
  fixedType: string; // the material of every row, when the table has no column for it
  fixedQty: number | null; // pieces per row, when the table lists one member per row and has no quantity column
}

export function emptyMapping(nCols: number): ManualMapping {
  return { roles: Array<ManualRole>(nCols).fill('ignore'), headerTop: 1, headerBottom: 0, unit: 'mm', fixedType: '', fixedQty: null };
}

/** What stops the mapping from producing lines; empty when it can be applied. */
export function mappingProblems(mapping: ManualMapping, nRows: number): string[] {
  const problems: string[] = [];
  const has = (role: ManualRole) => mapping.roles.includes(role);
  for (const role of ['type', 'length', 'width', 'size', 'qty'] as const) {
    if (mapping.roles.filter((r) => r === role).length > 1) problems.push(`יותר מעמודה אחת מסומנת "${MANUAL_ROLE_TEXT[role]}"`);
  }
  if (!has('qty') && mapping.fixedQty === null) problems.push('לא סומנה עמודת כמות ולא הוזנה כמות לכל שורה');
  if (!has('length') && !has('size')) problems.push('לא סומנה עמודת אורך');
  if (has('size') && (has('length') || has('width'))) problems.push('"אורך × רוחב" לא יכול לבוא עם עמודת אורך או רוחב נפרדת');
  if (!has('type') && mapping.fixedType.trim() === '') problems.push('לא סומנה עמודת סוג חומר ולא הוזן סוג לכל הטבלה');
  if (mapping.headerTop + mapping.headerBottom >= nRows) problems.push('לא נשארו שורות נתונים');
  return problems;
}

// below this the recognizer was guessing; see READ_CONF_MIN in classify.ts
const TRUSTED_CONF = 0.85;

export interface ManualRow {
  rowIndex: number;
  line: CutLine;
  doubtful: boolean; // a number was read with low confidence, or not read at all
}

const toMm = (value: number | null, unit: LengthUnit) => (value === null ? null : Math.round(value * UNIT_TO_MM[unit]!));

export function applyMapping(cells: CellRead[][], mapping: ManualMapping): ManualRow[] {
  const rows: ManualRow[] = [];
  for (let r = mapping.headerTop; r < cells.length - mapping.headerBottom; r++) {
    const row = cells[r]!;
    // a row with no ink at all is spacing, not a part
    if (row.every((cell) => cell.source === 'empty')) continue;
    let doubtful = false;
    const text = (role: ManualRole) =>
      mapping.roles
        .map((m, c) => (m === role && row[c] && row[c].conf >= TRUSTED_CONF ? (row[c].value ?? '').trim() : ''))
        .filter(Boolean)
        .join(' ');
    const cellOf = (role: ManualRole) => row[mapping.roles.indexOf(role)];
    const number = (role: ManualRole): number | null => {
      const cell = cellOf(role);
      if (!cell || cell.source === 'empty') return null;
      const value = parseNumber(cell.value);
      if (value === null || cell.conf < TRUSTED_CONF) doubtful = true;
      return value;
    };

    let lengthMm = toMm(number('length'), mapping.unit);
    let widthMm = toMm(number('width'), mapping.unit);
    const size = cellOf('size');
    if (size && size.source !== 'empty') {
      const plate = parsePlate(size.value);
      if (!plate || size.conf < TRUSTED_CONF) doubtful = true;
      if (plate) {
        lengthMm = toMm(Math.max(...plate), mapping.unit);
        widthMm = toMm(Math.min(...plate), mapping.unit);
      }
    }
    const qty = mapping.roles.includes('qty') ? number('qty') : mapping.fixedQty;
    rows.push({
      rowIndex: r,
      line: { type: text('type') || mapping.fixedType.trim(), label: text('label'), lengthMm, widthMm, qty: qty === null ? null : Math.round(qty) },
      doubtful: doubtful || (qty !== null && !Number.isInteger(qty)),
    });
  }
  return rows;
}
