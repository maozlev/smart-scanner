import { describe, expect, it } from 'vitest';
import { cutListTable, isComplete, totalsByType } from '@/scan/cutlist';
import type { CutLine } from '@/scan/table';
import { ARCHIVE_LIMIT, combineEntries, combinedFiles, combinedName, defaultName, restoreTables, upsertEntry, type ArchiveEntry } from './archive';
import { includedLines } from './review';
import type { ReviewRow, ReviewTable, RowDecision } from './scanner';

const row = (id: string, line: CutLine, decision: RowDecision = 'auto'): ReviewRow => ({ id, line, flags: [], decision });
const bar = (type: string, label: string, lengthMm: number | null, qty: number | null): CutLine => ({ type, label, lengthMm, widthMm: null, qty });

function table(id: string, fileName: string, rows: ReviewRow[], kind: 'materials' | 'unknown' = 'materials'): ReviewTable {
  return { id, fileName, pageNumber: 1, kind, unreadable: false, rows, declaredTotalWeightKg: null, weightTotalMatches: null, image: 'data:image/png;base64,AAAA', size: '', raw: null, mapping: null };
}

const NOW = new Date('2026-10-05T10:00:00Z');
const LATER = new Date('2026-10-05T11:00:00Z');

const towerTables = [
  table('t1', 'tower.pdf', [
    row('a', bar('L60X60X6', '828 Horizontal', 1052, 4)),
    row('b', bar('L60X60X6', '827 Horizontal', 743, 8)),
    row('c', bar('L70X70X7', '822 Horizontal', null, 4), 'pending'),
    row('d', bar('L90X90X9', '808 Diagonal', 5931, 4), 'rejected'),
  ]),
  table('t2', 'tower.pdf', [], 'unknown'),
];
const fenceTables = [table('f1', 'fence.pdf', [row('x', bar('L60X60X6', 'post', 2400, 10)), row('y', bar('RHS 40X40X3', 'rail', 1800, 6), 'approved')])];

const tower = () => upsertEntry([], { id: 'tower', name: 'tower', files: ['tower.pdf'], tables: towerTables }, NOW);
const both = () => upsertEntry(tower(), { id: 'fence', name: 'fence', files: ['fence.pdf'], tables: fenceTables }, LATER);

describe('archive', () => {
  it('stores the reviewed rows and the headline figures, without the drawing strips', () => {
    const [entry] = tower() as [ArchiveEntry];
    expect(entry.summary).toEqual({ lineCount: 2, pieceCount: 12, pendingCount: 1, unmappedTables: 1 });
    expect(entry.tables).toHaveLength(1);
    expect(entry.tables[0]!.rows.map((r) => r.decision)).toEqual(['auto', 'auto', 'pending', 'rejected']);
    expect(JSON.stringify(entry)).not.toContain('data:image');
  });

  it('refreshes an entry instead of adding a twin, and keeps a name the user gave it', () => {
    const renamed = tower().map((e) => ({ ...e, name: 'מגדל 12' }));
    const approved = towerTables.map((t) => ({ ...t, rows: t.rows.map((r) => (r.id === 'c' ? { ...r, decision: 'approved' as const, line: { ...r.line, lengthMm: 3099 } } : r)) }));
    const next = upsertEntry(renamed, { id: 'tower', name: 'tower', files: ['tower.pdf'], tables: approved }, LATER);
    expect(next).toHaveLength(1);
    expect(next[0]!.name).toBe('מגדל 12');
    expect(next[0]!.savedAt).toBe(LATER.toISOString());
    expect(next[0]!.summary).toMatchObject({ lineCount: 3, pieceCount: 16, pendingCount: 0 });
  });

  it('does not store a scan that produced no rows', () => {
    expect(upsertEntry([], { id: 'x', name: 'x', files: ['x.pdf'], tables: [table('u', 'x.pdf', [], 'unknown')] }, NOW)).toEqual([]);
  });

  it('puts the newest first and drops the oldest past the limit', () => {
    let entries: ArchiveEntry[] = [];
    for (let i = 0; i < ARCHIVE_LIMIT + 3; i++) entries = upsertEntry(entries, { id: `s${i}`, name: `s${i}`, files: [], tables: fenceTables }, NOW);
    expect(entries).toHaveLength(ARCHIVE_LIMIT);
    expect(entries[0]!.id).toBe(`s${ARCHIVE_LIMIT + 2}`);
    expect(entries.some((e) => e.id === 's0')).toBe(false);
  });

  it('restores the rows with their decisions', () => {
    const restored = restoreTables(tower()[0]!);
    expect(includedLines(restored)).toEqual([bar('L60X60X6', '828 Horizontal', 1052, 4), bar('L60X60X6', '827 Horizontal', 743, 8)]);
    expect(restored[0]!.rows.map((r) => r.decision)).toEqual(['auto', 'auto', 'pending', 'rejected']);
    expect(new Set(restored.flatMap((t) => t.rows.map((r) => r.id))).size).toBe(4);
  });

  it('names a scan after its files', () => {
    expect(defaultName(['a.pdf', 'b.PDF'])).toBe('a, b');
    expect(defaultName(['a.pdf', 'b.pdf', 'c.pdf', 'd.pdf', 'e.pdf'])).toBe('a, b, c ועוד 2');
  });
});

describe('migration', () => {
  const entries = () => [...both()].reverse(); // tower, then fence

  it('merged: the same material from two scans is cut together', () => {
    const lines = includedLines(combineEntries(entries(), 'merged', 'm'));
    expect(lines).toHaveLength(4);
    expect(totalsByType(lines).map((t) => [t.type, t.pieces, t.totalLengthMm])).toEqual([
      ['L60X60X6', 22, 4 * 1052 + 8 * 743 + 10 * 2400],
      ['RHS 40X40X3', 6, 6 * 1800],
    ]);
  });

  it('separate: every scan keeps its own materials', () => {
    const lines = includedLines(combineEntries(entries(), 'separate', 'm'));
    expect(totalsByType(lines).map((t) => [t.type, t.pieces])).toEqual([
      ['L60X60X6 · tower', 12],
      ['L60X60X6 · fence', 10],
      ['RHS 40X40X3 · fence', 6],
    ]);
    expect(cutListTable(lines.filter(isComplete))[1]).toEqual(['L60X60X6 · tower', '828 Horizontal', '1052', '', '4']);
  });

  it('carries rows that were not approved without approving them', () => {
    const tables = combineEntries(entries(), 'merged', 'm');
    const all = tables.flatMap((t) => t.rows);
    expect(all).toHaveLength(6);
    expect(all.filter((r) => r.decision === 'pending')).toHaveLength(1);
    expect(all.filter((r) => r.decision === 'rejected')).toHaveLength(1);
  });

  it('gives every row a fresh id, even when a scan is combined with itself', () => {
    const [entry] = tower() as [ArchiveEntry];
    const ids = combineEntries([entry, entry], 'merged', 'm').flatMap((t) => t.rows.map((r) => r.id));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('names the result and lists its files once', () => {
    expect(combinedName(entries(), 'merged')).toBe('איחוד: tower + fence');
    expect(combinedName(entries(), 'separate')).toBe('סיכום משולב: tower + fence');
    expect(combinedFiles([...entries(), ...entries()])).toEqual(['tower.pdf', 'fence.pdf']);
  });
});
