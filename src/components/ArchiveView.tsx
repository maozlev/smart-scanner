'use client';

import { useState } from 'react';
import { ARCHIVE_LIMIT, type ArchiveEntry, type CombineMode } from '@/lib/archive';

const when = new Intl.DateTimeFormat('he-IL', { dateStyle: 'short', timeStyle: 'short' });

interface Props {
  entries: ArchiveEntry[];
  storageFailed: boolean;
  onRestore: (entry: ArchiveEntry) => void;
  onCombine: (entries: ArchiveEntry[], mode: CombineMode) => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
}

export function ArchiveView({ entries, storageFailed, onRestore, onCombine, onRename, onDelete }: Props) {
  const [selected, setSelected] = useState<string[]>([]);
  // in the order they were ticked, minus anything deleted since
  const chosen = selected.flatMap((id) => entries.filter((e) => e.id === id));
  const toggle = (id: string) => setSelected((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));

  return (
    <section className="card">
      <h2>ארכיון סריקות</h2>
      <p className="hint">
        כל סריקה נשמרת כאן אוטומטית ומתעדכנת בזמן הסקירה, עד {ARCHIVE_LIMIT} סריקות אחרונות. ״שחזר״ מחזיר את השורות למסך הסקירה,
        בלי תמונות השרטוט ובלי טבלאות שלא סומנו. סימון של שתי סריקות או יותר מאפשר לבנות מהן רשימת חיתוך אחת. הארכיון שמור
        בדפדפן הזה בלבד.
      </p>
      {storageFailed && <div className="alert">הדפדפן לא הצליח לשמור את הארכיון (האחסון מלא או חסום). הסריקה האחרונה לא נשמרה.</div>}
      {chosen.length >= 2 && (
        <div className="note" style={{ marginBottom: 12 }}>
          <b>{chosen.length} סריקות נבחרו.</b> אפשר לבנות מהן רשימת חיתוך אחת בשתי דרכים:
          <div className="row" style={{ marginTop: 8 }}>
            <button className="primary" onClick={() => onCombine(chosen, 'merged')}>
              איחוד לחיתוך משותף
            </button>
            <button onClick={() => onCombine(chosen, 'separate')}>רשימה משולבת, כל סריקה בנפרד</button>
            <button className="ghost" onClick={() => setSelected([])}>
              ביטול הבחירה
            </button>
          </div>
          <div className="hint" style={{ marginTop: 6 }}>
            ״איחוד לחיתוך משותף״ משאיר את סוגי החומר כמו שהם, כך שמחשבון הנסטינג חותך יחד את כל החלקים מאותו חומר, מכל
            הסריקות; בדרך כלל נחסך חומר. ״רשימה משולבת״ מוסיפה לכל סוג חומר את שם הסריקה שלו, כך שכל סריקה נחתכת בנפרד
            והתוצאה רק מסכמת אותן. בשני המקרים השורות שעל המסך מוחלפות, והתוצאה נשמרת בארכיון כסריקה חדשה.
          </div>
        </div>
      )}
      {entries.length === 0 ? (
        <p className="muted">עדיין אין סריקות בארכיון.</p>
      ) : (
        <div className="scroll-x">
          <table className="data">
            <thead>
              <tr>
                <th>בחירה</th>
                <th>תאריך</th>
                <th>שם</th>
                <th>קבצים</th>
                <th>שורות מאושרות</th>
                <th>חלקים</th>
                <th>ממתינות</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.id}>
                  <td>
                    <input type="checkbox" aria-label={`בחירת ${e.name}`} checked={selected.includes(e.id)} onChange={() => toggle(e.id)} />
                  </td>
                  <td>{when.format(new Date(e.savedAt))}</td>
                  <td>
                    <input dir="auto" aria-label="שם הסריקה" value={e.name} onChange={(event) => onRename(e.id, event.target.value)} />
                  </td>
                  <td>{e.files.length}</td>
                  <td>{e.summary.lineCount}</td>
                  <td>{e.summary.pieceCount}</td>
                  <td>{e.summary.pendingCount === 0 ? '' : e.summary.pendingCount}</td>
                  <td>
                    <div className="row" style={{ flexWrap: 'nowrap' }}>
                      <button className="primary" onClick={() => onRestore(e)}>
                        שחזר
                      </button>
                      <button className="ghost" onClick={() => onDelete(e.id)}>
                        מחק
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
