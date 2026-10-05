import type { ReactNode } from 'react';
import styles from './login.module.css';

const C = 'oklch(0.86 0.05 238 / 0.62)';
const CF = 'oklch(0.86 0.05 238 / 0.28)';
const CB = 'oklch(0.97 0.03 225)';

const rect = (x: number, y: number, w: number, h: number) => `M${x} ${y}h${w}v${h}h${-w}Z`;
const circle = (cx: number, cy: number, r: number) => `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0`;

// Decorative background: a nested plate and a cut bar that draw themselves in a loop.
export function Blueprint() {
  const els: ReactNode[] = [];
  let k = 0;

  const path = (d: string, delay: number, o: { stroke?: string; w?: number } = {}) =>
    els.push(
      <path
        key={k++}
        className={styles.draw}
        d={d}
        pathLength={1}
        fill="none"
        stroke={o.stroke ?? C}
        strokeWidth={o.w ?? 1.4}
        style={{ animationDelay: `${delay}s` }}
      />,
    );
  const text = (
    x: number,
    y: number,
    s: string,
    delay: number,
    o: { size?: number; anchor?: 'start' | 'middle' | 'end'; fill?: string; rot?: string } = {},
  ) =>
    els.push(
      <text
        key={k++}
        className={styles.fade}
        x={x}
        y={y}
        fill={o.fill ?? C}
        fontSize={o.size ?? 15}
        textAnchor={o.anchor ?? 'middle'}
        transform={o.rot}
        style={{ animationDelay: `${delay}s` }}
      >
        {s}
      </text>,
    );
  const holes = (x: number, y: number, w: number, h: number, delay: number) => {
    for (const [a, b] of [[30, 30], [w - 30, 30], [30, h - 30], [w - 30, h - 30]] as const) {
      path(circle(x + a, y + b, 11), delay);
    }
  };

  // plate + dimensions
  path(rect(120, 180, 1000, 560), 0, { w: 2 });
  path('M120 140V172M1120 140V172M120 150H1120', 0.3, { stroke: CF, w: 1 });
  text(620, 140, '6000', 0.3);
  path('M80 180H112M80 740H112M90 180V740', 0.4, { stroke: CF, w: 1 });
  text(78, 460, '2000', 0.4, { rot: 'rotate(-90 78 460)' });

  // parts
  path(rect(130, 190, 300, 260), 0.8);
  holes(130, 190, 300, 260, 1.1);
  path(rect(440, 190, 300, 260), 1.0);
  holes(440, 190, 300, 260, 1.3);
  path('M750 190h360v120h-220v140h-140Z', 1.2);
  path(circle(1005, 385, 58), 1.5);
  path(circle(1005, 385, 24), 1.7);
  path(rect(130, 460, 460, 130), 1.4);
  path(rect(130, 600, 460, 130), 1.6);
  path('M600 460H800L600 730Z', 1.8);
  path('M810 460V730H610Z', 2.0);
  path(rect(820, 460, 290, 270), 2.1);
  path('M905 560h120a35 35 0 0 1 0 70h-120a35 35 0 0 1 0-70Z', 2.3);
  const marks: [string, number, number][] = [
    ['P-01', 280, 325],
    ['P-02', 590, 325],
    ['P-03', 930, 255],
    ['P-04', 360, 530],
    ['P-05', 360, 670],
    ['P-06', 965, 515],
  ];
  marks.forEach(([s, x, y], i) => text(x, y, s, 2.4 + i * 0.1, { size: 14 }));

  // cutting head
  const headPath = 'M130 190h300v260h-300Z M440 190h300v260h-300Z';
  els.push(
    <g key={k++} className={styles.head}>
      <circle r={14} fill="oklch(0.9 0.08 230 / 0.18)">
        <animateMotion dur="7s" repeatCount="indefinite" path={headPath} />
      </circle>
      <circle r={3.5} fill={CB}>
        <animateMotion dur="7s" repeatCount="indefinite" path={headPath} />
      </circle>
    </g>,
  );

  // bar stock
  const bx = 120;
  const by = 830;
  const segs: [number, string][] = [
    [308, '1850'],
    [308, '1850'],
    [207, '1240'],
    [143, '860'],
  ];
  path(rect(bx, by, 1000, 34), 2.6, { w: 1.6 });
  let x = bx;
  segs.forEach(([w, label], i) => {
    x += w;
    path(`M${x} ${by - 8}V${by + 42}`, 3.0 + i * 0.25, { stroke: CB, w: 1.4 });
    text(x - w / 2, by + 62, label, 3.2 + i * 0.25);
  });
  for (let i = x + 6; i < bx + 1000; i += 8) path(`M${i} ${by + 34}l8 -34`, 4.2, { stroke: CF, w: 1 });
  text(bx + 1000 - 1, by + 62, 'שארית 200', 4.3, { anchor: 'end', size: 13 });
  text(bx, by - 16, 'IPE 200 · 6000', 2.6, { anchor: 'start', size: 13 });

  // title block
  path(rect(120, 940, 420, 44), 0.2, { stroke: CF, w: 1 });
  path('M260 940V984M400 940V984', 0.3, { stroke: CF, w: 1 });
  text(190, 967, 'גיליון 01', 0.5, { size: 13 });
  text(330, 967, 'S235 · 10 מ״מ', 0.5, { size: 13 });
  text(470, 967, 'ניצולת 94.6%', 0.5, { size: 13, fill: CB });

  return (
    <div className={styles.blueprint} aria-hidden="true">
      <div className={styles.drift}>
        <svg viewBox="0 0 1600 1000" preserveAspectRatio="xMinYMid slice" width="100%" height="100%">
          <g transform="translate(40 20) scale(0.86)">{els}</g>
        </svg>
      </div>
    </div>
  );
}
