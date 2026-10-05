// Recognition-only OCR on ink-cropped cells: RapidOCR's PP-OCRv4 recognizer with its
// preprocessing ported. Detection is deliberately absent; on sparse letter-spaced digits in a
// big white cell it fragments the text ("9000" -> "9").
import { inkCrop, resizeLinear, splitLines, type GrayImage } from './raster';

// the slice of onnxruntime this module touches; the caller supplies the runtime
export interface OrtLike {
  Tensor: new (type: 'float32', data: Float32Array, dims: number[]) => unknown;
}
export interface OrtSessionLike {
  inputNames: readonly string[];
  outputNames: readonly string[];
  run(feeds: Record<string, unknown>): Promise<Record<string, { dims: readonly number[]; data: unknown }>>;
}

export interface CellRead {
  value: string | null; // null: there is ink the OCR could not read
  conf: number;
  source: 'ocr' | 'empty' | 'manual';
}

const MAX_SIDE = 2000, MIN_SIDE = 30, REC_H = 48, REC_W = 320;
const EMPTY_CONF = 0.99;
const round32 = (v: number) => Math.round(v / 32) * 32;

// RapidOCR.preprocess: clamp the crop's sides before recognition
function clampSides(input: GrayImage): GrayImage | null {
  let img = input;
  if (Math.max(img.w, img.h) > MAX_SIDE) {
    const ratio = MAX_SIDE / Math.max(img.w, img.h);
    const w = round32(Math.trunc(img.w * ratio)), h = round32(Math.trunc(img.h * ratio));
    if (w <= 0 || h <= 0) return null;
    img = resizeLinear(img, w, h);
  }
  if (Math.min(img.w, img.h) < MIN_SIDE) {
    const ratio = MIN_SIDE / Math.min(img.w, img.h);
    const w = round32(Math.trunc(img.w * ratio)), h = round32(Math.trunc(img.h * ratio));
    if (w <= 0 || h <= 0) return null;
    img = resizeLinear(img, w, h);
  }
  return img;
}

export class Recognizer {
  private readonly chars: string[];

  constructor(
    private readonly ort: OrtLike,
    private readonly session: OrtSessionLike,
    dictionary: string,
  ) {
    this.chars = ['', ...dictionary.split(/\r?\n/), ' ']; // index 0 is the CTC blank
  }

  async read(input: GrayImage): Promise<{ text: string; conf: number } | null> {
    if (input.h < 8 || input.w < 8) return null;
    const img = clampSides(input);
    if (!img) return null;
    const ratio = img.w / img.h;
    const width = Math.trunc(REC_H * Math.max(REC_W / REC_H, ratio));
    const resizedW = Math.min(Math.ceil(REC_H * ratio), width);
    const small = resizeLinear(img, resizedW, REC_H);
    const plane = REC_H * width;
    const tensor = new Float32Array(3 * plane);
    for (let y = 0; y < REC_H; y++)
      for (let x = 0; x < resizedW; x++) {
        const v = (small.data[y * resizedW + x]! / 255 - 0.5) / 0.5;
        const at = y * width + x;
        tensor[at] = v;
        tensor[plane + at] = v;
        tensor[2 * plane + at] = v;
      }
    const result = await this.session.run({ [this.session.inputNames[0]!]: new this.ort.Tensor('float32', tensor, [1, 3, REC_H, width]) });
    const out = result[this.session.outputNames[0]!]!;
    const probs = out.data as Float32Array;
    const steps = out.dims[1]!, classes = out.dims[2]!;
    let text = '', confSum = 0, kept = 0, prev = -1;
    for (let t = 0; t < steps; t++) {
      let best = 0, bestP = -1;
      const base = t * classes;
      for (let c = 0; c < classes; c++) {
        const p = probs[base + c]!;
        if (p > bestP) {
          bestP = p;
          best = c;
        }
      }
      if (best !== 0 && best !== prev) {
        text += this.chars[best] ?? '';
        confSum += bestP;
        kept++;
      }
      prev = best;
    }
    text = text.trim();
    return text ? { text, conf: confSum / kept } : null;
  }
}

export async function ocrCell(rec: Recognizer, img: GrayImage): Promise<CellRead> {
  const cropped = inkCrop(img);
  if (!cropped) return { value: '', conf: EMPTY_CONF, source: 'empty' };
  const texts: string[] = [];
  const confs: number[] = [];
  for (const line of splitLines(cropped)) {
    const lineCrop = inkCrop(line);
    if (!lineCrop) continue;
    const read = await rec.read(lineCrop);
    if (read) {
      texts.push(read.text);
      confs.push(read.conf);
    }
  }
  // ink is there but the OCR saw nothing: a zero-confidence read, not an empty cell
  if (texts.length === 0) return { value: null, conf: 0, source: 'ocr' };
  return { value: texts.join(' '), conf: Math.min(...confs), source: 'ocr' };
}

/** Line texts from an arbitrary region, e.g. the "Total Weight" note beside a table. */
export async function readLines(rec: Recognizer, img: GrayImage): Promise<string[]> {
  const cropped = inkCrop(img);
  if (!cropped) return [];
  const out: string[] = [];
  for (const line of splitLines(cropped)) {
    const lineCrop = inkCrop(line);
    const read = lineCrop ? await rec.read(lineCrop) : null;
    if (read) out.push(read.text);
  }
  return out;
}
