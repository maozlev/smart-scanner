// Feasibility spike: the browser-side replacements for PyMuPDF get_drawings(),
// tables/grid.py, tables/cells.py and RapidOCR's recognition-only path.
// Everything here is plain JS over typed arrays, so it runs unchanged in a Web Worker.
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";

const { OPS } = pdfjs;

// ---------------------------------------------------------------- vector paths

// T(p) = outer(inner(p))
function compose(o, i) {
  return [
    o[0] * i[0] + o[2] * i[1],
    o[1] * i[0] + o[3] * i[1],
    o[0] * i[2] + o[2] * i[3],
    o[1] * i[2] + o[3] * i[3],
    o[0] * i[4] + o[2] * i[5] + o[4],
    o[1] * i[4] + o[3] * i[5] + o[5],
  ];
}

const STROKE_OPS = new Set([
  OPS.stroke, OPS.closeStroke, OPS.fillStroke, OPS.eoFillStroke,
  OPS.closeFillStroke, OPS.closeEOFillStroke,
]);
const FILL_OPS = new Set([
  OPS.fill, OPS.eoFill, OPS.fillStroke, OPS.eoFillStroke,
  OPS.closeFillStroke, OPS.closeEOFillStroke,
]);
const CURVE_STEPS = 12;

/** Every painted path on the page, in display points (top-left origin, page rotation applied). */
export async function extractPaths(page) {
  const view = page.getViewport({ scale: 1 }).transform;
  const { fnArray, argsArray } = await page.getOperatorList();
  let ctm = [1, 0, 0, 1, 0, 0];
  let lineWidth = 1;
  const stack = [];
  const paths = [];

  for (let i = 0; i < fnArray.length; i++) {
    const fn = fnArray[i];
    const args = argsArray[i];
    if (fn === OPS.save) stack.push([ctm, lineWidth]);
    else if (fn === OPS.restore) {
      const top = stack.pop();
      if (top) [ctm, lineWidth] = top;
    } else if (fn === OPS.transform) ctm = compose(ctm, args);
    else if (fn === OPS.paintFormXObjectBegin) {
      stack.push([ctm, lineWidth]);
      if (args[0]) ctm = compose(ctm, args[0]);
    } else if (fn === OPS.paintFormXObjectEnd) {
      const top = stack.pop();
      if (top) [ctm, lineWidth] = top;
    } else if (fn === OPS.setLineWidth) lineWidth = args[0];
    else if (fn === OPS.setGState) {
      for (const [key, value] of args[0]) if (key === "LW") lineWidth = value;
    } else if (fn === OPS.constructPath) {
      const paint = args[0];
      const stroke = STROKE_OPS.has(paint);
      const fill = FILL_OPS.has(paint);
      if (!stroke && !fill) continue;
      const m = compose(view, ctm);
      const data = args[1][0];
      if (!data) continue;
      const tx = (x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
      const subs = [];
      let cur = null;
      let px = 0, py = 0;
      for (let k = 0; k < data.length; ) {
        const op = data[k++];
        if (op === 0) {
          px = data[k++]; py = data[k++];
          cur = { pts: tx(px, py), straight: [], closed: false };
          subs.push(cur);
        } else if (op === 1) {
          px = data[k++]; py = data[k++];
          if (cur) { cur.pts.push(...tx(px, py)); cur.straight.push(true); }
        } else if (op === 2) {
          const [x1, y1, x2, y2, x3, y3] = data.subarray(k, k + 6);
          k += 6;
          if (cur) {
            for (let s = 1; s <= CURVE_STEPS; s++) {
              const t = s / CURVE_STEPS, u = 1 - t;
              const x = u * u * u * px + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * x3;
              const y = u * u * u * py + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y3;
              cur.pts.push(...tx(x, y));
              cur.straight.push(false);
            }
          }
          px = x3; py = y3;
        } else if (op === 3) {
          const [x1, y1, x2, y2] = data.subarray(k, k + 4);
          k += 4;
          if (cur) {
            for (let s = 1; s <= CURVE_STEPS; s++) {
              const t = s / CURVE_STEPS, u = 1 - t;
              cur.pts.push(...tx(u * u * px + 2 * u * t * x1 + t * t * x2, u * u * py + 2 * u * t * y1 + t * t * y2));
              cur.straight.push(false);
            }
          }
          px = x2; py = y2;
        } else if (op === 4) {
          if (cur && cur.pts.length >= 4) {
            cur.pts.push(cur.pts[0], cur.pts[1]);
            cur.straight.push(true);
            cur.closed = true;
          }
        } else {
          throw new Error(`unknown path op ${op}`);
        }
      }
      const scale = Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]));
      paths.push({ stroke, fill, widthPt: lineWidth * scale, subs });
    }
  }
  return paths;
}

