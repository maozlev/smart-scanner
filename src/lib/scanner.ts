// Runs the scan engine in the browser: loads pdf.js, the ONNX runtime and the OCR model from
// /vendor on first use, then turns each PDF into reviewable rows.
import type { ManualMapping } from '@/scan/manual';
import { Recognizer, type CellRead, type OrtLike, type OrtSessionLike } from '@/scan/ocr';
import { extractPaths, type PdfOps, type PdfPageLike } from '@/scan/paths';
import type { GrayImage } from '@/scan/raster';
import { scanPage, type CutLine, type ScannedTable } from '@/scan/table';
import type { RowFlag } from '@/scan/validate';

export type RowDecision = 'auto' | 'pending' | 'approved' | 'rejected';

export interface ReviewRow {
  id: string;
  line: CutLine;
  flags: RowFlag[];
  decision: RowDecision;
}

export interface ReviewTable {
  id: string;
  fileName: string;
  pageNumber: number;
  kind: 'materials' | 'unknown';
  // unknown tables only: true when the header ink could not be read at all, false when it
  // was read and simply names no length or profile column
  unreadable: boolean;
  rows: ReviewRow[];
  declaredTotalWeightKg: number | null;
  weightTotalMatches: boolean | null;
  image: string | null; // the whole grid as drawn on the sheet; null for a scan restored from the archive
  size: string; // rows x columns, for telling unknown tables apart
  // tables the scanner did not understand: every cell as read, for the operator to map
  raw: { cells: CellRead[][] } | null;
  mapping: ManualMapping | null; // set once the operator has mapped the columns
}

export interface FileReport {
  fileName: string;
  pages: number;
  gridsFound: number;
  error: string | null;
}

export interface ScanProgress {
  stage: 'loading' | 'scanning';
  fileName: string;
  fileIndex: number;
  fileCount: number;
  rowsRead: number;
}

interface PdfJs {
  OPS: PdfOps;
  GlobalWorkerOptions: { workerSrc: string };
  getDocument(source: { data: Uint8Array }): {
    promise: Promise<{ numPages: number; getPage(n: number): Promise<PdfPageLike> }>;
    destroy(): Promise<void>; // the loading task releases the document, not the document itself
  };
}
interface Ort extends OrtLike {
  env: { wasm: { wasmPaths: string; numThreads: number; proxy: boolean } };
  InferenceSession: { create(model: ArrayBuffer): Promise<OrtSessionLike> };
}

interface Runtime {
  pdfjs: PdfJs;
  rec: Recognizer;
}
let runtime: Promise<Runtime> | null = null;

const OCR_THREADS = Number(process.env.NEXT_PUBLIC_OCR_THREADS ?? 4);
const OCR_PROXY = process.env.NEXT_PUBLIC_OCR_PROXY !== '0';

// Loaded by URL so the bundler does not try to package WebAssembly glue and a 10 MB model.
const load = (url: string) => import(/* webpackIgnore: true */ /* turbopackIgnore: true */ url);

async function fetchOk(url: string): Promise<Response> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`טעינת ${url} נכשלה (${response.status})`);
  return response;
}

function loadRuntime(): Promise<Runtime> {
  runtime ??= (async () => {
    const [pdfjs, ort, model, keys] = await Promise.all([
      load('/vendor/pdf.min.mjs') as Promise<PdfJs>,
      load('/vendor/ort/ort.wasm.min.mjs') as Promise<Ort>,
      fetchOk('/vendor/ocr/rec.onnx').then((r) => r.arrayBuffer()),
      fetchOk('/vendor/ocr/keys.txt').then((r) => r.text()),
    ]);
    pdfjs.GlobalWorkerOptions.workerSrc = '/vendor/pdf.worker.min.mjs';
    ort.env.wasm.wasmPaths = '/vendor/ort/';
    // Threads need SharedArrayBuffer, which the browser grants only to a cross-origin isolated
    // page (the headers in next.config.ts). Without it the recognizer runs on one core.
    ort.env.wasm.numThreads = globalThis.crossOriginIsolated ? Math.min(OCR_THREADS, navigator.hardwareConcurrency || 1) : 1;
    // The runtime lives in its own worker. On the page's thread a multi-threaded run blocks
    // the page while it waits for its helpers, and under load that wait was seen to stall a
    // scan for minutes; a worker may block freely, and the page stays responsive.
    ort.env.wasm.proxy = OCR_PROXY;
    const session = await ort.InferenceSession.create(model);
    return { pdfjs, rec: new Recognizer(ort, session, keys) };
  })();
  // a failed load must not be cached: the next scan tries again
  runtime.catch(() => {
    runtime = null;
  });
  return runtime;
}

