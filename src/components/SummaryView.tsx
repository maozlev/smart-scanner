'use client';

import { useState } from 'react';
import { totalsByType, type CompleteLine } from '@/scan/cutlist';
import { exportCsv, exportXlsx } from '@/lib/export';
import type { ReviewCounts } from '@/lib/review';

const metres = (mm: number) => (mm / 1000).toLocaleString('he-IL', { maximumFractionDigits: 2 });
const squareMetres = (mm2: number) => (mm2 / 1_000_000).toLocaleString('he-IL', { maximumFractionDigits: 3 });

export function SummaryView({ lines, counts, onReview }: { lines: CompleteLine[]; counts: ReviewCounts; onReview: () => void }) {
  const [exportError, setExportError] = useState<string | null>(null);
  const totals = totalsByType(lines);
  const left: string[] = [];
  if (counts.pending > 0) left.push(`${counts.pending} שורות שלא אושרו`);
  if (counts.unreadableTables > 0) left.push(`${counts.unreadableTables} טבלאות שהכותרות שלהן לא נקראו`);

  return (
    <>
      {left.length > 0 && (
        <div className="alert">
          לא נכללו ברשימה: {left.join(', ')}.{' '}
          <button className="link" onClick={onReview}>
            חזרה לסקירה
          </button>
        </div>
      )}

      {counts.otherTables > 0 && (
        <p className="hint">
          בשרטוטים נמצאו עוד {counts.otherTables} טבלאות שנקראו ואינן רשימת חיתוך (אין בהן עמודת אורך או פרופיל). הן מוצגות בסוף הסקירה.
        </p>
      )}

      <section className="card">
        <h2>סיכום לפי חומר</h2>
        {totals.length === 0 ? (
          <p className="hint">אין שורות מאושרות.</p>
        ) : (
          <table className="data cards">
            <thead>
              <tr>
                <th>סוג</th>
                <th>שורות</th>
                <th>חלקים</th>
                <th>אורך כולל (מ׳)</th>
                <th>שטח כולל (מ״ר)</th>
              </tr>
            </thead>
            <tbody>
              {totals.map((t) => (
                <tr key={`${t.plate}:${t.type}`}>
                  <td dir="auto">{t.type}</td>
                  <td data-label="שורות">{t.lines}</td>
                  <td data-label="חלקים">{t.pieces}</td>
                  {/* on a phone each figure is a labelled line, so the one that does not apply is left out */}
                  <td data-label="אורך כולל (מ׳)" className={t.plate ? 'na' : undefined}>
                    {t.plate ? '' : metres(t.totalLengthMm)}
                  </td>
                  <td data-label="שטח כולל (מ״ר)" className={t.plate ? undefined : 'na'}>
                    {t.plate ? squareMetres(t.totalAreaMm2) : ''}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="card">
        <h2>ייצוא רשימת חיתוך</h2>
        <p className="hint">
          הקובץ במבנה שמחשבון הנסטינג מייבא: סוג, סימון, אורך, רוחב, כמות. {lines.length} שורות. פחת ומידות מלאי מגדירים בנסטינג.
        </p>
        <div className="row">
          <button
            className="primary"
            disabled={lines.length === 0}
            onClick={() => exportXlsx(lines).then(() => setExportError(null), (e) => setExportError(String(e)))}
          >
            ייצוא XLSX
          </button>
          <button disabled={lines.length === 0} onClick={() => exportCsv(lines)}>
            ייצוא CSV
          </button>
        </div>
        {exportError && <div className="alert">הייצוא נכשל: {exportError}</div>}
      </section>
    </>
  );
}
