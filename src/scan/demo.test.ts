// The whole pipeline on the demo drawing, a synthetic sheet that IS in the repository
// (scripts/make-demo.mjs draws it from demo-table.json), so this runs anywhere.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as ort from 'onnxruntime-web';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { expect, it } from 'vitest';
import { cutListTable, isComplete } from './cutlist';
import demo from './demo-table.json';
import { Recognizer, type OrtLike, type OrtSessionLike } from './ocr';
import { extractPaths, type PdfOps, type PdfPageLike } from './paths';
import { scanPage } from './table';

const root = join(__dirname, '..', '..');

it('demo drawing: every row is read, approved, and comes out as the expected cut list', async () => {
  ort.env.wasm.numThreads = 1;
  const session = await ort.InferenceSession.create(readFileSync(join(root, 'models', 'ch_PP-OCRv4_rec_infer.onnx')));
  const rec = new Recognizer(ort as unknown as OrtLike, session as unknown as OrtSessionLike, readFileSync(join(root, 'models', 'ppocr_keys.txt'), 'utf8'));
  const doc = await pdfjs.getDocument({ data: new Uint8Array(readFileSync(join(root, 'public', 'demo', 'demo-drawing.pdf'))), verbosity: 0 }).promise;
  const page = await doc.getPage(1);
  const viewport = page.getViewport({ scale: 1 });
  const paths = await extractPaths(page as unknown as PdfPageLike, pdfjs.OPS as unknown as PdfOps);
  const { tables } = await scanPage(rec, paths, viewport.width, viewport.height);

  const materials = tables.filter((t) => t.kind === 'materials');
  expect(materials).toHaveLength(1);
  const table = materials[0]!;
  expect(table.roles).toEqual(['item_no', 'qty', 'description', 'unit_length', 'total_length', 'total_weight']);
  expect(table.declaredTotalWeightKg).toBe(demo.totalWeightKg);
  expect(table.weightTotalMatches).toBe(true);
  expect(table.rows.filter((row) => !row.autoApproved).map((row) => `${row.rowIndex}: ${row.flags.join(',')}`)).toEqual([]);
  const lines = table.rows.map((row) => row.line);
  expect(cutListTable(lines.filter(isComplete)).slice(1)).toEqual(demo.cutList);
  // the title block is on the sheet too, and is not offered as a table
  expect(tables.filter((t) => t.kind === 'unknown')).toEqual([]);
}, 120_000);
