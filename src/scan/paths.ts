// The browser-side replacement for PyMuPDF's get_drawings(): replays a pdf.js operator
// list into painted paths, in display points (top-left origin, page rotation applied).

export interface SubPath {
  pts: number[]; // x0, y0, x1, y1, ...
  straight: boolean[]; // one per segment: false for a flattened curve piece
  closed: boolean;
}

export interface VectorPath {
  stroke: boolean;
  fill: boolean;
  widthPt: number;
  subs: SubPath[];
}

type Matrix = [number, number, number, number, number, number];

// the slice of pdf.js this module touches; the caller supplies the build (browser or Node)
export interface PdfPageLike {
  getViewport(options: { scale: number }): { width: number; height: number; transform: number[] };
  getOperatorList(): Promise<{ fnArray: number[]; argsArray: unknown[] }>;
}
export type PdfOps = Record<string, number>;

// T(p) = outer(inner(p))
function compose(o: Matrix, i: Matrix): Matrix {
  return [
    o[0] * i[0] + o[2] * i[1],
    o[1] * i[0] + o[3] * i[1],
    o[0] * i[2] + o[2] * i[3],
    o[1] * i[2] + o[3] * i[3],
    o[0] * i[4] + o[2] * i[5] + o[4],
    o[1] * i[4] + o[3] * i[5] + o[5],
  ];
}

const CURVE_STEPS = 12;
// pdf.js DrawOPS
const MOVE = 0, LINE = 1, CUBIC = 2, QUAD = 3, CLOSE = 4;

export async function extractPaths(page: PdfPageLike, OPS: PdfOps): Promise<VectorPath[]> {
  const strokeOps = new Set([OPS.stroke, OPS.closeStroke, OPS.fillStroke, OPS.eoFillStroke, OPS.closeFillStroke, OPS.closeEOFillStroke]);
  const fillOps = new Set([OPS.fill, OPS.eoFill, OPS.fillStroke, OPS.eoFillStroke, OPS.closeFillStroke, OPS.closeEOFillStroke]);
  const view = page.getViewport({ scale: 1 }).transform as Matrix;
  const { fnArray, argsArray } = await page.getOperatorList();
  let ctm: Matrix = [1, 0, 0, 1, 0, 0];
  let lineWidth = 1;
  const stack: [Matrix, number][] = [];
  const paths: VectorPath[] = [];
  const pop = () => {
    const top = stack.pop();
    if (top) [ctm, lineWidth] = top;
  };

  for (let i = 0; i < fnArray.length; i++) {
    const fn = fnArray[i];
    const args = argsArray[i] as unknown[];
    if (fn === OPS.save) stack.push([ctm, lineWidth]);
    else if (fn === OPS.restore) pop();
    else if (fn === OPS.transform) ctm = compose(ctm, args as Matrix);
    else if (fn === OPS.paintFormXObjectBegin) {
      stack.push([ctm, lineWidth]);
      if (args[0]) ctm = compose(ctm, args[0] as Matrix);
    } else if (fn === OPS.paintFormXObjectEnd) pop();
    else if (fn === OPS.setLineWidth) lineWidth = args[0] as number;
    else if (fn === OPS.setGState) {
      for (const [key, value] of args[0] as [string, unknown][]) if (key === 'LW') lineWidth = value as number;
    } else if (fn === OPS.constructPath) {
      const paint = args[0] as number;
      const stroke = strokeOps.has(paint);
      const fill = fillOps.has(paint);
      const data = (args[1] as (Float32Array | null)[])[0];
      if ((!stroke && !fill) || !data) continue;
      const m = compose(view, ctm);
      const subs: SubPath[] = [];
      let cur: SubPath | null = null;
      let px = 0, py = 0;
      const add = (x: number, y: number, straight: boolean) => {
        if (!cur) return;
        cur.pts.push(m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]);
        cur.straight.push(straight);
      };
      for (let k = 0; k < data.length; ) {
        const op = data[k++];
        if (op === MOVE) {
          px = data[k++]!; py = data[k++]!;
          cur = { pts: [m[0] * px + m[2] * py + m[4], m[1] * px + m[3] * py + m[5]], straight: [], closed: false };
          subs.push(cur);
        } else if (op === LINE) {
          px = data[k++]!; py = data[k++]!;
          add(px, py, true);
        } else if (op === CUBIC) {
          const x1 = data[k]!, y1 = data[k + 1]!, x2 = data[k + 2]!, y2 = data[k + 3]!, x3 = data[k + 4]!, y3 = data[k + 5]!;
          k += 6;
          for (let s = 1; s <= CURVE_STEPS; s++) {
            const t = s / CURVE_STEPS, u = 1 - t;
            add(
              u * u * u * px + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * x3,
              u * u * u * py + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y3,
              false,
            );
          }
          px = x3; py = y3;
        } else if (op === QUAD) {
          const x1 = data[k]!, y1 = data[k + 1]!, x2 = data[k + 2]!, y2 = data[k + 3]!;
          k += 4;
          for (let s = 1; s <= CURVE_STEPS; s++) {
            const t = s / CURVE_STEPS, u = 1 - t;
            add(u * u * px + 2 * u * t * x1 + t * t * x2, u * u * py + 2 * u * t * y1 + t * t * y2, false);
          }
          px = x2; py = y2;
        } else if (op === CLOSE) {
          const open: SubPath | null = cur;
          if (open && open.pts.length >= 4) {
            open.pts.push(open.pts[0]!, open.pts[1]!);
            open.straight.push(true);
            open.closed = true;
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
