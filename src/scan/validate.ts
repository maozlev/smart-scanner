// Row and table checks; a port of steelOptimaV2 tables/validate.py. A materials table carries
// its own checksums: qty x unit length must equal the printed total, and the weight column
// must sum to the printed grand total. A wrong value that is flagged costs a click; one that
// slips through costs money, so every check errs toward flagging.
import type { ColumnRole } from './classify';

export interface RowFields {
  qty: number | null;
  unitLengthMm: number | null;
  totalLengthMm: number | null;
  unitWeightKg: number | null;
  totalWeightKg: number | null;
  widthMm: number | null;
  heightMm: number | null;
  areaM2: number | null;
  thkMm: number | null;
}

export type RowFlag =
  | 'qty_missing' | 'qty_not_positive' | 'qty_not_integer' | 'value_not_positive'
  | 'qty_x_unit_length_mismatch' | 'qty_x_unit_weight_mismatch' | 'area_x_thk_weight_mismatch'
  | 'area_exceeds_qty_x_bounding_rect' | 'low_confidence' | 'unread_cell' | 'no_size' | 'no_material';

const REL_TOL = 0.005; // printed totals are rounded to 0.1; half a percent covers that
const QTY_INT_TOL = 1e-6;
const STEEL_DENSITY_KG_M3 = 7850;
// a printed weight rounded to 0.1 kg can be off by 0.05 on its own
const PLATE_WEIGHT_ABS_TOL_KG = 0.06;

const close = (a: number, b: number) => Math.abs(a - b) <= REL_TOL * Math.max(Math.abs(a), Math.abs(b), 1);

export function validateRow(f: RowFields, roles: ColumnRole[]): RowFlag[] {
  const flags: RowFlag[] = [];
  if (roles.includes('qty')) {
    if (f.qty === null) flags.push('qty_missing');
    else if (f.qty <= 0) flags.push('qty_not_positive');
    else if (Math.abs(f.qty - Math.round(f.qty)) > QTY_INT_TOL) flags.push('qty_not_integer');
  }
  if ([f.unitLengthMm, f.totalLengthMm, f.unitWeightKg, f.totalWeightKg].some((v) => v !== null && v <= 0)) {
    flags.push('value_not_positive');
  }

  // the row's own arithmetic: the strongest signal available
  if (f.qty && f.unitLengthMm && f.totalLengthMm && !close(f.qty * f.unitLengthMm, f.totalLengthMm)) {
    flags.push('qty_x_unit_length_mismatch');
  }
  if (f.qty && f.unitWeightKg && f.totalWeightKg && !close(f.qty * f.unitWeightKg, f.totalWeightKg)) {
    flags.push('qty_x_unit_weight_mismatch');
  }

  // plates: total area x thickness x steel density must equal the weight column
  if (f.areaM2 && f.thkMm && f.totalWeightKg) {
    const expected = f.areaM2 * (f.thkMm / 1000) * STEEL_DENSITY_KG_M3;
    if (Math.abs(expected - f.totalWeightKg) > Math.max(REL_TOL * Math.max(expected, f.totalWeightKg), PLATE_WEIGHT_ABS_TOL_KG)) {
      flags.push('area_x_thk_weight_mismatch');
    }
  }
  // qty rectangles is the most area the row can claim; over it means a misread
  if (f.areaM2 && f.qty && f.widthMm && f.heightMm && f.areaM2 > f.qty * (f.widthMm / 1000) * (f.heightMm / 1000) * (1 + REL_TOL)) {
    flags.push('area_exceeds_qty_x_bounding_rect');
  }
  return flags;
}

/** The weight column against the printed grand total; null when there is nothing to compare. */
export function weightTotalMatches(rows: RowFields[], declaredKg: number | null): boolean | null {
  const summed = rows.reduce((sum, r) => sum + (r.totalWeightKg ?? 0), 0);
  if (!declaredKg || !summed) return null;
  // the printed total is rounded to one decimal: allow one unit of rounding per row
  return Math.abs(summed - declaredKg) <= Math.max(REL_TOL * declaredKg, 0.05 * rows.length);
}
