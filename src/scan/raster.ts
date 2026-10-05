// Draws a table's ink ourselves instead of asking a PDF renderer for it. The source tool had
// to switch MuPDF's anti-aliasing off because hairline CAD glyphs render as a faint grey the
// OCR cannot read; drawing the strokes directly gives black-on-white at any thickness.
import type { Box, TableGrid } from './grid';
import type { VectorPath } from './paths';

export interface GrayImage {
  data: Uint8Array; // 0 = ink, 255 = paper
  w: number;
  h: number;
}

const CELL_INSET_PT = 1.6; // drop rule lines + snap tolerance at the cell borders
const MAX_OCR_PX = 12000;
const INK_LEVEL = 128;
const MIN_INK_PIXELS = 12; // fewer dark pixels than this means the cell is empty
const INK_PAD_PX = 12;
const LINE_GAP_PX = 6; // blank rows separating text lines in a multi-line cell

// Each stroke is thickened by this many pixels per side before OCR. Measured on the NCD5168
// BOM at 864 dpi: 0 reads 148/210 cells, 0.5-4 reads 208-210, 2.5 reads 210/210.
export const STROKE_GROW_PX = 2.5;
export const OCR_DPI = 864;

export function crop(img: GrayImage, x0: number, y0: number, x1: number, y1: number): GrayImage {
  x1 = Math.min(x1, img.w);
  y1 = Math.min(y1, img.h);
  const w = Math.max(x1 - x0, 0), h = Math.max(y1 - y0, 0);
  const data = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) data.set(img.data.subarray((y0 + y) * img.w + x0, (y0 + y) * img.w + x1), y * w);
  return { data, w, h };
}

export class TableImage implements GrayImage {
  readonly data: Uint8Array;
  readonly w: number;
  readonly h: number;
  private readonly sx: number;
  private readonly sy: number;
  private readonly origin: [number, number];

  constructor(
    paths: VectorPath[],
    readonly grid: TableGrid,
    pageW: number,
    pageH: number,
    dpi = OCR_DPI,
    growPx = STROKE_GROW_PX,
  ) {
    const x0 = Math.max(grid.bbox[0], 0), y0 = Math.max(grid.bbox[1], 0);
    const x1 = Math.min(grid.bbox[2], pageW), y1 = Math.min(grid.bbox[3], pageH);
    const zoom = Math.min(dpi / 72, MAX_OCR_PX / Math.max(x1 - x0, y1 - y0, 1));
    this.w = Math.max(Math.round((x1 - x0) * zoom), 1);
    this.h = Math.max(Math.round((y1 - y0) * zoom), 1);
    this.sx = this.w / Math.max(x1 - x0, 1e-9);
    this.sy = this.h / Math.max(y1 - y0, 1e-9);
    this.origin = [x0, y0];
    this.data = new Uint8Array(this.w * this.h).fill(255);
    const reach = growPx / zoom + 2;
    for (const path of paths) {
      if (path.fill) this.fillPath(path);
      if (!path.stroke) continue;
      const r = Math.max(path.widthPt * zoom, 1) / 2 + growPx;
      for (const sub of path.subs) {
        const p = sub.pts;
        for (let s = 0; s + 3 < p.length; s += 2) {
          const ax = p[s]!, ay = p[s + 1]!, bx = p[s + 2]!, by = p[s + 3]!;
          if (Math.max(ax, bx) < x0 - reach || Math.min(ax, bx) > x1 + reach) continue;
          if (Math.max(ay, by) < y0 - reach || Math.min(ay, by) > y1 + reach) continue;
          this.segment(ax, ay, bx, by, r);
        }
      }
    }
  }

  private segment(ax: number, ay: number, bx: number, by: number, r: number): void {
    const [ox, oy] = this.origin;
    ax = (ax - ox) * this.sx; ay = (ay - oy) * this.sy;
    bx = (bx - ox) * this.sx; by = (by - oy) * this.sy;
    const minX = Math.max(Math.floor(Math.min(ax, bx) - r), 0);
    const maxX = Math.min(Math.ceil(Math.max(ax, bx) + r), this.w - 1);
    const minY = Math.max(Math.floor(Math.min(ay, by) - r), 0);
    const maxY = Math.min(Math.ceil(Math.max(ay, by) + r), this.h - 1);
    const dx = bx - ax, dy = by - ay;
    const len2 = dx * dx + dy * dy;
    const r2 = r * r;
    for (let y = minY; y <= maxY; y++) {
      const cy = y + 0.5 - ay;
      for (let x = minX; x <= maxX; x++) {
        const cx = x + 0.5 - ax;
        let t = len2 > 0 ? (cx * dx + cy * dy) / len2 : 0;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const ex = cx - t * dx, ey = cy - t * dy;
        if (ex * ex + ey * ey <= r2) this.data[y * this.w + x] = 0;
      }
    }
  }