// ---------------------------------------------------------------- grid (port of tables/grid.py)

const MIN_RULE_PT = 15.0;
const AXIS_TOL_PT = 0.6;
const SNAP_PT = 1.2;
const MERGE_GAP_PT = 3.0;
const EXTENT_IOU = 0.75;
const V_COVERAGE = 0.55;
const MIN_CELL_PT = 3.5;
const MAX_MEDIAN_ROW_PT = 80.0;
const NESTED_CONTAINMENT = 0.85;

function axisRules(paths) {
  const hs = [], vs = [];
  for (const path of paths) {
    for (const sub of path.subs) {
      const p = sub.pts;
      for (let s = 0; s < sub.straight.length; s++) {
        if (!sub.straight[s]) continue;
        const ax = p[2 * s], ay = p[2 * s + 1], bx = p[2 * s + 2], by = p[2 * s + 3];
        const dx = Math.abs(ax - bx), dy = Math.abs(ay - by);
        if (dy <= AXIS_TOL_PT && dx >= MIN_RULE_PT) hs.push([(ay + by) / 2, Math.min(ax, bx), Math.max(ax, bx)]);
        else if (dx <= AXIS_TOL_PT && dy >= MIN_RULE_PT) vs.push([(ax + bx) / 2, Math.min(ay, by), Math.max(ay, by)]);
      }
    }
  }
  return [hs, vs];
}

const byTuple = (a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];

function mergeCollinear(rules) {
  if (!rules.length) return [];
  rules = [...rules].sort(byTuple);
  const groups = [];
  let group = [rules[0]];
  for (const r of rules.slice(1)) {
    if (r[0] - group[group.length - 1][0] <= SNAP_PT) group.push(r);
    else { groups.push(group); group = [r]; }
  }
  groups.push(group);
  const merged = [];
  for (const g of groups) {
    const cross = g.reduce((s, r) => s + r[0], 0) / g.length;
    const intervals = g.map((r) => [r[1], r[2]]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    let [lo, hi] = intervals[0];
    for (const [a, b] of intervals.slice(1)) {
      if (a <= hi + MERGE_GAP_PT) hi = Math.max(hi, b);
      else { merged.push([cross, lo, hi]); lo = a; hi = b; }
    }
    merged.push([cross, lo, hi]);
  }
  return merged;
}

function intervalIou(a0, a1, b0, b1) {
  const inter = Math.min(a1, b1) - Math.max(a0, b0);
  if (inter <= 0) return 0;
  return inter / (Math.max(a1, b1) - Math.min(a0, b0));
}

function families(hs) {
  const n = hs.length;
  const parent = Array.from({ length: n }, (_, i) => i);
  const find = (i) => {
    while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; }
    return i;
  };
  for (let i = 0; i < n; i++)
    for (let j = i + 1; j < n; j++)
      if (intervalIou(hs[i][1], hs[i][2], hs[j][1], hs[j][2]) >= EXTENT_IOU) parent[find(i)] = find(j);
  const byRoot = new Map();
  for (let i = 0; i < n; i++) {
    const root = find(i);
    if (!byRoot.has(root)) byRoot.set(root, []);
    byRoot.get(root).push(hs[i]);
  }
  return [...byRoot.values()].filter((f) => f.length >= 3).map((f) => f.sort(byTuple));
}

function splitBands(family, vs) {
  const xLo = Math.min(...family.map((r) => r[1]));
  const xHi = Math.max(...family.map((r) => r[2]));
  const interior = vs.filter((v) => xLo + MIN_CELL_PT < v[0] && v[0] < xHi - MIN_CELL_PT);
  const bands = [[family[0]]];
  for (let i = 0; i + 1 < family.length; i++) {
    const lo = family[i][0], hi = family[i + 1][0];
    let bridging = 0;
    for (const v of interior) if (v[1] <= lo + SNAP_PT && v[2] >= hi - SNAP_PT) bridging++;
    if (bridging >= 2) bands[bands.length - 1].push(family[i + 1]);
    else bands.push([family[i + 1]]);
  }
  return bands.filter((b) => b.length >= 3);
}

function dedupeEdges(values) {
  values = [...values].sort((a, b) => a - b);
  const out = [values[0]];
  for (const v of values.slice(1)) if (v - out[out.length - 1] >= MIN_CELL_PT) out.push(v);
  return out;
}

