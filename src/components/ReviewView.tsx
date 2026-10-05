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
  const reasons = [...row.flags.map((f) => FLAG_TEXT[f]), ...(row.decision === 'pending' ? problems : [])];
  const included = isIncluded(row);
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
          {!included && row.decision !== 'rejected' && (
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
      <tr className="evidence">
        <td colSpan={7}>
          {/* the row as it is drawn on the sheet, to compare the read values against */}
          {row.image && (
            <div className="strip-scroll">
              <img src={row.image} alt="השורה כפי שהיא בשרטוט" />
            </div>
          )}
          {!included && row.decision !== 'rejected' && reasons.length > 0 && <div className="reasons">{reasons.join(' · ')}</div>}
        </td>
      </tr>
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
          <section className="card" key={table.id}>
            <h2>
              <span dir="ltr">{table.fileName}</span> · עמוד {table.pageNumber} · {table.rows.length} שורות
            </h2>
            {table.mapping && (
              <>
                <p className="hint">
                  העמודות סומנו ידנית. לטבלה כזו אין בדיקה חשבונית, ולכן שום שורה לא מאושרת אוטומטית: השווה כל שורה לשרטוט שמתחתיה.
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
          <section className="card" key={table.id}>
            <h2>
              <span dir="ltr">{table.fileName}</span> · עמוד {table.pageNumber} · {table.unreadable ? 'טבלה שלא נקראה' : 'טבלה אחרת'} ({table.size})
            </h2>
            {table.unreadable ? (
              <div className="note">כותרות הטבלה לא נקראו, ולכן לא ידוע מה כל עמודה מכילה. היא לא תיכנס לרשימת החיתוך עד שתסמן את העמודות.</div>
            ) : (
              <p className="hint">הטבלה נקראה, אבל לא זוהו בה עמודות של רשימת חיתוך. אם היא כן כזו, סמן את העמודות.</p>
            )}
            {table.image && <img className="unknown-table" src={table.image} alt="הטבלה כפי שהיא בשרטוט" />}
            {table.raw && <MappingPanel table={table} onApply={(mapping) => onTableChange(mapTable(table, mapping))} />}
          </section>
        ),
      )}
    </>
  );
}
