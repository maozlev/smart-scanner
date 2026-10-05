// One page's grids -> reviewed-ready material rows. The deterministic path of steelOptimaV2
// tables/service.py: read the header, gate, read every data cell, check each row's arithmetic.
import { dataRowIndices, declaredTotalWeight, gateDecision, type ColumnRole, type GateReason, type HeaderCandidate } from './classify';
import { detectGrids, makeGrid, medianRowHeight, type Box, type TableGrid } from './grid';
import { parseArea, parseNumber, parsePlate, parseThk, splitProfile } from './normalize';
import { ocrCell, readLines, type CellRead, type Recognizer } from './ocr';
import type { VectorPath } from './paths';
import { OCR_DPI, shrink, TableImage, type GrayImage } from './raster';
import { validateRow, weightTotalMatches, type RowFields, type RowFlag } from './validate';

// a row auto-approves only above this, and only with no flag at all
const ROW_APPROVE_CONF = 0.8;
// the printed grand total reconciles: the weight column is checksummed
const CHECKSUMMED_CONF = 0.95;
const PREVIEW_MAX_W = 1100;
// A note is read as one line the width of the table, so it is shrunk far more than a cell
// before recognition, and thick strokes then swallow its decimal point. Measured on the NCD
// sheet's "Total Weight: 3814.4 kg": 1-2 px reads it right, 2.5-3 px reads "38144".
const NOTE_GROW_PX = 1.5;

/** One line of the cut list the nesting calculator imports: סוג, סימון, אורך, רוחב, כמות. */
export interface CutLine {
  type: string;
  label: string;
  lengthMm: number | null;
  widthMm: number | null; // plates only
  qty: number | null;
}

export interface ScannedRow {
  rowIndex: number;
  cells: CellRead[];
  fields: RowFields;
  flags: RowFlag[];
  confidence: number;
  autoApproved: boolean;
  line: CutLine;
  preview: GrayImage;
}

export interface ScannedTable {
  kind: 'materials' | 'unknown';
  reason: GateReason;
  bbox: Box;
  nRows: number;
  nCols: number;
  roles: ColumnRole[];
  rows: ScannedRow[];
  declaredTotalWeightKg: number | null;
  weightTotalMatches: boolean | null;
  preview: GrayImage | null; // unknown tables: the whole grid, for the operator to recognise
  raw: RawGrid | null; // unknown tables: every cell as read, for the operator to map by hand
}

/** A grid read cell by cell with no idea what its columns mean (see manual.ts). */
export interface RawGrid {
  cells: CellRead[][]; // [row][col], every grid row including whatever is a header
  rowPreviews: GrayImage[];
}

export interface PageScan {
  tables: ScannedTable[];
  gridsFound: number;
}

async function headerCandidates(
  rec: Recognizer,
  paths: VectorPath[],
  image: TableImage,
  pageW: number,
  pageH: number,
): Promise<HeaderCandidate[]> {
  const grid = image.grid;
  const gridRow = async (r: number) => {
    const reads: CellRead[] = [];
    for (let c = 0; c < grid.nCols; c++) reads.push(await ocrCell(rec, image.cell(r, c)));
    return reads;
  };
  const med = medianRowHeight(grid);
  // the header can sit OUTSIDE the ruling: the NCD BOM prints it below the grid
  const strip = async (above: boolean) => {
    const y0 = above ? grid.bbox[1] - 1.9 * med : grid.bbox[3] + 0.05;
    const y1 = above ? grid.bbox[1] - 0.05 : grid.bbox[3] + 1.9 * med;
    const stripGrid = makeGrid([grid.bbox[0], y0, grid.bbox[2], y1], grid.colEdges, [y0, y1]);
    const stripImage = new TableImage(paths, stripGrid, pageW, pageH);
    const reads: CellRead[] = [];
    for (let c = 0; c < grid.nCols; c++) reads.push(await ocrCell(rec, stripImage.cell(0, c)));
    return reads;
  };
  return [
    ['top', 1, await gridRow(0)],
    ['bottom', 1, await gridRow(grid.nRows - 1)],
    ['top', 0, await strip(true)],
    ['bottom', 0, await strip(false)],
  ];
}

