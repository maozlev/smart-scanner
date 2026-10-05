// Copies the runtime files the browser loads by URL into public/vendor: pdf.js and its
// worker, the ONNX runtime and its WebAssembly binary, and the OCR model with its dictionary.
// They are loaded at scan time instead of bundled, so the bundler never has to understand
// them. Runs before `dev` and `build`; public/vendor is generated and not committed.
import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const files = [
  ['node_modules/pdfjs-dist/build/pdf.min.mjs', 'pdf.min.mjs'],
  ['node_modules/pdfjs-dist/build/pdf.worker.min.mjs', 'pdf.worker.min.mjs'],
  ['node_modules/onnxruntime-web/dist/ort.wasm.min.mjs', 'ort/ort.wasm.min.mjs'],
  ['node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.mjs', 'ort/ort-wasm-simd-threaded.mjs'],
  ['node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.wasm', 'ort/ort-wasm-simd-threaded.wasm'],
  ['models/ch_PP-OCRv4_rec_infer.onnx', 'ocr/rec.onnx'],
  ['models/ppocr_keys.txt', 'ocr/keys.txt'],
];
for (const [from, to] of files) {
  const target = join(root, 'public', 'vendor', to);
  mkdirSync(dirname(target), { recursive: true });
  copyFileSync(join(root, from), target);
}
console.log(`copied ${files.length} runtime files to public/vendor`);
