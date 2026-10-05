// The product's main output: a cut list in the exact shape the nesting calculator imports
// (parseCutList in the nesting repo; same columns as its cut-list-template.csv).
import type { CutLine } from './table';

export const CUT_LIST_HEADER = ['סוג', 'סימון', 'אורך', 'רוחב', 'כמות'];

export type CompleteLine = CutLine & { lengthMm: number; qty: number };

/** What still stops a line from being exported; an empty list means it is ready. */
export function lineProblems(line: CutLine): string[] {
  const problems: string[] = [];
  if (line.type.trim() === '') problems.push('חסר סוג חומר');
  if (line.lengthMm === null || !Number.isInteger(line.lengthMm) || line.lengthMm <= 0) problems.push('חסר אורך');
  if (line.widthMm !== null && (!Number.isInteger(line.widthMm) || line.widthMm <= 0)) problems.push('רוחב לא תקין');
  if (line.qty === null || !Number.isInteger(line.qty) || line.qty <= 0) problems.push('חסרה כמות');
  return problems;
}

export function isComplete(line: CutLine): line is CompleteLine {
  return lineProblems(line).length === 0;
}

/** Header + one row per line; a line with a width is read by the calculator as a plate. */
export function cutListTable(lines: CompleteLine[]): string[][] {
  return [
    CUT_LIST_HEADER,
    ...lines.map((l) => [l.type.trim(), l.label.trim(), String(l.lengthMm), l.widthMm === null ? '' : String(l.widthMm), String(l.qty)]),
  ];
}

export function toCsv(table: string[][]): string {
  const cell = (text: string) => (/[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text);
  // the BOM makes Excel open Hebrew as UTF-8
  return '\uFEFF' + table.map((row) => row.map(cell).join(',')).join('\r\n') + '\r\n';
}

export interface MaterialTotal {
  type: string;
  plate: boolean;
  lines: number;
  pieces: number;
  totalLengthMm: number; // bars
  totalAreaMm2: number; // plates
}

/** Pooled per material, in first-seen order. */
export function totalsByType(lines: CompleteLine[]): MaterialTotal[] {
  const byType = new Map<string, MaterialTotal>();
  for (const l of lines) {
    const plate = l.widthMm !== null;
    const key = `${plate ? 'p' : 'b'}:${l.type.trim()}`;
    let total = byType.get(key);
    if (!total) {
      total = { type: l.type.trim(), plate, lines: 0, pieces: 0, totalLengthMm: 0, totalAreaMm2: 0 };
      byType.set(key, total);
    }
    total.lines++;
    total.pieces += l.qty;
    if (l.widthMm === null) total.totalLengthMm += l.qty * l.lengthMm;
    else total.totalAreaMm2 += l.qty * l.lengthMm * l.widthMm;
  }
  return [...byType.values()];
}