function gridFromBand(band, vs) {
  const y0 = band[0][0], y1 = band[band.length - 1][0];
  const x0 = Math.min(...band.map((r) => r[1]));
  const x1 = Math.max(...band.map((r) => r[2]));
  const height = y1 - y0;
  if (height < 2 * MIN_CELL_PT) return null;
  const colXs = vs
    .filter((v) => x0 - SNAP_PT <= v[0] && v[0] <= x1 + SNAP_PT && Math.min(v[2], y1) - Math.max(v[1], y0) >= V_COVERAGE * height)
    .map((v) => v[0]);
  if (colXs.length < 3) return null;
  const colEdges = dedupeEdges(colXs);
  const rowEdges = dedupeEdges(band.map((r) => r[0]));
  if (colEdges.length < 3 || rowEdges.length < 3) return null;
  const heights = rowEdges.slice(1).map((b, i) => b - rowEdges[i]).sort((a, b) => a - b);
  if (heights[Math.floor(heights.length / 2)] > MAX_MEDIAN_ROW_PT) return null;
  return makeGrid([colEdges[0], rowEdges[0], colEdges[colEdges.length - 1], rowEdges[rowEdges.length - 1]], colEdges, rowEdges);
}

export function makeGrid(bbox, colEdges, rowEdges) {
  return { bbox, colEdges, rowEdges, nRows: rowEdges.length - 1, nCols: colEdges.length - 1 };
}

const area = (g) => (g.bbox[2] - g.bbox[0]) * (g.bbox[3] - g.bbox[1]);

function containment(inner, outer) {
  const ix0 = Math.max(inner.bbox[0], outer.bbox[0]), iy0 = Math.max(inner.bbox[1], outer.bbox[1]);
  const ix1 = Math.min(inner.bbox[2], outer.bbox[2]), iy1 = Math.min(inner.bbox[3], outer.bbox[3]);
  if (ix1 <= ix0 || iy1 <= iy0) return 0;
  return ((ix1 - ix0) * (iy1 - iy0)) / area(inner);
}

export function detectGrids(paths) {
  let [hs, vs] = axisRules(paths);
  hs = mergeCollinear(hs);
  vs = mergeCollinear(vs);
  const candidates = [];
  for (const family of families(hs))
    for (const band of splitBands(family, vs)) {
      const grid = gridFromBand(band, vs);
      if (grid) candidates.push(grid);
    }
  candidates.sort((a, b) => area(b) - area(a));
  const kept = [];
  for (const cand of candidates) if (kept.every((k) => containment(cand, k) < NESTED_CONTAINMENT)) kept.push(cand);
  return kept;
}

// ---------------------------------------------------------------- rasterizing our own ink

const CELL_INSET_PT = 1.6;
const MAX_OCR_PX = 12000;
const INK_LEVEL = 128;
const MIN_INK_PIXELS = 12;
const INK_PAD_PX = 12;
const LINE_GAP_PX = 6;

/** The table's ink drawn by us: no anti-aliasing to fight, strokes thickened by `growPx`. */
export class TableImage {
  constructor(paths, grid, pageW, pageH, dpi, growPx = 1) {
    this.grid = grid;
    const x0 = Math.max(grid.bbox[0], 0), y0 = Math.max(grid.bbox[1], 0);
    const x1 = Math.min(grid.bbox[2], pageW), y1 = Math.min(grid.bbox[3], pageH);
    const zoom = Math.min(dpi / 72, MAX_OCR_PX / Math.max(x1 - x0, y1 - y0, 1));
    this.w = Math.max(Math.round((x1 - x0) * zoom), 1);
    this.h = Math.max(Math.round((y1 - y0) * zoom), 1);
    this.sx = this.w / (x1 - x0);
    this.sy = this.h / (y1 - y0);
    this.origin = [x0, y0];
    this.data = new Uint8Array(this.w * this.h).fill(255);
    for (const path of paths) {
      if (path.fill) this.#fill(path);
      if (!path.stroke) continue;
      const r = Math.max(path.widthPt * zoom, 1) / 2 + growPx;
      for (const sub of path.subs) {
        const p = sub.pts;
        for (let s = 0; s + 3 < p.length; s += 2) this.#segment(p[s], p[s + 1], p[s + 2], p[s + 3], r);
      }
    }
  }

