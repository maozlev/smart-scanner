'use client';

import { useState } from 'react';
import { emptyMapping, MANUAL_ROLE_TEXT, mappingProblems, type LengthUnit, type ManualMapping, type ManualRole } from '@/scan/manual';
import type { ReviewTable } from '@/lib/scanner';

const ROLES = Object.keys(MANUAL_ROLE_TEXT) as ManualRole[];
const UNITS: [LengthUnit, string][] = [['mm', 'מ״מ'], ['cm', 'ס״מ'], ['m', 'מטר']];
const PREVIEW_ROWS = 6;

/** The operator tells the scanner what each column of a table holds. */
export function MappingPanel({ table, onApply }: { table: ReviewTable; onApply: (mapping: ManualMapping) => void }) {
  const cells = table.raw?.cells ?? [];
  const nCols = cells[0]?.length ?? 0;
  const [mapping, setMapping] = useState<ManualMapping>(table.mapping ?? emptyMapping(nCols));
  const problems = mappingProblems(mapping, cells.length);
  const set = (patch: Partial<ManualMapping>) => setMapping({ ...mapping, ...patch });
  const rows = (text: string) => Math.max(0, Math.min(cells.length - 1, Number(text) || 0));
  const isHeader = (r: number) => r < mapping.headerTop || r >= cells.length - mapping.headerBottom;

  return (
    <div className="mapping">
      <p className="hint">
        כדי להפוך את הטבלה לרשימת חיתוך, בחר מה כל עמודה מכילה. המספרים נקראים אוטומטית; טקסט שלא נקרא בבירור יישאר ריק
        ותקליד אותו בשורות.
      </p>
      {/* same left-to-right column order as the drawing above */}
      <div className="scroll-x">
        <table className="data mapping-grid" dir="ltr">
          <thead>
            <tr>
              {mapping.roles.map((role, c) => (
                <th key={c}>
                  <select
                    dir="rtl"
                    aria-label={`עמודה ${c + 1}`}
                    value={role}
                    onChange={(e) => set({ roles: mapping.roles.map((r, i) => (i === c ? (e.target.value as ManualRole) : r)) })}
                  >
                    {ROLES.map((r) => (
                      <option key={r} value={r}>
                        {MANUAL_ROLE_TEXT[r]}
                      </option>
                    ))}
                  </select>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {cells.slice(0, PREVIEW_ROWS).map((row, r) => (
              <tr key={r} className={isHeader(r) ? 'header-row' : undefined}>
                {row.map((cell, c) => (
                  <td key={c} dir="auto">
                    {cell.value ?? '?'}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {cells.length > PREVIEW_ROWS && <p className="hint">מוצגות {PREVIEW_ROWS} השורות הראשונות מתוך {cells.length}, כפי שנקראו.</p>}

      <div className="fields">
        <div className="field">
          <label>שורות כותרת למעלה</label>
          <input className="num" inputMode="numeric" value={mapping.headerTop} onChange={(e) => set({ headerTop: rows(e.target.value) })} />
        </div>
        <div className="field">
          <label>שורות כותרת למטה</label>
          <input className="num" inputMode="numeric" value={mapping.headerBottom} onChange={(e) => set({ headerBottom: rows(e.target.value) })} />
        </div>
        <div className="field">
          <label>יחידת האורך בטבלה</label>
          <select value={mapping.unit} onChange={(e) => set({ unit: e.target.value as LengthUnit })}>
            {UNITS.map(([unit, text]) => (
              <option key={unit} value={unit}>
                {text}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>סוג חומר לכל הטבלה</label>
          <input dir="auto" value={mapping.fixedType} onChange={(e) => set({ fixedType: e.target.value })} />
          <div className="hint">כשאין בטבלה עמודה של סוג החומר.</div>
        </div>
        <div className="field">
          <label>כמות לכל שורה</label>
          <input
            className="num"
            inputMode="numeric"
            value={mapping.fixedQty ?? ''}
            onChange={(e) => set({ fixedQty: /^\d+$/.test(e.target.value) && Number(e.target.value) > 0 ? Number(e.target.value) : null })}
          />
          <div className="hint">כשאין עמודת כמות וכל שורה היא חלק אחד.</div>
        </div>
      </div>

      {problems.length > 0 && <div className="note">{problems.join(' · ')}</div>}
      <div className="row">
        <button className="primary" disabled={problems.length > 0} onClick={() => onApply(mapping)}>
          יצירת שורות
        </button>
      </div>
    </div>
  );
}
