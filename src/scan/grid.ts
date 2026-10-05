// Ruled-grid recovery from vector lines; a port of steelOptimaV2 tables/grid.py.
// A table's rows share left/right extents, so horizontal rules are grouped into families by
// x-extent, families are split where no column rule bridges two rows, and the vertical rules
// spanning a band become its column edges.
import type { VectorPath } from './paths';

const MIN_RULE_PT = 15.0; // shorter axis-aligned strokes are glyph ink, ticks, hatching
const AXIS_TOL_PT = 0.6;
const SNAP_PT = 1.2; // rules within this distance are the same line
const MERGE_GAP_PT = 3.0; // collinear segments closer than this are one stroked rule
const EXTENT_IOU = 0.75; // H rules with interval-IoU above this belong to one table
const V_COVERAGE = 0.55; // a column rule must span this fraction of the table band
const MIN_CELL_PT = 3.5;
// a sheet frame also forms a "grid" of rules, but its rows are hundreds of points tall
const MAX_MEDIAN_ROW_PT = 80.0;
const NESTED_CONTAINMENT = 0.85; // a candidate mostly inside another is its sub-grid

export type Box = [number, number, number, number];
type Rule = [number, number, number]; // (cross, lo, hi)

export interface TableGrid {
  bbox: Box;
  colEdges: number[];
  rowEdges: number[];
  nRows: number;
  nCols: number;
}

export function makeGrid(bbox: Box, colEdges: number[], rowEdges: number[]): TableGrid {
  return { bbox, colEdges, rowEdges, nRows: rowEdges.length - 1, nCols: colEdges.length - 1 };
}

export function medianRowHeight(grid: TableGrid): number {
  const heights = grid.rowEdges.slice(1).map((b, i) => b - grid.rowEdges[i]!).sort((a, b) => a - b);
  return heights[Math.floor(heights.length / 2)]!;
}

function axisRules(paths: VectorPath[]): [Rule[], Rule[]] {
  const hs: Rule[] = [];
  const vs: Rule[] = [];
  for (const path of paths) {
    for (const sub of path.subs) {
      const p = sub.pts;
      for (let s = 0; s < sub.straight.length; s++) {
        if (!sub.straight[s]) continue;
        const ax = p[2 * s]!, ay = p[2 * s + 1]!, bx = p[2 * s + 2]!, by = p[2 * s + 3]!;
        const dx = Math.abs(ax - bx), dy = Math.abs(ay - by);
        if (dy <= AXIS_TOL_PT && dx >= MIN_RULE_PT) hs.push([(ay + by) / 2, Math.min(ax, bx), Math.max(ax, bx)]);
        else if (dx <= AXIS_TOL_PT && dy >= MIN_RULE_PT) vs.push([(ax + bx) / 2, Math.min(ay, by), Math.max(ay, by)]);
      }
    }
  }
  return [hs, vs];
}

const byRule = (a: Rule, b: Rule) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];

// CAD exporters draw one rule as many strokes
function mergeCollinear(input: Rule[]): Rule[] {
  if (input.length === 0) return [];
  const rules = [...input].sort(byRule);
  const groups: Rule[][] = [];
  let group: Rule[] = [rules[0]!];
  for (const r of rules.slice(1)) {
    if (r[0] - group[group.length - 1]![0] <= SNAP_PT) group.push(r);
    else {
      groups.push(group);
      group = [r];
    }
  }
  groups.push(group);
  const merged: Rule[] = [];
  for (const g of groups) {
    const cross = g.reduce((sum, r) => sum + r[0], 0) / g.length;
    const intervals = g.map((r): [number, number] => [r[1], r[2]]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    let [lo, hi] = intervals[0]!;
    for (const [a, b] of intervals.slice(1)) {
      if (a <= hi + MERGE_GAP_PT) hi = Math.max(hi, b);
      else {
        merged.push([cross, lo, hi]);
        lo = a;
        hi = b;
      }
    }
    merged.push([cross, lo, hi]);
  }
  return merged;
}

function intervalIou(a: Rule, b: Rule): number {
  const inter = Math.min(a[2], b[2]) - Math.max(a[1], b[1]);
  if (inter <= 0) return 0;
  return inter / (Math.max(a[2], b[2]) - Math.min(a[1], b[1]));
}

function families(hs: Rule[]): Rule[][] {
  const parent = hs.map((_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]!]!;
      i = parent[i]!;
    }
    return i;
  };
  for (let i = 0; i < hs.length; i++)
    for (let j = i + 1; j < hs.length; j++) if (intervalIou(hs[i]!, hs[j]!) >= EXTENT_IOU) parent[find(i)] = find(j);
  const byRoot = new Map<number, Rule[]>();
  hs.forEach((rule, i) => {
    const root = find(i);
    const family = byRoot.get(root);
    if (family) family.push(rule);
    else byRoot.set(root, [rule]);
  });
  return [...byRoot.values()].filter((f) => f.length >= 3).map((f) => f.sort(byRule));
}

