// The accuracy gate: the whole pipeline against real sheets with confirmed answers.
// fixtures/ holds customer drawings and is not in the repository, so the suite skips
// itself where the folder is absent.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import * as ort from 'onnxruntime-web';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { beforeAll, describe, expect, it } from 'vitest';
import { cutListTable, isComplete, toCsv } from './cutlist';
import { fixHomoglyphs } from './normalize';
import { Recognizer, type OrtLike, type OrtSessionLike } from './ocr';
import { extractPaths, type PdfOps, type PdfPageLike } from './paths';
import { scanPage, type PageScan } from './table';

const root = join(__dirname, '..', '..');
const fixtures = join(root, 'fixtures', 'tables');
const available = existsSync(join(fixtures, 'NCD5168[_EN](5).pdf'));

interface GroundTruth {
  tables: { name: string; rows: number; cols: number; bbox: [number, number, number, number]; cells?: string[][]; declared_total_weight_kg?: number }[];
}

const norm = (text: string | null) => fixHomoglyphs(text ?? '').replaceAll(' ', '').replaceAll(',', '').toLowerCase();

let rec: Recognizer;

async function scan(name: string): Promise<PageScan> {
  const doc = await pdfjs.getDocument({ data: new Uint8Array(readFileSync(join(fixtures, `${name}.pdf`))), verbosity: 0 }).promise;
  const page = await doc.getPage(1);
  const viewport = page.getViewport({ scale: 1 });
  const paths = await extractPaths(page as unknown as PdfPageLike, pdfjs.OPS as unknown as PdfOps);
  return scanPage(rec, paths, viewport.width, viewport.height);
}

describe.skipIf(!available)('real sheets', () => {
  beforeAll(async () => {
    ort.env.wasm.numThreads = 1;
    const session = await ort.InferenceSession.create(readFileSync(join(root, 'models', 'ch_PP-OCRv4_rec_infer.onnx')));
    rec = new Recognizer(ort as unknown as OrtLike, session as unknown as OrtSessionLike, readFileSync(join(root, 'models', 'ppocr_keys.txt'), 'utf8'));
  });

  it('NCD5168: every cell, every row decision, the grand total and the cut list', async () => {
    const gt = JSON.parse(readFileSync(join(fixtures, 'NCD5168[_EN](5).json'), 'utf8')) as GroundTruth;
    const expected = gt.tables[0]!;
    const { tables } = await scan('NCD5168[_EN](5)');

    const materials = tables.filter((t) => t.kind === 'materials');
    expect(materials).toHaveLength(1);
    const table = materials[0]!;
    expect([table.nRows, table.nCols]).toEqual([expected.rows, expected.cols]);
    expect(table.roles).toEqual(['item_no', 'qty', 'description', 'unit_length', 'total_length', 'total_weight', 'other']);
    expect(table.rows).toHaveLength(30);

    const wrong: string[] = [];
    table.rows.forEach((row, r) =>
      row.cells.forEach((cell, c) => {
        if (norm(cell.value) !== norm(expected.cells![r]![c]!)) wrong.push(`r${r} c${c}: ${cell.value} != ${expected.cells![r]![c]}`);
      }),
    );
    expect(wrong).toEqual([]);

    expect(table.declaredTotalWeightKg).toBe(3814.4);
    expect(table.weightTotalMatches).toBe(true);
    expect(table.rows.filter((row) => !row.autoApproved).map((row) => `${row.rowIndex}: ${row.flags.join(',')}`)).toEqual([]);

    const lines = table.rows.map((row) => row.line);
    expect(lines.every(isComplete)).toBe(true);
    expect(lines[2]).toEqual({ type: 'L60X60X6', label: '828 Horizontal', lengthMm: 1052, widthMm: null, qty: 4 });
    expect(lines[1]).toEqual({ type: 'פלטה 14 מ"מ', label: '829 Connection Plate THK 14 mm', lengthMm: 450, widthMm: 174, qty: 8 });
    expect(lines[28]).toEqual({ type: 'L160X160X15', label: '802 Leg', lengthMm: 9000, widthMm: null, qty: 2 });
    expect(new Set(lines.map((l) => l.type))).toEqual(
      new Set(['L60X60X6', 'L70X70X7', 'L80X80X8', 'L90X90X9', 'L120X120X11', 'L160X160X15', 'פלטה 6 מ"מ', 'פלטה 12 מ"מ', 'פלטה 14 מ"מ', 'פלטה 16 מ"מ']),
    );

    // handed to the nesting calculator's own importer by a check that lives outside this repo
    if (process.env.CUT_LIST_OUT) writeFileSync(process.env.CUT_LIST_OUT, toCsv(cutListTable(lines.filter(isComplete))));
  });

  it('833.1-01-20: a Hebrew sheet invents no materials table, and its tables are not lost', async () => {
    const { tables } = await scan('833.1-01-20');
    expect(tables.filter((t) => t.kind === 'materials')).toEqual([]);
    // the pile schedule cannot be read without Hebrew OCR; it must reach the operator
    const pile = tables.find((t) => t.nRows === 12 && t.nCols === 7);
    expect(pile?.kind).toBe('unknown');
  });
});
