// Draws the demo drawing: an invented steel shed with a bill of materials, as a vector PDF
// whose lettering is outlines rather than text, the way CAD exports are. It is the file the
// help dialog offers for download, the one the demo video scans, and a fixture anyone can run
// the tests against (the real customer sheets are not in the repository).
//   node scripts/make-demo.mjs        -> public/demo/demo-drawing.pdf
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import opentype from 'opentype.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const table = JSON.parse(readFileSync(join(root, 'src', 'scan', 'demo-table.json'), 'utf8'));
const fontFile = readFileSync(join(root, 'node_modules', '@fontsource', 'roboto-mono', 'files', 'roboto-mono-latin-400-normal.woff'));
const font = opentype.parse(fontFile.buffer.slice(fontFile.byteOffset, fontFile.byteOffset + fontFile.byteLength));

const W = 1191, H = 842; // A3 landscape, points
const ops = [];
const n = (v) => Number(v.toFixed(2));
const y = (top) => n(H - top); // the drawing is laid out from the top-left; PDF counts from the bottom

function line(x0, y0, x1, y1, width = 0.5) {
  ops.push(`${width} w ${n(x0)} ${y(y0)} m ${n(x1)} ${y(y1)} l S`);
}
function rect(x0, y0, x1, y1, width = 0.5) {
  ops.push(`${width} w ${n(x0)} ${y(y0)} m ${n(x1)} ${y(y0)} l ${n(x1)} ${y(y1)} l ${n(x0)} ${y(y1)} l h S`);
}
// text as filled glyph outlines; quadratic curves become cubics, which is all PDF has
function text(str, x, baseline, size) {
  for (const glyphPath of font.getPaths(str, x, baseline, size)) {
    const out = [];
    let cx = 0, cy = 0;
    for (const c of glyphPath.commands) {
      if (c.type === 'M') out.push(`${n(c.x)} ${y(c.y)} m`);
      else if (c.type === 'L') out.push(`${n(c.x)} ${y(c.y)} l`);
      else if (c.type === 'C') out.push(`${n(c.x1)} ${y(c.y1)} ${n(c.x2)} ${y(c.y2)} ${n(c.x)} ${y(c.y)} c`);
      else if (c.type === 'Q') {
        const x1 = cx + (2 / 3) * (c.x1 - cx), y1 = cy + (2 / 3) * (c.y1 - cy);
        const x2 = c.x + (2 / 3) * (c.x1 - c.x), y2 = c.y + (2 / 3) * (c.y1 - c.y);
        out.push(`${n(x1)} ${y(y1)} ${n(x2)} ${y(y2)} ${n(c.x)} ${y(c.y)} c`);
      } else if (c.type === 'Z') out.push('h');
      if (c.type !== 'Z') {
        cx = c.x;
        cy = c.y;
      }
    }
    if (out.length) ops.push(`${out.join(' ')} f`);
  }
}

// sheet frame and title
rect(20, 20, W - 20, H - 20, 1.2);
text('DEMO DRAWING - NOT FOR CONSTRUCTION', 40, 52, 14);
text(table.title, 40, 76, 10);

// a portal frame elevation, so the sheet reads as a drawing: two columns, two rafters, braces
const base = 620, eave = 330, ridge = 240, left = 110, right = 610, mid = (left + right) / 2;
for (const [x0, y0, x1, y1] of [
  [left, base, left, eave], [right, base, right, eave], [left, eave, mid, ridge], [mid, ridge, right, eave],
  [left - 30, base, right + 30, base], [left, base, mid, eave + 60], [right, base, mid, eave + 60],
]) line(x0, y0, x1, y1, 1.4);
for (const [x, yy] of [[left, base], [right, base]]) rect(x - 16, yy, x + 16, yy + 8, 1.4);
// dimension lines, thin
line(left, base + 40, right, base + 40, 0.25);
line(left, base + 32, left, base + 48, 0.25);
line(right, base + 32, right, base + 48, 0.25);
text('12000', mid - 18, base + 36, 9);
line(left - 50, base, left - 50, eave, 0.25);
text('4200', left - 84, (base + eave) / 2, 9);

// the bill of materials
const widths = [44, 36, 176, 66, 92, 84];
const rowH = 17, x0 = 660, y0 = 250, size = 8.5;
const xs = widths.reduce((acc, w) => [...acc, acc[acc.length - 1] + w], [x0]);
const rows = [table.header, ...table.rows];
for (let r = 0; r <= rows.length; r++) line(x0, y0 + r * rowH, xs[xs.length - 1], y0 + r * rowH, r <= 1 || r === rows.length ? 1 : 0.5);
for (let c = 0; c < xs.length; c++) line(xs[c], y0, xs[c], y0 + rows.length * rowH, c === 0 || c === xs.length - 1 ? 1 : 0.5);
rows.forEach((row, r) => row.forEach((cell, c) => text(cell, xs[c] + 5, y0 + (r + 1) * rowH - 5.2, size)));
text(`Total Weight: ${table.totalWeightKg} kg`, x0 + 2, y0 + rows.length * rowH + 15, size);

// a title block, which the scanner must recognise as not a cut list
const tx = W - 20 - 300, ty = H - 20 - 60;
rect(tx, ty, W - 20, H - 20, 1);
line(tx, ty + 30, W - 20, ty + 30);
line(tx + 150, ty, tx + 150, H - 20);
text('Drawn', tx + 6, ty + 19, 8);
text('Smart Scanner', tx + 156, ty + 19, 8);
text('Sheet', tx + 6, ty + 49, 8);
text('DEMO-01', tx + 156, ty + 49, 8);

// a one-page PDF written by hand: four objects and a cross-reference table
const stream = ops.join('\n');
const objects = [
  '<< /Type /Catalog /Pages 2 0 R >>',
  '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
  `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Contents 4 0 R /Resources << >> >>`,
  `<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}\nendstream`,
];
let pdf = '%PDF-1.4\n';
const offsets = objects.map((body, i) => {
  const offset = Buffer.byteLength(pdf, 'latin1');
  pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
  return offset;
});
const xref = Buffer.byteLength(pdf, 'latin1');
pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;

const target = join(root, 'public', 'demo', 'demo-drawing.pdf');
mkdirSync(dirname(target), { recursive: true });
writeFileSync(target, pdf, 'latin1');
console.log(`${target}: ${(Buffer.byteLength(pdf, 'latin1') / 1024).toFixed(0)} KB, ${ops.length} paths`);
