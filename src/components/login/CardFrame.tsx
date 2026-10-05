import type { CSSProperties, ReactNode } from 'react';
import styles from './login.module.css';

const BRIGHT = 'oklch(0.97 0.03 225)';
const DIM = 'oklch(0.86 0.05 238 / 0.55)';
const MARK = 'oklch(0.9 0.05 230 / 0.75)';

const delay = (seconds: number): CSSProperties => ({ animationDelay: `${seconds}s` });

// Drafting marks that pop up around the card's edge as the light runs past them.
const MARK_START = 1.9;
const MARK_CYCLE = 10;

function markShape(type: string, at: number): ReactNode {
  const stroke = (d: string, when: number) => (
    <path key={`${d}${when}`} className={styles.markStroke} d={d} fill="none" stroke={MARK} strokeWidth={1} pathLength={1} style={delay(when)} />
  );
  const label = (x: number, y: number, text: string, anchor: 'start' | 'middle' = 'middle') => (
    <text key={text} className={styles.markText} x={x} y={y} fill={MARK} fontSize={9} textAnchor={anchor}>
      {text}
    </text>
  );
  switch (type) {
    case 'tick':
      return [stroke('M2 12H34M2 8V16M34 8V16', at), label(18, 6, '120')];
    case 'cross':
      return [stroke('M11 2V20M2 11H20', at), stroke('M7 11a4 4 0 1 0 8 0a4 4 0 1 0 -8 0', at + 0.1)];
    case 'hole':
      return [stroke('M4 11a7 7 0 1 0 14 0a7 7 0 1 0 -14 0', at), stroke('M11 1V21M1 11H21', at + 0.1), label(30, 14, '⌀12')];
    case 'radius':
      return [stroke('M2 20V10a8 8 0 0 1 8 -8H20', at), label(24, 20, 'R8', 'start')];
    case 'ruler':
      return [stroke('M2 4H38M2 4V12M11 4V9M20 4V12M29 4V9M38 4V12', at)];
    default:
      return [stroke('M2 20H26M2 20L20 4', at), stroke('M14 20a12 12 0 0 0 -3 -8', at + 0.1), label(30, 16, '45°', 'start')];
  }
}

function Marks() {
  // positions are fractions of the way round the card, clockwise from the top-left corner,
  // for a nominal 440 × 600 card
  const width = 440;
  const height = 600;
  const perimeter = 2 * (width + height);
  const top = width / perimeter;
  const right = (width + height) / perimeter;
  const bottom = (2 * width + height) / perimeter;
  const items: [number, string][] = [
    [0.06, 'tick'],
    [0.16, 'cross'],
    [0.29, 'hole'],
    [0.42, 'radius'],
    [0.57, 'ruler'],
    [0.67, 'angle'],
    [0.8, 'cross'],
    [0.92, 'hole'],
  ];
  return (
    <div className={styles.marks}>
      {items.map(([at, type], i) => {
        const when = MARK_START + at * MARK_CYCLE - 0.15;
        const pct = (n: number) => `${n * 100}%`;
        const position: CSSProperties =
          at < top
            ? { top: 8, left: pct(at / top), transform: 'translateX(-50%)' }
            : at < right
              ? { right: 8, top: pct((at - top) / (right - top)), transform: 'translateY(-50%)' }
              : at < bottom
                ? { bottom: 8, left: pct(1 - (at - right) / (bottom - right)), transform: 'translateX(-50%)' }
                : { left: 8, top: pct(1 - (at - bottom) / (1 - bottom)), transform: 'translateY(-50%)' };
        return (
          <div key={i} className={styles.mark} style={position}>
            <svg className={styles.markPop} width={44} height={22} viewBox="0 0 44 22" style={delay(when)}>
              {markShape(type, when)}
            </svg>
          </div>
        );
      })}
    </div>
  );
}

// The card's outline draws itself, gets its dimension lines, and then a point of light keeps
// travelling round it.
export function CardFrame() {
  const line = (props: { x1: number | string; x2: number | string; y1: number | string; y2: number | string }, when: number) => (
    <line {...props} className={styles.dim} stroke={DIM} strokeWidth={1} style={delay(when)} />
  );
  return (
    <>
      <Marks />
      <svg className={styles.frame} width="100%" height="100%" aria-hidden="true">
        <rect className={styles.frameDraw} x={0.5} y={0.5} fill="none" stroke="oklch(0.86 0.05 238 / 0.5)" strokeWidth={1} pathLength={1} />
        {line({ x1: 0, x2: 0, y1: -34, y2: -14 }, 1.0)}
        {line({ x1: '100%', x2: '100%', y1: -34, y2: -14 }, 1.0)}
        {line({ x1: 0, x2: '100%', y1: -24, y2: -24 }, 1.05)}
        <text className={`${styles.dim} ${styles.markText}`} x="50%" y={-32} textAnchor="middle" fill={DIM} fontSize={12} style={delay(1.15)}>
          440
        </text>
        {line({ x1: -34, x2: -14, y1: 0, y2: 0 }, 1.1)}
        {line({ x1: -34, x2: -14, y1: '100%', y2: '100%' }, 1.1)}
        {line({ x1: -24, x2: -24, y1: 0, y2: '100%' }, 1.15)}
        {line({ x1: '50%', x2: '50%', y1: -10, y2: 10 }, 1.2)}
        <rect className={styles.frameRun} x={0.5} y={0.5} fill="none" stroke={BRIGHT} strokeWidth={1.5} strokeLinecap="round" pathLength={1} />
      </svg>
    </>
  );
}

// The maker's signature, written in by hand at the foot of the sheet.
export function Signature() {
  return (
    <div className={styles.signature} dir="ltr">
      <svg width={300} height={40} viewBox="0 0 300 40">
        <text className={styles.ink} x={2} y={28} fontSize={22}>
          Intelligops Software Solutions
        </text>
      </svg>
    </div>
  );
}
