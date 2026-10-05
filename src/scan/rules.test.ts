import { describe, expect, it } from 'vitest';
import { classifyHeuristic, dataRowIndices, declaredTotalWeight, gateDecision, type HeaderCandidate } from './classify';
import { cutListTable, isComplete, lineProblems, toCsv, totalsByType, type CompleteLine } from './cutlist';
import { fixHomoglyphs, parseArea, parseNumber, parsePlate, parseThk, profileKey, splitProfile } from './normalize';
import type { CellRead } from './ocr';
import { validateRow, weightTotalMatches, type RowFields } from './validate';

const read = (value: string, conf = 0.97): CellRead => (value === '' ? { value: '', conf: 0.99, source: 'empty' } : { value, conf, source: 'ocr' });
const blank = (n: number) => Array.from({ length: n }, () => read(''));

describe('normalize', () => {
  it('reads plain numbers and refuses everything else', () => {
    expect(parseNumber('1052')).toBe(1052);
    expect(parseNumber('3 2.2')).toBe(32.2);
    expect(parseNumber('3,814.4')).toBe(3814.4);
    expect(parseNumber('3.814,4')).toBe(3814.4);
    expect(parseNumber('80x40')).toBeNull();
    expect(parseNumber('0.6495 m²')).toBeNull();
    expect(parseNumber('עמוד')).toBeNull();
    expect(parseNumber('')).toBeNull();
  });

  it('reads plate sizes, areas and thicknesses', () => {
    expect(parsePlate('450×174')).toEqual([450, 174]);
    expect(parsePlate('1052')).toBeNull();
    expect(parseArea('0.6495 m2')).toBe(0.6495);
    expect(parseThk('Connection Plate THK 14 mm')).toBe(14);
    expect(parseThk('Horizontal L60x60x6')).toBeNull();
  });

  it('finds the profile inside a description the OCR merged or misread', () => {
    expect(profileKey('Horizontal L 60x60x6')).toBe('L60X60X6');
    expect(profileKey('LegL160×160×15')).toBe('L160X160X15');
    // the l/1/L confusions measured on the NCD sheet still give the right material
    expect(profileKey('Horizonta1L80x80x8')).toBe('L80X80X8');
    expect(profileKey('Diagona1l90x90x9')).toBe('L90X90X9');
    expect(profileKey('Diagonal [70x70x7')).toBe('L70X70X7');
    expect(profileKey('Connection Plate')).toBeNull();
    expect(splitProfile('HorizontalL60x60x6')).toEqual({ key: 'L60X60X6', rest: 'Horizontal' });
    expect(splitProfile('LegL160x160x15 galvanized')).toEqual({ key: 'L160X160X15', rest: 'Leg galvanized' });
  });

  it('turns an ideographic space into a space', () => {
    expect(fixHomoglyphs('Leg　L160x160x15')).toBe('Leg L160x160x15');
  });
});

describe('validate', () => {
  const fields = (over: Partial<RowFields>): RowFields => ({
    qty: 4, unitLengthMm: 1052, totalLengthMm: 4208, unitWeightKg: null, totalWeightKg: 22.8,
    widthMm: null, heightMm: null, areaM2: null, thkMm: null, ...over,
  });
  const roles = ['item_no', 'qty', 'description', 'unit_length', 'total_length', 'total_weight', 'other'] as const;

  it('passes a row whose arithmetic holds', () => {
    expect(validateRow(fields({}), [...roles])).toEqual([]);
  });

  it('flags a misread digit through the row arithmetic', () => {
    expect(validateRow(fields({ unitLengthMm: 1062 }), [...roles])).toEqual(['qty_x_unit_length_mismatch']);
    expect(validateRow(fields({ qty: 8 }), [...roles])).toEqual(['qty_x_unit_length_mismatch']);
  });

  it('flags a missing or fractional quantity', () => {
    expect(validateRow(fields({ qty: null }), [...roles])).toEqual(['qty_missing']);
    expect(validateRow(fields({ qty: 2.5, totalLengthMm: 2630 }), [...roles])).toEqual(['qty_not_integer']);
  });

  it('checks a plate by area x thickness x steel density', () => {
    const plate = fields({ qty: 8, unitLengthMm: null, totalLengthMm: null, widthMm: 450, heightMm: 174, areaM2: 0.3915, thkMm: 14, totalWeightKg: 43.0 });
    expect(validateRow(plate, [...roles])).toEqual([]);
    expect(validateRow({ ...plate, totalWeightKg: 48.0 }, [...roles])).toEqual(['area_x_thk_weight_mismatch']);
    expect(validateRow({ ...plate, qty: 2, areaM2: 0.3915 }, [...roles])).toContain('area_exceeds_qty_x_bounding_rect');
  });

  it('compares the weight column with the printed grand total', () => {
    const rows = [fields({ totalWeightKg: 10.0 }), fields({ totalWeightKg: 20.5 })];
    expect(weightTotalMatches(rows, 30.5)).toBe(true);
    expect(weightTotalMatches(rows, 35.5)).toBe(false);
    expect(weightTotalMatches(rows, null)).toBeNull();
  });
});