  #segment(ax, ay, bx, by, r) {
    const [ox, oy] = this.origin;
    ax = (ax - ox) * this.sx; ay = (ay - oy) * this.sy;
    bx = (bx - ox) * this.sx; by = (by - oy) * this.sy;
    const minX = Math.max(Math.floor(Math.min(ax, bx) - r), 0);
    const maxX = Math.min(Math.ceil(Math.max(ax, bx) + r), this.w - 1);
    const minY = Math.max(Math.floor(Math.min(ay, by) - r), 0);
    const maxY = Math.min(Math.ceil(Math.max(ay, by) + r), this.h - 1);
    if (minX > maxX || minY > maxY) return;
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
  #fill(path) {
    const [ox, oy] = this.origin;
    const edges = [];
    let minY = Infinity, maxY = -Infinity;
    for (const sub of path.subs) {
      const p = sub.pts;
      const n = p.length / 2;
      if (n < 3) continue;
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        const ay = (p[2 * i + 1] - oy) * this.sy, by = (p[2 * j + 1] - oy) * this.sy;
        if (ay === by) continue;
        edges.push([(p[2 * i] - ox) * this.sx, ay, (p[2 * j] - ox) * this.sx, by]);
        minY = Math.min(minY, ay, by); maxY = Math.max(maxY, ay, by);
      }
    }
    if (!edges.length) return;
    const yStart = Math.max(Math.floor(minY), 0), yEnd = Math.min(Math.ceil(maxY), this.h - 1);
    for (let y = yStart; y <= yEnd; y++) {
      const sy = y + 0.5;
      const xs = [];
      for (const [ax, ay, bx, by] of edges) {
        if ((ay <= sy && by > sy) || (by <= sy && ay > sy)) xs.push(ax + ((sy - ay) / (by - ay)) * (bx - ax));
      }
      xs.sort((a, b) => a - b);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const from = Math.max(Math.round(xs[k]), 0), to = Math.min(Math.round(xs[k + 1]) - 1, this.w - 1);
        for (let x = from; x <= to; x++) this.data[y * this.w + x] = 0;
      }
    }
  }

  region(x0, y0, x1, y1) {
    const [ox, oy] = this.origin;
    const px0 = Math.max(Math.trunc((x0 - ox) * this.sx), 0);
    const py0 = Math.max(Math.trunc((y0 - oy) * this.sy), 0);
    const px1 = Math.min(Math.trunc((x1 - ox) * this.sx), this.w);
    const py1 = Math.min(Math.trunc((y1 - oy) * this.sy), this.h);
    if (px1 <= px0 || py1 <= py0) return { data: new Uint8Array(0), w: 0, h: 0 };
    return crop({ data: this.data, w: this.w, h: this.h }, px0, py0, px1, py1);
  }

  cell(row, col) {
    const g = this.grid;
    return this.region(
      g.colEdges[col] + CELL_INSET_PT, g.rowEdges[row] + CELL_INSET_PT,
      g.colEdges[col + 1] - CELL_INSET_PT, g.rowEdges[row + 1] - CELL_INSET_PT,
    );
  }
}

function crop(img, x0, y0, x1, y1) {
  x1 = Math.min(x1, img.w); y1 = Math.min(y1, img.h);
  const w = x1 - x0, h = y1 - y0;
  const data = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) data.set(img.data.subarray((y0 + y) * img.w + x0, (y0 + y) * img.w + x1), y * w);
  return { data, w, h };
}

