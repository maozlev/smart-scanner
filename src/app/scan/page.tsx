'use client';

import { Cormorant_Garamond } from 'next/font/google';
import { useRef, useState } from 'react';
import { logout } from '@/app/actions';

const brandFont = Cormorant_Garamond({ subsets: ['latin'], weight: ['500', '600'], variable: '--font-brand' });

const STEPS = ['העלאה', 'סריקה', 'סקירה', 'סיכום', 'ייצוא'];

const isPdf = (file: File) => file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');

export default function ScanPage() {
  const [files, setFiles] = useState<File[]>([]);
  const [rejected, setRejected] = useState<string[]>([]);
  const picker = useRef<HTMLInputElement>(null);

  function addFiles(list: FileList | null) {
    if (!list) return;
    const incoming = Array.from(list);
    const known = new Set(files.map((f) => `${f.name}:${f.size}`));
    setFiles([...files, ...incoming.filter((f) => isPdf(f) && !known.has(`${f.name}:${f.size}`))]);
    setRejected(incoming.filter((f) => !isPdf(f)).map((f) => f.name));
  }

  return (
    <div className={`shell ${brandFont.variable}`}>
      <header className="appbar no-print">
        <div className="appbar-in">
          <h1 className="brand" dir="ltr" lang="en">
            Smart Scanner <span>Drawings to BOM</span>
          </h1>
          <button className="primary" onClick={() => picker.current?.click()}>
            העלאת שרטוטים
          </button>
          <button onClick={() => { setFiles([]); setRejected([]); }} disabled={files.length === 0}>
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
          {STEPS.map((step, i) => (
            <li key={step} className={i === 0 ? 'current' : undefined}>
              {step}
            </li>
          ))}
        </ol>

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

        {rejected.length > 0 && (
          <div className="alert">
            הכלי קורא קובצי PDF וקטוריים בלבד. לא נוספו: <span dir="ltr">{rejected.join(', ')}</span>
          </div>
        )}

        {files.length === 0 ? (
          <div
            className="card empty"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              addFiles(e.dataTransfer.files);
            }}
          >
            <h2>אין שרטוטים</h2>
            <p className="hint">גרור לכאן קובצי PDF של שרטוטים, או בחר אותם מהמחשב. אפשר להעלות כמה קבצים יחד.</p>
            <button className="primary" onClick={() => picker.current?.click()}>
              בחירת קבצים
            </button>
          </div>
        ) : (
          <section
            className="card"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              addFiles(e.dataTransfer.files);
            }}
          >
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
                      <button className="link" onClick={() => setFiles(files.filter((f) => f !== file))}>
                        הסרה
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
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