// Two stacked tables of similar width chain into one family; inside one table its column
// rules span every row gap, between two tables nothing vertical crosses.
function splitBands(family: Rule[], vs: Rule[]): Rule[][] {
  const xLo = Math.min(...family.map((r) => r[1]));
  const xHi = Math.max(...family.map((r) => r[2]));
  const interior = vs.filter((v) => xLo + MIN_CELL_PT < v[0] && v[0] < xHi - MIN_CELL_PT);
  const bands: Rule[][] = [[family[0]!]];
  for (let i = 0; i + 1 < family.length; i++) {
    const lo = family[i]![0], hi = family[i + 1]![0];
    let bridging = 0;
    for (const v of interior) if (v[1] <= lo + SNAP_PT && v[2] >= hi - SNAP_PT) bridging++;
    if (bridging >= 2) bands[bands.length - 1]!.push(family[i + 1]!);
    else bands.push([family[i + 1]!]);
  }
  return bands.filter((b) => b.length >= 3);
}

function dedupeEdges(input: number[]): number[] {
  const values = [...input].sort((a, b) => a - b);
  const out = [values[0]!];
  for (const v of values.slice(1)) if (v - out[out.length - 1]! >= MIN_CELL_PT) out.push(v);
  return out;
}

function gridFromBand(band: Rule[], vs: Rule[]): TableGrid | null {
  const y0 = band[0]![0], y1 = band[band.length - 1]![0];
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
  const grid = makeGrid([colEdges[0]!, rowEdges[0]!, colEdges[colEdges.length - 1]!, rowEdges[rowEdges.length - 1]!], colEdges, rowEdges);
  return medianRowHeight(grid) > MAX_MEDIAN_ROW_PT ? null : grid;
}

const area = (g: TableGrid) => (g.bbox[2] - g.bbox[0]) * (g.bbox[3] - g.bbox[1]);

function containment(inner: TableGrid, outer: TableGrid): number {
  const ix0 = Math.max(inner.bbox[0], outer.bbox[0]), iy0 = Math.max(inner.bbox[1], outer.bbox[1]);
  const ix1 = Math.min(inner.bbox[2], outer.bbox[2]), iy1 = Math.min(inner.bbox[3], outer.bbox[3]);
  if (ix1 <= ix0 || iy1 <= iy0) return 0;
  return ((ix1 - ix0) * (iy1 - iy0)) / area(inner);
}

/** All ruled grids on the page, largest first, sub-grids dropped. Structure only. */
export function detectGrids(paths: VectorPath[]): TableGrid[] {
  const [rawH, rawV] = axisRules(paths);
  const hs = mergeCollinear(rawH);
  const vs = mergeCollinear(rawV);
  const candidates: TableGrid[] = [];
  for (const family of families(hs))
    for (const band of splitBands(family, vs)) {
      const grid = gridFromBand(band, vs);
      if (grid) candidates.push(grid);
    }
  candidates.sort((a, b) => area(b) - area(a));
  const kept: TableGrid[] = [];
  for (const cand of candidates) if (kept.every((k) => containment(cand, k) < NESTED_CONTAINMENT)) kept.push(cand);
  return kept;
}
