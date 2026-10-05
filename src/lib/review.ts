// What the review screen decides and what the output contains. The rule: only a row a check
// or a person approved, and that is whole, reaches the cut list.
import { isComplete, type CompleteLine } from '@/scan/cutlist';
import type { CutLine } from '@/scan/table';
import type { RowFlag } from '@/scan/validate';
import type { ReviewRow, ReviewTable } from './scanner';

export const FLAG_TEXT: Record<RowFlag, string> = {
  qty_missing: 'הכמות לא נקראה',
  qty_not_positive: 'הכמות אינה חיובית',
  qty_not_integer: 'הכמות אינה מספר שלם',
  value_not_positive: 'ערך שאינו חיובי',
  qty_x_unit_length_mismatch: 'כמות × אורך יחידה לא שווה לאורך הכולל שבטבלה',
  qty_x_unit_weight_mismatch: 'כמות × משקל יחידה לא שווה למשקל הכולל שבטבלה',
  area_x_thk_weight_mismatch: 'שטח × עובי לא מתאים למשקל שבטבלה',
  area_exceeds_qty_x_bounding_rect: 'השטח גדול ממה שהמידות והכמות מאפשרות',
  low_confidence: 'הקריאה לא ודאית',
  unread_cell: 'תא שלא נקרא',
  no_size: 'המידה לא נקראה',
  no_material: 'סוג החומר לא זוהה',
};

export const isIncluded = (row: ReviewRow) => (row.decision === 'auto' || row.decision === 'approved') && isComplete(row.line);

export function includedLines(tables: ReviewTable[]): CompleteLine[] {
  return tables.flatMap((t) => t.rows.filter(isIncluded).map((r) => r.line as CompleteLine));
}

export interface ReviewCounts {
  included: number;
  pending: number;
  rejected: number;
  unreadableTables: number; // might be a cut list we could not read
  otherTables: number; // read, and not a cut list
}

export function countRows(tables: ReviewTable[]): ReviewCounts {
  const rows = tables.flatMap((t) => t.rows);
  const included = rows.filter(isIncluded).length;
  const rejected = rows.filter((r) => r.decision === 'rejected').length;
  return {
    included,
    rejected,
    pending: rows.length - included - rejected,
    unreadableTables: tables.filter((t) => t.kind === 'unknown' && t.unreadable).length,
    otherTables: tables.filter((t) => t.kind === 'unknown' && !t.unreadable).length,
  };
}

/** An edit is a person taking responsibility for the row: it counts as approved once whole. */
export function editRow(row: ReviewRow, line: CutLine): ReviewRow {
  return { ...row, line, decision: isComplete(line) ? 'approved' : 'pending' };
}

export function updateRow(tables: ReviewTable[], rowId: string, change: (row: ReviewRow) => ReviewRow): ReviewTable[] {
  return tables.map((t) => (t.rows.some((r) => r.id === rowId) ? { ...t, rows: t.rows.map((r) => (r.id === rowId ? change(r) : r)) } : t));
}
