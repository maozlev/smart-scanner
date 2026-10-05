'use server';

import { createHash, timingSafeEqual } from 'node:crypto';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { SESSION_COOKIE, createSessionToken, sessionCookieOptions } from '@/lib/auth';

export interface LoginState {
  error: string | null;
}

// Compare digests so the comparison takes the same time whatever the input length.
function same(a: string, b: string): boolean {
  const digest = (s: string) => createHash('sha256').update(s).digest();
  return timingSafeEqual(digest(a), digest(b));
}

export async function login(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const { AUTH_USERNAME, AUTH_PASSWORD, AUTH_SECRET } = process.env;
  if (!AUTH_USERNAME || !AUTH_PASSWORD || !AUTH_SECRET) {
    return { error: 'הכניסה לא הוגדרה בשרת (חסרים AUTH_USERNAME / AUTH_PASSWORD / AUTH_SECRET).' };
  }
  const username = String(formData.get('username') ?? '');
  const password = String(formData.get('password') ?? '');
  if (username === '' || password === '') return { error: 'יש למלא שם משתמש וסיסמה' };
  const ok = same(username, AUTH_USERNAME) && same(password, AUTH_PASSWORD);
  if (!ok) return { error: 'שם משתמש או סיסמה שגויים.' };

  // Without "remember me" the cookie has no lifetime, so it ends with the browser session.
  const { maxAge, ...untilBrowserCloses } = sessionCookieOptions;
  const options = formData.get('remember') === 'on' ? sessionCookieOptions : untilBrowserCloses;
  (await cookies()).set(SESSION_COOKIE, await createSessionToken(), options);
  redirect('/scan');
}

export async function logout(): Promise<void> {
  (await cookies()).delete(SESSION_COOKIE);
  redirect('/');
}
