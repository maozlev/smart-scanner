// Scores the browser-side pipeline against the same ground truth the Python
// harness uses (server/tools/eval_tables.py). Usage: node run.mjs [growPx] [--dump]
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import * as ort from "onnxruntime-web";
import { extractPaths, detectGrids, TableImage, Recognizer, ocrCell, fixHomoglyphs } from "./lib.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = join(here, "..", "fixtures", "tables");
const models = join(here, "..", "models");
const growPx = Number(process.argv[2] ?? 1);
const dump = process.argv.includes("--dump");
const OCR_DPI = 864;

const norm = (t) => fixHomoglyphs(t ?? "").replaceAll(" ", "").replaceAll(",", "").toLowerCase();

function iou(a, b) {
  const ix0 = Math.max(a[0], b[0]), iy0 = Math.max(a[1], b[1]);
  const ix1 = Math.min(a[2], b[2]), iy1 = Math.min(a[3], b[3]);
  if (ix1 <= ix0 || iy1 <= iy0) return 0;
  const inter = (ix1 - ix0) * (iy1 - iy0);
  return inter / ((a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - inter);
}

function writePgm(path, img) {
  writeFileSync(path, Buffer.concat([Buffer.from(`P5\n${img.w} ${img.h}\n255\n`), Buffer.from(img.data)]));
}

ort.env.wasm.numThreads = 1;
const session = await ort.InferenceSession.create(readFileSync(join(models, "ch_PP-OCRv4_rec_infer.onnx")));
const chars = readFileSync(join(models, "ppocr_keys.txt"), "utf8").split(/\r?\n/);
const rec = new Recognizer(ort, session, chars);

const grand = { cells: 0, correct: 0, wrongLowConf: 0, wrongConfident: 0 };
for (const name of readdirSync(fixtures).filter((f) => f.endsWith(".json"))) {
  const gt = JSON.parse(readFileSync(join(fixtures, name), "utf8"));
  const pdf = join(fixtures, name.replace(/\.json$/, ".pdf"));
  let t0 = performance.now();
  const doc = await pdfjs.getDocument({ data: new Uint8Array(readFileSync(pdf)), verbosity: 0 }).promise;
  const page = await doc.getPage(1);
  const vp = page.getViewport({ scale: 1 });
  const paths = await extractPaths(page);
  const tPaths = performance.now() - t0;
  t0 = performance.now();
  const grids = detectGrids(paths);
  const tGrid = performance.now() - t0;
  console.log(`\n${name}: ${paths.length} paths (${tPaths.toFixed(0)} ms), ${grids.length} grids (${tGrid.toFixed(0)} ms)`);

  for (const expected of gt.tables) {
    const grid = grids.reduce((best, g) => (iou(g.bbox, expected.bbox) > iou(best.bbox, expected.bbox) ? g : best), grids[0]);
    const match = grid ? iou(grid.bbox, expected.bbox) : 0;
    console.log(
      `  ${expected.name}: expected ${expected.rows}x${expected.cols}, best grid ${grid?.nRows}x${grid?.nCols}, IoU ${match.toFixed(3)}`,
    );
    if (!expected.cells || match < 0.8) continue;

    t0 = performance.now();
    const image = new TableImage(paths, grid, vp.width, vp.height, OCR_DPI, growPx);
    const tRaster = performance.now() - t0;
    if (dump) {
      mkdirSync(join(here, "out"), { recursive: true });
      for (const [r, c] of [[0, 0], [0, 2], [0, 3], [0, 4], [29, 5]]) writePgm(join(here, "out", `cell-r${r}-c${c}.pgm`), image.cell(r, c));
    }
    t0 = performance.now();
    const perRole = {};
    for (let r = 0; r < expected.cells.length; r++) {
      for (let c = 0; c < expected.column_roles.length; c++) {
        const role = expected.column_roles[c];
        const read = await ocrCell(rec, image.cell(r, c));
        const got = norm(read.value), want = norm(expected.cells[r][c]);
        const bucket = (perRole[role] ??= [0, 0]);
        bucket[0]++; grand.cells++;
        if (got === want) { bucket[1]++; grand.correct++; }
        else {
          const confident = read.conf >= 0.85;
          confident ? grand.wrongConfident++ : grand.wrongLowConf++;
          console.log(`    WRONG r${r} ${role}: got ${JSON.stringify(read.value)} want ${JSON.stringify(expected.cells[r][c])} conf ${read.conf.toFixed(2)}`);
        }
      }
    }
    const tOcr = performance.now() - t0;
    console.log(`  image ${image.w}x${image.h} px, raster ${tRaster.toFixed(0)} ms, OCR ${tOcr.toFixed(0)} ms`);
    for (const [role, [total, correct]] of Object.entries(perRole).sort()) console.log(`    ${role.padEnd(14)} ${correct}/${total}`);
  }
}
console.log("\n=== grand total ===");
console.log(`cells ${grand.cells}, correct ${grand.correct}`);
console.log(`wrong, OCR confidence < 0.85 (flagged): ${grand.wrongLowConf}`);
console.log(`wrong, OCR confidence >= 0.85 (needs the arithmetic check to flag): ${grand.wrongConfident}`);