describe('classify', () => {
  const header = ['Item', 'Qty', 'Item Description', 'Length', 'Total Length', 'Total Weight', 'Notes'];
  const dataRow = ['830', '8', 'Reinforcement THK 6 mm', '80x40', '0.0256 m²', '1.2', 'WELDED AS MARKED'];

  it('maps printed English headers to column roles', () => {
    const cls = classifyHeuristic([['top', 1, header]]);
    expect(cls.kind).toBe('materials');
    expect(cls.columnRoles).toEqual(['item_no', 'qty', 'description', 'unit_length', 'total_length', 'total_weight', 'other']);
  });

  it('finds a header printed below and outside the grid', () => {
    const candidates: HeaderCandidate[] = [
      ['top', 1, dataRow.map((t) => read(t))],
      ['bottom', 1, dataRow.map((t) => read(t))],
      ['top', 0, blank(7)],
      ['bottom', 0, header.map((t) => read(t))],
    ];
    const { classification, reason } = gateDecision(candidates, 7, 30);
    expect(reason).toBe('printed_headers');
    expect(classification.headerRows).toBe(0);
    expect(classification.headerPosition).toBe('bottom');
    expect(dataRowIndices(30, classification)).toHaveLength(30);
  });

  it('drops a grid whose header was read and names nothing material', () => {
    const titleBlock = ['Drawn', 'Checked', 'Approved'];
    const candidates: HeaderCandidate[] = [
      ['top', 1, titleBlock.map((t) => read(t))],
      ['bottom', 1, ['A. Cohen', 'B. Levi', ''].map((t) => read(t))],
      ['top', 0, blank(3)],
      ['bottom', 0, blank(3)],
    ];
    expect(gateDecision(candidates, 3, 4).classification.kind).toBe('other');
  });

  it('surfaces a grid with unreadable header ink and numeric rows instead of dropping it', () => {
    // Hebrew stroke ink comes back as low-confidence Latin garbage
    const garbage = ['117V O9n I JU', 'NTUNJ X', 'IJN1', 'D7U'].map((t) => read(t, 0.47));
    const numbers = ['12', '60', '18.5', '4'].map((t) => read(t, 0.99));
    const candidates: HeaderCandidate[] = [['top', 1, garbage], ['bottom', 1, numbers], ['top', 0, blank(4)], ['bottom', 0, blank(4)]];
    const { classification, reason } = gateDecision(candidates, 4, 12);
    expect(reason).toBe('unreadable_ink');
    expect(classification.kind).toBe('unknown');
  });

  it('does not surface an unreadable grid that is not shaped like a table', () => {
    const garbage = ['117V O9n', 'NTUNJ'].map((t) => read(t, 0.4));
    const candidates: HeaderCandidate[] = [['top', 1, garbage], ['bottom', 1, garbage], ['top', 0, blank(2)], ['bottom', 0, blank(2)]];
    expect(gateDecision(candidates, 2, 2).reason).toBe('unreadable_not_tabular');
  });

  it('reads the printed grand total', () => {
    expect(declaredTotalWeight(['Total Weight: 3814.4 kg'])).toBe(3814.4);
    expect(declaredTotalWeight(['Scale 1:5'])).toBeNull();
  });
});

describe('cut list', () => {
  const lines: CompleteLine[] = [
    { type: 'L60X60X6', label: '828 Horizontal L60x60x6', lengthMm: 1052, widthMm: null, qty: 4 },
    { type: 'L60X60X6', label: '827 Horizontal L60x60x6', lengthMm: 743, widthMm: null, qty: 8 },
    { type: 'פלטה 14 מ"מ', label: '829 Connection Plate THK 14 mm', lengthMm: 450, widthMm: 174, qty: 8 },
  ];

  it('writes the columns the nesting calculator imports', () => {
    expect(cutListTable(lines)).toEqual([
      ['סוג', 'סימון', 'אורך', 'רוחב', 'כמות'],
      ['L60X60X6', '828 Horizontal L60x60x6', '1052', '', '4'],
      ['L60X60X6', '827 Horizontal L60x60x6', '743', '', '8'],
      ['פלטה 14 מ"מ', '829 Connection Plate THK 14 mm', '450', '174', '8'],
    ]);
  });

  it('quotes cells that hold a quote or a comma', () => {
    const csv = toCsv(cutListTable(lines));
    expect(csv.startsWith('\uFEFFסוג,סימון,אורך,רוחב,כמות\r\n')).toBe(true);
    expect(csv).toContain('"פלטה 14 מ""מ",829 Connection Plate THK 14 mm,450,174,8\r\n');
  });

  it('refuses a line that is not whole millimetres and whole pieces', () => {
    expect(lineProblems({ type: '', label: 'x', lengthMm: null, widthMm: null, qty: null })).toHaveLength(3);
    expect(isComplete({ type: 'L60X60X6', label: '', lengthMm: 1052.5, widthMm: null, qty: 4 })).toBe(false);
    expect(isComplete(lines[0]!)).toBe(true);
  });

  it('pools totals per material', () => {
    expect(totalsByType(lines)).toEqual([
      { type: 'L60X60X6', plate: false, lines: 2, pieces: 12, totalLengthMm: 4 * 1052 + 8 * 743, totalAreaMm2: 0 },
      { type: 'פלטה 14 מ"מ', plate: true, lines: 1, pieces: 8, totalLengthMm: 0, totalAreaMm2: 8 * 450 * 174 },
    ]);
  });
});
