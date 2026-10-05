'use client';

import { Cormorant_Garamond } from 'next/font/google';
import { useRef, useState } from 'react';
import { logout } from '@/app/actions';
import { ReviewView } from '@/components/ReviewView';
import { SummaryView } from '@/components/SummaryView';
import { countRows, includedLines, updateRow } from '@/lib/review';
import { scanFiles, type FileReport, type ReviewTable, type ScanProgress } from '@/lib/scanner';

const brandFont = Cormorant_Garamond({ subsets: ['latin'], weight: ['500', '600'], variable: '--font-brand' });

const STEPS = ['העלאה', 'סריקה', 'סקירה', 'סיכום וייצוא'];
type Phase = 'upload' | 'review' | 'summary';
const STEP_OF: Record<Phase, number> = { upload: 0, review: 2, summary: 3 };

const isPdf = (file: File) => file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');

export default function ScanPage() {
  const [files, setFiles] = useState<File[]>([]);
  const [rejected, setRejected] = useState<string[]>([]);
  const [phase, setPhase] = useState<Phase>('upload');
  const [progress, setProgress] = useState<ScanProgress | null>(null);
  const [tables, setTables] = useState<ReviewTable[]>([]);
  const [reports, setReports] = useState<FileReport[]>([]);
  const [failure, setFailure] = useState<string | null>(null);
  const picker = useRef<HTMLInputElement>(null);

  const busy = progress !== null;
  const scanned = reports.length > 0;
  const counts = countRows(tables);
  const step = busy ? 1 : STEP_OF[phase];

  function addFiles(list: FileList | null) {
    if (!list || busy) return;
    const incoming = Array.from(list);
    const known = new Set(files.map((f) => `${f.name}:${f.size}`));
    setFiles([...files, ...incoming.filter((f) => isPdf(f) && !known.has(`${f.name}:${f.size}`))]);
    setRejected(incoming.filter((f) => !isPdf(f)).map((f) => f.name));
    setPhase('upload');
  }

  function clearAll() {
    setFiles([]);
    setRejected([]);
    setTables([]);
    setReports([]);
    setFailure(null);
    setPhase('upload');
  }

  async function scan() {
    setFailure(null);
    setProgress({ stage: 'loading', fileName: '', fileIndex: 0, fileCount: files.length, rowsRead: 0 });
    try {
      const result = await scanFiles(files, setProgress);
      setTables(result.tables);
      setReports(result.reports);
      setPhase('review');
    } catch (error) {
      setFailure(error instanceof Error ? error.message : String(error));
    } finally {
      setProgress(null);
    }
  }

  const drop = {
    onDragOver: (e: React.DragEvent) => e.preventDefault(),
    onDrop: (e: React.DragEvent) => {
      e.preventDefault();
      addFiles(e.dataTransfer.files);
    },
  };

  return (
    <div className={`shell ${brandFont.variable}`}>
      <header className="appbar no-print">
        <div className="appbar-in">
          <h1 className="brand" dir="ltr" lang="en">
            Smart Scanner <span>Drawings to BOM</span>
          </h1>
          <button onClick={() => picker.current?.click()} disabled={busy}>
            העלאת שרטוטים
          </button>
          <button className="primary" onClick={scan} disabled={busy || files.length === 0}>
            סריקה
          </button>
          <button onClick={clearAll} disabled={busy || (files.length === 0 && !scanned)}>
            ניקוי הכל
          </button>
          <form action={logout}>
            <button className="ghost" type="submit">
              יציאה
            </button>
          </form>
        </div>
      </header>

      <main className="app">
        <ol className="steps no-print" aria-label="שלבי העבודה">
          {STEPS.map((label, i) => (
            <li key={label} className={i === step ? 'current' : i < step ? 'done' : ''} aria-current={i === step ? 'step' : undefined}>
              {label}
            </li>
          ))}
        </ol>

        {scanned && (
          <nav className="tabs no-print" aria-label="מסכים">
            <button className={`tab ${phase === 'upload' ? 'active' : ''}`} onClick={() => setPhase('upload')}>
              קבצים
            </button>
            <button className={`tab ${phase === 'review' ? 'active' : ''}`} onClick={() => setPhase('review')}>
              סקירה
              {counts.pending > 0 && <small>{counts.pending} לבדיקה</small>}
            </button>
            <button className={`tab ${phase === 'summary' ? 'active' : ''}`} onClick={() => setPhase('summary')}>
              סיכום וייצוא
            </button>
          </nav>
        )}

        <input
          ref={picker}
          type="file"
          accept="application/pdf,.pdf"
          multiple
          hidden
          onChange={(e) => {
            addFiles(e.target.files);
            e.target.value = '';
          }}
        />

        {failure && <div className="alert">הסריקה נכשלה: {failure}</div>}

        {phase === 'upload' && rejected.length > 0 && (
          <div className="alert">
            הכלי קורא קובצי PDF וקטוריים בלבד. לא נוספו: <span dir="ltr">{rejected.join(', ')}</span>
          </div>
        )}

        {phase === 'upload' &&
          (files.length === 0 ? (
            <div className="card empty" {...drop}>
              <h2>אין שרטוטים</h2>
              <p className="hint">גרור לכאן קובצי PDF של שרטוטים, או בחר אותם מהמחשב. אפשר להעלות כמה קבצים יחד.</p>
              <button className="primary" onClick={() => picker.current?.click()}>
                בחירת קבצים
              </button>
            </div>
          ) : (
            <section className="card" {...drop}>
              <h2>שרטוטים לסריקה ({files.length})</h2>
              <table className="data">
                <thead>
                  <tr>
                    <th>קובץ</th>
                    <th>גודל</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {files.map((file) => (
                    <tr key={`${file.name}:${file.size}`}>
                      <td dir="ltr">{file.name}</td>
                      <td>{(file.size / 1024).toFixed(0)} KB</td>
                      <td>
                        <button className="link" disabled={busy} onClick={() => setFiles(files.filter((f) => f !== file))}>
                          הסרה
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="hint">הסריקה רצה כולה בדפדפן; השרטוטים לא נשלחים לשום שרת.</p>
              <div className="row">
                <button className="primary" onClick={scan} disabled={busy}>
                  סריקה
                </button>
              </div>
            </section>
          ))}

        {phase === 'review' && (
          <>
            <ReviewView
              tables={tables}
              reports={reports}
              onRowChange={(row) => setTables(updateRow(tables, row.id, () => row))}
              onTableChange={(table) => setTables(tables.map((t) => (t.id === table.id ? table : t)))}
            />
            <div className="row">
              <button className="primary" onClick={() => setPhase('summary')}>
                לסיכום וייצוא
              </button>
            </div>
          </>
        )}

        {phase === 'summary' && <SummaryView lines={includedLines(tables)} counts={counts} onReview={() => setPhase('review')} />}

        {progress && (
          <div className="backdrop no-print" role="status" aria-live="polite">
            <div className="card dialog computing">
              <div className="spinner" aria-hidden="true" />
              <h2>{progress.stage === 'loading' ? 'טוען את מנוע הקריאה…' : 'סורק שרטוטים…'}</h2>
              <p className="muted">
                {progress.stage === 'loading' ? (
                  'בסריקה הראשונה נטענים כ-25MB. זה קורה פעם אחת.'
                ) : (
                  <>
                    <span dir="ltr">{progress.fileName}</span> · קובץ {progress.fileIndex + 1} מתוך {progress.fileCount} · {progress.rowsRead} שורות נקראו
                  </>
                )}
              </p>
              <div className="bar" aria-hidden="true">
                <div className="bar-done" style={{ transform: `scaleX(${progress.fileIndex / progress.fileCount})` }} />
                <div className="bar-sweep" />
              </div>
              <p className="hint">גיליון גדול יכול לקחת עד דקה.</p>
            </div>
          </div>
        )}
      </main>

      <footer className="appfoot no-print">
        <div className="appfoot-in" lang="en">
          IntelligOps Software Solutions
        </div>
      </footer>
    </div>
  );
}
