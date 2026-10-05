'use client';

import { useState } from 'react';
import styles from './login.module.css';

// On a phone-sized screen the login page opens with this notice on top of it: the app works on
// a phone, but a computer is the recommended way to use it. It has to be acknowledged before
// the form can be reached. Wider screens never see it (see .advice in login.module.css).
export function PhoneAdvice() {
  const [open, setOpen] = useState(true);
  const [copied, setCopied] = useState(false);
  if (!open) return null;

  const sendLink = async () => {
    const url = window.location.origin;
    try {
      if (navigator.share) await navigator.share({ title: document.title, url });
      else {
        await navigator.clipboard.writeText(url);
        setCopied(true);
      }
    } catch {
      // the share sheet was dismissed, or the clipboard is blocked: nothing to report
    }
  };

  return (
    <div className={styles.advice}>
      <div className={styles.adviceCard} role="alertdialog" aria-modal="true" aria-labelledby="advice-title" aria-describedby="advice-text">
        <h2 id="advice-title">מומלץ להשתמש במחשב</h2>
        <div id="advice-text">
          <p>המערכת עובדת גם בטלפון, אבל היא נוחה יותר במחשב או בטאבלט:</p>
          <ul>
            <li>מסך רחב להשוואת כל שורה שנקראה מול השרטוט שלה.</li>
            <li>עריכה של שורות וסימון עמודות בטבלאות רחבות.</li>
            <li>סריקה של גיליון גדול איטית יותר בטלפון.</li>
          </ul>
          <p>בטלפון כדאי להשתמש לסריקה מהירה של שרטוט אחד.</p>
        </div>
        <button type="button" className={styles.submit} autoFocus onClick={() => setOpen(false)}>
          הבנתי, להמשיך בטלפון
        </button>
        <button type="button" className={styles.adviceLink} onClick={() => void sendLink()}>
          {copied ? 'הקישור הועתק' : 'לשלוח לעצמי את הקישור למחשב'}
        </button>
      </div>
    </div>
  );
}
