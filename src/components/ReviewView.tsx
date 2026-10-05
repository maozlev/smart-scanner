'use client';

import { lineProblems } from '@/scan/cutlist';
import type { CutLine } from '@/scan/table';
import { approveWhole, editRow, FLAG_TEXT, isIncluded, mapTable, unmapTable } from '@/lib/review';
import { MappingPanel } from './MappingPanel';
import type { FileReport, ReviewRow, ReviewTable } from '@/lib/scanner';

const toInt = (text: string): number | null => {
  const compact = text.replace(/[,\s]/g, '');
  return /^\d+$/.test(compact) ? Number(compact) : null;
};

function Status({ row }: { row: ReviewRow }) {
  if (row.decision === 'rejected') return <span className="chip off">נדחה</span>;
  if (isIncluded(row)) return <span className="chip ok">{row.decision === 'auto' ? 'אושר אוטומטית' : 'אושר'}</span>;
  return <span className="chip warn">דורש בדיקה</span>;
}

function Row({ row, onChange }: { row: ReviewRow; onChange: (row: ReviewRow) => void }) {
  const set = (patch: Partial<CutLine>) => onChange(editRow(row, { ...row.line, ...patch }));
  const problems = lineProblems(row.line);
  const waiting = !isIncluded(row) && row.decision !== 'rejected';
  const reasons = waiting ? [...row.flags.map((f) => FLAG_TEXT[f]), ...problems] : [];
  const num = (value: number | null) => (value === null ? '' : String(value));

  return (
    <>
      <tr className={row.decision === 'rejected' ? 'rejected' : undefined}>
        <td>
          <Status row={row} />
        </td>
        <td data-label="סוג">
          <input dir="auto" aria-label="סוג" value={row.line.type} onChange={(e) => set({ type: e.target.value })} />
        </td>
        <td data-label="סימון">
          <input dir="auto" aria-label="סימון" value={row.line.label} onChange={(e) => set({ label: e.target.value })} />
        </td>
        <td data-label="אורך (מ״מ)">
          <input className="num" inputMode="numeric" aria-label="אורך" value={num(row.line.lengthMm)} onChange={(e) => set({ lengthMm: toInt(e.target.value) })} />
        </td>
        <td data-label="רוחב (מ״מ)">
          <input className="num" inputMode="numeric" aria-label="רוחב" value={num(row.line.widthMm)} onChange={(e) => set({ widthMm: toInt(e.target.value) })} />
        </td>
        <td data-label="כמות">
          <input className="num" inputMode="numeric" aria-label="כמות" value={num(row.line.qty)} onChange={(e) => set({ qty: toInt(e.target.value) })} />
        </td>
        <td className="actions">
          {waiting && (
            <button className="primary" disabled={problems.length > 0} onClick={() => onChange({ ...row, decision: 'approved' })}>
              אישור
            </button>
          )}
          {row.decision === 'rejected' ? (
            <button onClick={() => onChange({ ...row, decision: 'pending' })}>החזרה</button>
          ) : (
            <button onClick={() => onChange({ ...row, decision: 'rejected' })}>דחייה</button>
          )}
        </td>
      </tr>
      {reasons.length > 0 && (
        <tr className="reasons">
          <td colSpan={7}>{reasons.join(' · ')}</td>
        </tr>
      )}
    </>
  );
}

// The table as it is drawn on the sheet, whole, above the values read from it.
function ScannedTable({ image }: { image: string | null }) {
  if (!image) return null;
  return (
    <>
      <h3>הטבלה בשרטוט</h3>
      <div className="table-scan">
        <img src={image} alt="הטבלה כפי שהיא בשרטוט" />
      </div>
    </>
  );
}