  // even-odd scanline fill; enough for glyph outlines and arrowheads
  private fillPath(path: VectorPath): void {
    const [ox, oy] = this.origin;
    const edges: [number, number, number, number][] = [];
    let minY = Infinity, maxY = -Infinity;
    for (const sub of path.subs) {
      const p = sub.pts;
      const n = p.length / 2;
      if (n < 3) continue;
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        const ay = (p[2 * i + 1]! - oy) * this.sy, by = (p[2 * j + 1]! - oy) * this.sy;
        if (ay === by) continue;
        edges.push([(p[2 * i]! - ox) * this.sx, ay, (p[2 * j]! - ox) * this.sx, by]);
        minY = Math.min(minY, ay, by);
        maxY = Math.max(maxY, ay, by);
      }
    }
    if (edges.length === 0 || maxY < 0 || minY > this.h) return;
    const yStart = Math.max(Math.floor(minY), 0), yEnd = Math.min(Math.ceil(maxY), this.h - 1);
    for (let y = yStart; y <= yEnd; y++) {
      const sy = y + 0.5;
      const xs: number[] = [];
      for (const [ax, ay, bx, by] of edges) {
        if ((ay <= sy && by > sy) || (by <= sy && ay > sy)) xs.push(ax + ((sy - ay) / (by - ay)) * (bx - ax));
      }
      xs.sort((a, b) => a - b);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const from = Math.max(Math.round(xs[k]!), 0), to = Math.min(Math.round(xs[k + 1]!) - 1, this.w - 1);
        for (let x = from; x <= to; x++) this.data[y * this.w + x] = 0;
      }
    }
  }

  /** A region given in page points. */
  region(box: Box): GrayImage {
    const [ox, oy] = this.origin;
    const px0 = Math.max(Math.trunc((box[0] - ox) * this.sx), 0);
    const py0 = Math.max(Math.trunc((box[1] - oy) * this.sy), 0);
    const px1 = Math.min(Math.trunc((box[2] - ox) * this.sx), this.w);
    const py1 = Math.min(Math.trunc((box[3] - oy) * this.sy), this.h);
    if (px1 <= px0 || py1 <= py0) return { data: new Uint8Array(0), w: 0, h: 0 };
    return crop(this, px0, py0, px1, py1);
  }

  cell(row: number, col: number): GrayImage {
    const g = this.grid;
    return this.region([
      g.colEdges[col]! + CELL_INSET_PT,
      g.rowEdges[row]! + CELL_INSET_PT,
      g.colEdges[col + 1]! - CELL_INSET_PT,
      g.rowEdges[row + 1]! - CELL_INSET_PT,
    ]);
  }

  /** One whole row, rule lines included, for the operator to compare against. */
  row(row: number): GrayImage {
    const g = this.grid;
    return this.region([g.bbox[0], g.rowEdges[row]!, g.bbox[2], g.rowEdges[row + 1]!]);
  }
}

export function inkCrop(img: GrayImage): GrayImage | null {
  if (img.data.length === 0) return null;
  let minX = img.w, maxX = -1, minY = img.h, maxY = -1, count = 0;
  for (let y = 0; y < img.h; y++) {
    const base = y * img.w;
    for (let x = 0; x < img.w; x++)
      if (img.data[base + x]! < INK_LEVEL) {
        count++;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
  }
  if (count < MIN_INK_PIXELS) return null;
  return crop(img, Math.max(minX - INK_PAD_PX, 0), Math.max(minY - INK_PAD_PX, 0), maxX + INK_PAD_PX, maxY + INK_PAD_PX);
}

// recognition-only OCR reads exactly one line, so a multi-line cell is split on blank gaps
export function splitLines(img: GrayImage): GrayImage[] {
  const lines: [number, number][] = [];
  let start: number | null = null;
  let gap = 0;
  for (let y = 0; y < img.h; y++) {
    let hasInk = false;
    const base = y * img.w;
    for (let x = 0; x < img.w && !hasInk; x++) hasInk = img.data[base + x]! < INK_LEVEL;
    if (hasInk) {
      if (start === null) start = y;
      gap = 0;
    } else if (start !== null) {
      gap++;
      if (gap >= LINE_GAP_PX) {
        lines.push([start, y - gap + 1]);
        start = null;
      }
    }
  }
  if (start !== null) lines.push([start, img.h]);
  if (lines.length <= 1) return [img];
  return lines.map(([a, b]) => crop(img, 0, Math.max(a - LINE_GAP_PX, 0), img.w, b + LINE_GAP_PX));
}

// cv2.resize INTER_LINEAR on one channel
export function resizeLinear(img: GrayImage, w: number, h: number): GrayImage {
  const out = new Uint8Array(w * h);
  const fx = img.w / w, fy = img.h / h;
  for (let y = 0; y < h; y++) {
    const sy = (y + 0.5) * fy - 0.5;
    let y0 = Math.floor(sy), ty = sy - y0;
    if (y0 < 0) { y0 = 0; ty = 0; }
    if (y0 >= img.h - 1) { y0 = img.h - 1; ty = 0; }
    const y1 = Math.min(y0 + 1, img.h - 1);
    for (let x = 0; x < w; x++) {
      const sx = (x + 0.5) * fx - 0.5;
      let x0 = Math.floor(sx), tx = sx - x0;
      if (x0 < 0) { x0 = 0; tx = 0; }
      if (x0 >= img.w - 1) { x0 = img.w - 1; tx = 0; }
      const x1 = Math.min(x0 + 1, img.w - 1);
      const top = img.data[y0 * img.w + x0]! * (1 - tx) + img.data[y0 * img.w + x1]! * tx;
      const bottom = img.data[y1 * img.w + x0]! * (1 - tx) + img.data[y1 * img.w + x1]! * tx;
      out[y * w + x] = Math.round(top * (1 - ty) + bottom * ty);
    }
  }
  return { data: out, w, h };
}

/** Area-averaged shrink to at most `maxW` wide, for the review screen. */
export function shrink(img: GrayImage, maxW: number): GrayImage {
  const factor = Math.ceil(img.w / maxW);
  if (factor <= 1) return img;
  const w = Math.floor(img.w / factor), h = Math.floor(img.h / factor);
  const data = new Uint8Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let sum = 0;
      for (let dy = 0; dy < factor; dy++) {
        const base = (y * factor + dy) * img.w + x * factor;
        for (let dx = 0; dx < factor; dx++) sum += img.data[base + dx]!;
      }
      data[y * w + x] = Math.round(sum / (factor * factor));
    }
  return { data, w, h };
}
