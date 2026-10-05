// History of scans, kept in the browser, and migrations that build one cut list out of
// several of them. An entry stores the reviewed rows; the drawing strips and the tables that
// were never mapped are not stored, so a restored scan shows values without their evidence.
import type { CutLine } from '@/scan/table';
import type { RowFlag } from '@/scan/validate';
import { isIncluded } from './review';
import type { ReviewRow, ReviewTable, RowDecision } from './scanner';

export interface ArchivedRow {
  line: CutLine;
  flags: RowFlag[];
  decision: RowDecision;
}

export interface ArchivedTable {
  fileName: string;
  pageNumber: number;
  rows: ArchivedRow[];
}

export interface ArchiveEntry {
  id: string;
  savedAt: string; // ISO timestamp
  name: string;
  files: string[];
  tables: ArchivedTable[];
  summary: { lineCount: number; pieceCount: number; pendingCount: number; unmappedTables: number };
}

const STORAGE_KEY = 'scanner.archive';
const SCHEMA_VERSION = 1;
export const ARCHIVE_LIMIT = 50;

export function loadArchive(): ArchiveEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) return [];
    const doc = JSON.parse(raw) as { schemaVersion?: unknown; entries?: unknown };
    return doc.schemaVersion === SCHEMA_VERSION && Array.isArray(doc.entries) ? (doc.entries as ArchiveEntry[]) : [];
  } catch {
    return [];
  }
}

// Returns false when the browser refused to store it (storage full or blocked).
export function saveArchive(entries: ArchiveEntry[]): boolean {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ schemaVersion: SCHEMA_VERSION, entries }));
    return true;
  } catch {
    return false;
  }
}

export function defaultName(files: string[]): string {
  const names = files.map((f) => f.replace(/\.pdf$/i, ''));
  return names.length > 3 ? `${names.slice(0, 3).join(', ')} ועוד ${names.length - 3}` : names.join(', ');
}

/**
 * Writes the current state of a scan into the history, at the top. The same id refreshes its
 * entry (keeping a name the user gave it), so reviewing a scan does not pile up copies.
 * A scan with no row at all is not worth an entry.
 */
export function upsertEntry(
  entries: ArchiveEntry[],
  scan: { id: string; name: string; files: string[]; tables: ReviewTable[] },
  now: Date,
): ArchiveEntry[] {
  const withRows = scan.tables.filter((t) => t.kind === 'materials' && t.rows.length > 0);
  if (withRows.length === 0) return entries;
  const rows = withRows.flatMap((t) => t.rows);
  const included = rows.filter(isIncluded);
  const entry: ArchiveEntry = {
    id: scan.id,
    savedAt: now.toISOString(),
    name: entries.find((e) => e.id === scan.id)?.name ?? scan.name,
    files: scan.files,
    tables: withRows.map((t) => ({
      fileName: t.fileName,
      pageNumber: t.pageNumber,
      rows: t.rows.map((r) => ({ line: r.line, flags: r.flags, decision: r.decision })),
    })),
    summary: {
      lineCount: included.length,
      pieceCount: included.reduce((sum, r) => sum + (r.line.qty ?? 0), 0),
      pendingCount: rows.filter((r) => r.decision !== 'rejected' && !isIncluded(r)).length,
      unmappedTables: scan.tables.filter((t) => t.kind === 'unknown').length,
    },
  };
  return [entry, ...entries.filter((e) => e.id !== entry.id)].slice(0, ARCHIVE_LIMIT);
}

function toReview(table: ArchivedTable, id: string): ReviewTable {
  return {
    id,
    fileName: table.fileName,
    pageNumber: table.pageNumber,
    kind: 'materials',
    unreadable: false,
    rows: table.rows.map((r, i): ReviewRow => ({ id: `${id}#${i}`, line: r.line, flags: r.flags, decision: r.decision })),
    declaredTotalWeightKg: null,
    weightTotalMatches: null,
    image: null,
    size: '',
    raw: null,
    mapping: null,
  };
}

/** The rows of a past scan, back on the review screen. */
export function restoreTables(entry: ArchiveEntry): ReviewTable[] {
  return entry.tables.map((t, i) => toReview(t, `${entry.id}#${i}`));
}

export type CombineMode = 'merged' | 'separate';

/**
 * One workspace out of several past scans.
 *   merged:   material types are left as they are, so the nesting calculator cuts every part
 *             of one material together, whichever scan it came from. This is where material
 *             is saved.
 *   separate: every type is tagged with its scan's name, so the calculator treats each scan's
 *             materials as its own and the result only adds the scans up.
 * `newId` gives the migration its own table ids: scans restored from one another share ids.
 */
export function combineEntries(entries: ArchiveEntry[], mode: CombineMode, newId: string): ReviewTable[] {
  return entries.flatMap((entry, e) =>
    entry.tables.map((table, t) => {
      const review = toReview(table, `${newId}#${e}#${t}`);
      if (mode === 'merged') return review;
      return {
        ...review,
        rows: review.rows.map((row) => (row.line.type.trim() === '' ? row : { ...row, line: { ...row.line, type: `${row.line.type.trim()} · ${entry.name}` } })),
      };
    }),
  );
}

export function combinedName(entries: ArchiveEntry[], mode: CombineMode): string {
  return `${mode === 'merged' ? 'איחוד' : 'סיכום משולב'}: ${entries.map((e) => e.name).join(' + ')}`;
}

export function combinedFiles(entries: ArchiveEntry[]): string[] {
  return [...new Set(entries.flatMap((e) => e.files))];
}