export function ReviewView({
  tables,
  reports,
  onRowChange,
  onTableChange,
}: {
  tables: ReviewTable[];
  reports: FileReport[];
  onRowChange: (row: ReviewRow) => void;
  onTableChange: (table: ReviewTable) => void;
}) {
  const withoutTable = reports.filter((r) => !r.error && !tables.some((t) => t.fileName === r.fileName && t.kind === 'materials'));

  return (
    <>
      {reports
        .filter((r) => r.error)
        .map((r) => (
          <div className="alert" key={r.fileName}>
            <span dir="ltr">{r.fileName}</span>: הקובץ לא נקרא ({r.error})
          </div>
        ))}
      {withoutTable.length > 0 && (
        <div className="note">
          לא נמצאה טבלת חומרים בקבצים: <span dir="ltr">{withoutTable.map((r) => r.fileName).join(', ')}</span>
        </div>
      )}

      {/* cut lists first, then what could not be read, then the tables that are something else */}
      {[...tables.filter((t) => t.kind === 'materials'), ...tables.filter((t) => t.kind === 'unknown' && t.unreadable), ...tables.filter((t) => t.kind === 'unknown' && !t.unreadable)].map((table) =>
        table.kind === 'materials' ? (
          <section className="card review-card" key={table.id}>
            <h2>
              <span dir="ltr">{table.fileName}</span> · עמוד {table.pageNumber} · {table.rows.length} שורות
            </h2>
            <ScannedTable image={table.image} />

            <h3>הכמויות שנקראו</h3>
            {table.mapping && (
              <>
                <p className="hint">
                  העמודות סומנו ידנית. לטבלה כזו אין בדיקה חשבונית, ולכן שום שורה לא מאושרת אוטומטית: השווה את הכמויות לטבלה שלמעלה.
                </p>
                <div className="row">
                  <button onClick={() => onTableChange(approveWhole(table))}>אישור כל השורות השלמות</button>
                  <button onClick={() => onTableChange(unmapTable(table))}>שינוי סימון העמודות</button>
                </div>
              </>
            )}
            {table.weightTotalMatches === true && (
              <p className="hint">סכום עמודת המשקל שווה למשקל הכולל המודפס בשרטוט ({table.declaredTotalWeightKg} ק״ג).</p>
            )}
            {table.weightTotalMatches === false && (
              <div className="alert">
                סכום עמודת המשקל לא שווה למשקל הכולל המודפס בשרטוט ({table.declaredTotalWeightKg} ק״ג). כדאי לעבור על השורות.
              </div>
            )}
            <div className="scroll-x">
              <table className="data review cards">
                {/* fixed widths: every value sits under its heading, whatever the row holds */}
                <colgroup>
                  <col className="c-status" />
                  <col className="c-type" />
                  <col className="c-label" />
                  <col className="c-num" />
                  <col className="c-num" />
                  <col className="c-num" />
                  <col className="c-actions" />
                </colgroup>
                <thead>
                  <tr>
                    <th>מצב</th>
                    <th>סוג</th>
                    <th>סימון</th>
                    <th>אורך (מ״מ)</th>
                    <th>רוחב (מ״מ)</th>
                    <th>כמות</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {table.rows.map((row) => (
                    <Row key={row.id} row={row} onChange={onRowChange} />
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ) : (
          <section className="card review-card" key={table.id}>
            <h2>
              <span dir="ltr">{table.fileName}</span> · עמוד {table.pageNumber} · {table.unreadable ? 'טבלה שלא נקראה' : 'טבלה אחרת'} ({table.size})
            </h2>
            {table.unreadable ? (
              <div className="note">כותרות הטבלה לא נקראו, ולכן לא ידוע מה כל עמודה מכילה. היא לא תיכנס לרשימת החיתוך עד שתסמן את העמודות.</div>
            ) : (
              <p className="hint">הטבלה נקראה, אבל לא זוהו בה עמודות של רשימת חיתוך. אם היא כן כזו, סמן את העמודות.</p>
            )}
            <ScannedTable image={table.image} />
            {table.raw && <MappingPanel table={table} onApply={(mapping) => onTableChange(mapTable(table, mapping))} />}
          </section>
        ),
      )}
    </>
  );
}