function toDataUrl(img: GrayImage): string {
  const canvas = document.createElement('canvas');
  canvas.width = img.w;
  canvas.height = img.h;
  const ctx = canvas.getContext('2d');
  if (!ctx || img.w === 0 || img.h === 0) return '';
  const rgba = ctx.createImageData(img.w, img.h);
  for (let i = 0; i < img.data.length; i++) {
    const v = img.data[i]!;
    rgba.data[4 * i] = v;
    rgba.data[4 * i + 1] = v;
    rgba.data[4 * i + 2] = v;
    rgba.data[4 * i + 3] = 255;
  }
  ctx.putImageData(rgba, 0, 0);
  return canvas.toDataURL('image/png');
}

function toReview(table: ScannedTable, fileName: string, pageNumber: number, index: number): ReviewTable {
  const id = `${fileName}#${pageNumber}#${index}`;
  return {
    id,
    fileName,
    pageNumber,
    kind: table.kind,
    unreadable: table.reason === 'unreadable_ink',
    rows: table.rows.map((row) => ({
      id: `${id}#${row.rowIndex}`,
      line: row.line,
      flags: row.flags,
      decision: row.autoApproved ? 'auto' : 'pending',
    })),
    declaredTotalWeightKg: table.declaredTotalWeightKg,
    weightTotalMatches: table.weightTotalMatches,
    image: toDataUrl(table.preview),
    size: `${table.nRows}×${table.nCols}`,
    raw: table.raw ? { cells: table.raw.cells } : null,
    mapping: null,
  };
}

// lets the browser paint progress between rows; the OCR itself runs on this thread
const breathe = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

export async function scanFiles(
  files: File[],
  onProgress: (progress: ScanProgress) => void,
): Promise<{ tables: ReviewTable[]; reports: FileReport[] }> {
  const tables: ReviewTable[] = [];
  const reports: FileReport[] = [];
  let rowsRead = 0;
  const report = (stage: ScanProgress['stage'], fileIndex: number) =>
    onProgress({ stage, fileName: files[fileIndex]?.name ?? '', fileIndex, fileCount: files.length, rowsRead });

  report('loading', 0);
  const { pdfjs, rec } = await loadRuntime();

  for (const [fileIndex, file] of files.entries()) {
    report('scanning', fileIndex);
    await breathe();
    const fileReport: FileReport = { fileName: file.name, pages: 0, gridsFound: 0, error: null };
    reports.push(fileReport);
    const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
    try {
      const doc = await task.promise;
      fileReport.pages = doc.numPages;
      for (let n = 1; n <= doc.numPages; n++) {
        const page = await doc.getPage(n);
        const viewport = page.getViewport({ scale: 1 });
        const paths = await extractPaths(page, pdfjs.OPS);
        const scan = await scanPage(rec, paths, viewport.width, viewport.height, async () => {
          rowsRead++;
          report('scanning', fileIndex);
          await breathe();
        });
        fileReport.gridsFound += scan.gridsFound;
        for (const table of scan.tables) tables.push(toReview(table, file.name, n, tables.length));
      }
    } catch (error) {
      fileReport.error = error instanceof Error ? error.message : String(error);
    } finally {
      await task.destroy().catch(() => {});
    }
  }
  return { tables, reports };
}