async function readDeclaredWeight(rec: Recognizer, paths: VectorPath[], grid: TableGrid, pageW: number, pageH: number): Promise<number | null> {
  const med = medianRowHeight(grid);
  const [x0, y0, x1, y1] = grid.bbox;
  // the tight strip reads the line clean; the taller one covers a note a full row away
  for (const factor of [1.2, 2.2]) {
    const strips: Box[] = [
      [x0, y0 - factor * med, x1, y0 - 0.1],
      [x0, y1 + 0.1, x1, y1 + factor * med],
    ];
    for (const box of strips) {
      const stripGrid = makeGrid(box, [box[0], box[2]], [box[1], box[3]]);
      const strip = new TableImage(paths, stripGrid, pageW, pageH, OCR_DPI, NOTE_GROW_PX);
      const value = declaredTotalWeight(await readLines(rec, strip));
      if (value !== null) return value;
    }
  }
  return null;
}

function roleValues(cells: CellRead[], roles: ColumnRole[]): Partial<Record<ColumnRole, string | null>> {
  const values: Partial<Record<ColumnRole, string | null>> = {};
  roles.forEach((role, c) => {
    if (role !== 'other' && !(role in values)) values[role] = cells[c]?.value ?? null;
  });
  return values;
}

// Plate rows in a mixed BOM reuse the length columns: unit length holds WxH ("890x185") and
// total length holds an area ("0.6495 m²"). When the number parser refuses, the plate parsers
// get a shot.
function normalizedFields(values: Partial<Record<ColumnRole, string | null>>): RowFields {
  const unitLen = parseNumber(values.unit_length);
  const totalLen = parseNumber(values.total_length);
  const plate = unitLen === null ? parsePlate(values.unit_length) : null;
  return {
    qty: parseNumber(values.qty),
    unitLengthMm: unitLen,
    totalLengthMm: totalLen,
    unitWeightKg: parseNumber(values.unit_weight),
    totalWeightKg: parseNumber(values.total_weight),
    widthMm: plate ? plate[0] : null,
    heightMm: plate ? plate[1] : null,
    areaM2: totalLen === null ? parseArea(values.total_length) : null,
    thkMm: parseThk(values.description),
  };
}

export function plateType(thkMm: number): string {
  return `פלטה ${thkMm} מ"מ`;
}

function cutLine(values: Partial<Record<ColumnRole, string | null>>, f: RowFields): CutLine {
  const label = [values.item_no, values.description].map((v) => (v ?? '').trim()).filter(Boolean).join(' ');
  if (f.widthMm !== null && f.heightMm !== null) {
    return {
      // plates are grouped by thickness alone, so every plate of one thickness nests together
      type: f.thkMm !== null ? plateType(f.thkMm) : '',
      label,
      lengthMm: Math.round(Math.max(f.widthMm, f.heightMm)),
      widthMm: Math.round(Math.min(f.widthMm, f.heightMm)),
      qty: f.qty,
    };
  }
  // the designation moves to the type column; what is left of the description names the part
  const profile = splitProfile(`${values.profile ?? ''} ${values.description ?? ''}`);
  return {
    type: profile?.key ?? '',
    label: profile ? [(values.item_no ?? '').trim(), profile.rest].filter(Boolean).join(' ') : label,
    lengthMm: f.unitLengthMm === null ? null : Math.round(f.unitLengthMm),
    widthMm: null,
    qty: f.qty,
  };
}

// the weakest meaningful cell bounds the row
function rowConfidence(cells: CellRead[], roles: ColumnRole[]): number {
  const confs = cells.filter((cell, c) => roles[c] !== 'other' && cell.source !== 'empty').map((cell) => cell.conf);
  return confs.length > 0 ? Math.min(...confs) : 0;
}