function inkCrop(img) {
  if (!img.data.length) return null;
  let minX = img.w, maxX = -1, minY = img.h, maxY = -1, count = 0;
  for (let y = 0; y < img.h; y++)
    for (let x = 0; x < img.w; x++)
      if (img.data[y * img.w + x] < INK_LEVEL) {
        count++;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
  if (count < MIN_INK_PIXELS) return null;
  return crop(img, Math.max(minX - INK_PAD_PX, 0), Math.max(minY - INK_PAD_PX, 0), maxX + INK_PAD_PX, maxY + INK_PAD_PX);
}

function splitLines(img) {
  const inkRows = [];
  for (let y = 0; y < img.h; y++) {
    let has = false;
    for (let x = 0; x < img.w && !has; x++) has = img.data[y * img.w + x] < INK_LEVEL;
    inkRows.push(has);
  }
  const lines = [];
  let start = null, gap = 0;
  inkRows.forEach((has, i) => {
    if (has) { if (start === null) start = i; gap = 0; }
    else if (start !== null) {
      gap++;
      if (gap >= LINE_GAP_PX) { lines.push([start, i - gap + 1]); start = null; }
    }
  });
  if (start !== null) lines.push([start, inkRows.length]);
  if (lines.length <= 1) return [img];
  return lines.map(([a, b]) => crop(img, 0, Math.max(a - LINE_GAP_PX, 0), img.w, b + LINE_GAP_PX));
}

// ---------------------------------------------------------------- recognition-only OCR

// cv2.resize INTER_LINEAR on one channel
function resizeLinear(img, w, h) {
  const out = new Uint8Array(w * h);
  const fx = img.w / w, fy = img.h / h;
  for (let y = 0; y < h; y++) {
    let sy = (y + 0.5) * fy - 0.5;
    let y0 = Math.floor(sy), ty = sy - y0;
    if (y0 < 0) { y0 = 0; ty = 0; }
    if (y0 >= img.h - 1) { y0 = img.h - 1; ty = 0; }
    const y1 = Math.min(y0 + 1, img.h - 1);
    for (let x = 0; x < w; x++) {
      let sx = (x + 0.5) * fx - 0.5;
      let x0 = Math.floor(sx), tx = sx - x0;
      if (x0 < 0) { x0 = 0; tx = 0; }
      if (x0 >= img.w - 1) { x0 = img.w - 1; tx = 0; }
      const x1 = Math.min(x0 + 1, img.w - 1);
      const top = img.data[y0 * img.w + x0] * (1 - tx) + img.data[y0 * img.w + x1] * tx;
      const bottom = img.data[y1 * img.w + x0] * (1 - tx) + img.data[y1 * img.w + x1] * tx;
      out[y * w + x] = Math.round(top * (1 - ty) + bottom * ty);
    }
  }
  return { data: out, w, h };
}

const MAX_SIDE = 2000, MIN_SIDE = 30, REC_H = 48, REC_W = 320;
const round32 = (v) => Math.round(v / 32) * 32;

// RapidOCR.preprocess: clamp the crop's sides before recognition
function clampSides(img) {
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
  constructor(ort, session, chars) {
    this.ort = ort;
    this.session = session;
    this.chars = ["", ...chars, " "]; // index 0 is the CTC blank
  }

  async read(img) {
    if (img.h < 8 || img.w < 8) return null;
    img = clampSides(img);
    if (!img) return null;
    const ratio = img.w / img.h;
    const width = Math.trunc(REC_H * Math.max(REC_W / REC_H, ratio));
    const resizedW = Math.min(Math.ceil(REC_H * ratio), width);
    const small = resizeLinear(img, resizedW, REC_H);
    const plane = REC_H * width;
    const input = new Float32Array(3 * plane);
    for (let y = 0; y < REC_H; y++)
      for (let x = 0; x < resizedW; x++) {
        const v = (small.data[y * resizedW + x] / 255 - 0.5) / 0.5;
        const at = y * width + x;
        input[at] = v; input[plane + at] = v; input[2 * plane + at] = v;
      }
    const feeds = { [this.session.inputNames[0]]: new this.ort.Tensor("float32", input, [1, 3, REC_H, width]) };
    const out = (await this.session.run(feeds))[this.session.outputNames[0]];
    const [, steps, classes] = out.dims;
    let text = "", confSum = 0, kept = 0, prev = -1;
    for (let t = 0; t < steps; t++) {
      let best = 0, bestP = -1;
      const base = t * classes;
      for (let c = 0; c < classes; c++) if (out.data[base + c] > bestP) { bestP = out.data[base + c]; best = c; }
      if (best !== 0 && best !== prev) { text += this.chars[best]; confSum += bestP; kept++; }
      prev = best;
    }
    text = text.trim();
    return text ? { text, conf: confSum / kept } : null;
  }
}

/** Port of cells.ocr_cell. */
export async function ocrCell(rec, img) {
  const cropped = inkCrop(img);
  if (!cropped) return { value: "", conf: 0.99, source: "empty" };
  const texts = [], confs = [];
  for (const line of splitLines(cropped)) {
    const lineCrop = inkCrop(line);
    if (!lineCrop) continue;
    const read = await rec.read(lineCrop);
    if (read) { texts.push(read.text); confs.push(read.conf); }
  }
  if (!texts.length) return { value: null, conf: 0, source: "ocr" };
  return { value: texts.join(" "), conf: Math.min(...confs), source: "ocr" };
}

export function fixHomoglyphs(text) {
  return text
    .replace(/[×＊Ｘｘ]/g, "x").replace(/，/g, ",").replace(/．/g, ".")
    .replace(/[\[［丨|](?=\s*\d)/g, "L")
    .replaceAll("m2", "m²");
}
