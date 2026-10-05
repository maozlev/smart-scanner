'use client';

import { useActionState, useState } from 'react';
import { login, type LoginState } from '@/app/actions';
import styles from './login.module.css';

const initial: LoginState = { error: null };

export function LoginForm({ notice }: { notice: string | null }) {
  const [state, action, pending] = useActionState(login, initial);
  const [showPassword, setShowPassword] = useState(false);
  const error = state.error ?? notice;

  return (
    <form action={action} className={styles.form}>
      <label className={styles.fieldLabel}>
        <span>שם משתמש</span>
        <input className={styles.input} name="username" autoComplete="username" autoFocus />
      </label>
      <label className={styles.fieldLabel}>
        <span>סיסמה</span>
        <div className={styles.passwordWrap}>
          <input className={styles.input} name="password" type={showPassword ? 'text' : 'password'} autoComplete="current-password" />
          <button
            type="button"
            className={styles.toggle}
            onClick={() => setShowPassword((s) => !s)}
            aria-label={showPassword ? 'הסתר סיסמה' : 'הצג סיסמה'}
            aria-pressed={showPassword}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M2.06 12.35a1 1 0 0 1 0-.7 10.75 10.75 0 0 1 19.88 0 1 1 0 0 1 0 .7 10.75 10.75 0 0 1-19.88 0" />
              <circle cx="12" cy="12" r="3" />
            </svg>
          </button>
        </div>
      </label>
      <label className={styles.remember}>
        <input type="checkbox" name="remember" defaultChecked />
        <span>זכור אותי</span>
      </label>

      {error && (
        <div className={styles.error} role="alert">
          {error}
        </div>
      )}

      <button type="submit" className={styles.submit} disabled={pending}>
        {pending ? 'מתחבר…' : 'כניסה'}
      </button>
    </form>
  );
}