async function scanGrid(
  rec: Recognizer,
  paths: VectorPath[],
  grid: TableGrid,
  pageW: number,
  pageH: number,
  onRow: () => void | Promise<void>,
): Promise<ScannedTable | null> {
  const image = new TableImage(paths, grid, pageW, pageH);
  const candidates = await headerCandidates(rec, paths, image, pageW, pageH);
  const { classification: cls, reason } = gateDecision(candidates, grid.nCols, grid.nRows);
  if (cls.kind === 'other') return null;

  // A real header row is words; a data row is numbers. If the claimed in-grid header is
  // mostly numeric, the header is not in the grid.
  if (cls.headerRows > 0) {
    const claimed = (cls.headerPosition === 'top' ? candidates[0]! : candidates[1]!)[2].filter((c) => (c.value ?? '').trim() !== '');
    const numeric = claimed.filter((c) => parseNumber(c.value) !== null).length;
    if (claimed.length > 0 && numeric / claimed.length > 0.5) cls.headerRows = 0;
  }

  const base = { reason, bbox: grid.bbox, nRows: grid.nRows, nCols: grid.nCols, roles: cls.columnRoles };
  const readRow = async (r: number): Promise<CellRead[]> => {
    // the first and last grid rows were already read as header candidates
    if (r === 0) return candidates[0]![2];
    if (r === grid.nRows - 1) return candidates[1]![2];
    const cells: CellRead[] = [];
    for (let c = 0; c < grid.nCols; c++) cells.push(await ocrCell(rec, image.cell(r, c)));
    return cells;
  };

  if (cls.kind === 'unknown') {
    // Digits read in any script, so the numbers are worth having even when the headers are
    // not understood: the operator says what each column is and types what could not be read.
    const raw: RawGrid = { cells: [], rowPreviews: [] };
    for (let r = 0; r < grid.nRows; r++) {
      raw.cells.push(await readRow(r));
      raw.rowPreviews.push(shrink(image.row(r), PREVIEW_MAX_W));
      await onRow();
    }
    return { ...base, kind: 'unknown', rows: [], declaredTotalWeightKg: null, weightTotalMatches: null, preview: shrink(image, PREVIEW_MAX_W), raw };
  }

  const roles = cls.columnRoles;
  const read: { rowIndex: number; cells: CellRead[]; values: Partial<Record<ColumnRole, string | null>>; fields: RowFields }[] = [];
  for (const r of dataRowIndices(grid.nRows, cls)) {
    const cells = await readRow(r);
    const values = roleValues(cells, roles);
    read.push({ rowIndex: r, cells, values, fields: normalizedFields(values) });
    await onRow();
  }

  const declared = await readDeclaredWeight(rec, paths, grid, pageW, pageH);
  const weightOk = weightTotalMatches(read.map((r) => r.fields), declared);

  const rows = read.map(({ rowIndex, cells, values, fields }): ScannedRow => {
    let confidence = rowConfidence(cells, roles);
    if (weightOk && fields.totalWeightKg !== null) confidence = Math.max(confidence, CHECKSUMMED_CONF);
    const line = cutLine(values, fields);
    const flags = validateRow(fields, roles);
    if (cells.some((cell, c) => roles[c] !== 'other' && cell.value === null)) flags.push('unread_cell');
    if (line.type === '') flags.push('no_material');
    if (line.lengthMm === null) flags.push('no_size');
    if (confidence < ROW_APPROVE_CONF) flags.push('low_confidence');
    return { rowIndex, cells, fields, flags, confidence, autoApproved: flags.length === 0, line, preview: shrink(image.row(rowIndex), PREVIEW_MAX_W) };
  });

  return { ...base, kind: 'materials', rows, declaredTotalWeightKg: declared, weightTotalMatches: weightOk, preview: null, raw: null };
}

/** Every material table on one page. `onRow` is awaited once per data row read. */
export async function scanPage(
  rec: Recognizer,
  paths: VectorPath[],
  pageW: number,
  pageH: number,
  onRow: () => void | Promise<void> = () => {},
): Promise<PageScan> {
  const grids = detectGrids(paths);
  const tables: ScannedTable[] = [];
  for (const grid of grids) {
    const table = await scanGrid(rec, paths, grid, pageW, pageH, onRow);
    if (table) tables.push(table);
  }
  return { tables, gridsFound: grids.length };
}
