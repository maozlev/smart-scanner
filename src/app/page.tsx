import { Dancing_Script, Frank_Ruhl_Libre } from 'next/font/google';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { Blueprint } from '@/components/login/Blueprint';
import { CardFrame, Signature } from '@/components/login/CardFrame';
import { LoginForm } from '@/components/login/LoginForm';
import { PhoneAdvice } from '@/components/login/PhoneAdvice';
import styles from '@/components/login/login.module.css';
import { SESSION_COOKIE, isValidSession } from '@/lib/auth';
import pkg from '../../package.json';

const loginFont = Frank_Ruhl_Libre({ subsets: ['hebrew', 'latin'], weight: ['300', '400', '500', '600'], variable: '--font-login' });

const scriptFont = Dancing_Script({ subsets: ['latin'], weight: ['400'], variable: '--font-script' });

const GOOGLE_ERRORS: Record<string, string> = {
  google_not_configured: 'כניסה דרך Google עדיין לא הוגדרה.',
  google_denied: 'חשבון ה-Google הזה אינו מורשה.',
  google_failed: 'הכניסה דרך Google נכשלה. נסה שוב.',
};

export default async function HomePage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  if (await isValidSession((await cookies()).get(SESSION_COOKIE)?.value)) redirect('/scan');
  const { error } = await searchParams;

  return (
    <main dir="rtl" className={`${styles.root} ${loginFont.variable} ${scriptFont.variable}`}>
      <Blueprint />
      <div className={styles.vignette} />
      <Signature />
      <PhoneAdvice />
      <div className={styles.stage}>
        <div className={styles.card}>
          <div className={styles.cardBg} />
          <CardFrame />
          <span className={`${styles.corner} ${styles.tr}`} />
          <span className={`${styles.corner} ${styles.tl}`} />
          <span className={`${styles.corner} ${styles.br}`} />
          <span className={`${styles.corner} ${styles.bl}`} />

          <div className={styles.body}>
            <h1 className={styles.tagline}>משרטוט לכתב כמויות ולרשימת חיתוך</h1>
            <LoginForm notice={(error && GOOGLE_ERRORS[error]) || null} />
            <div className={styles.alt}>
              <div className={styles.divider}>או</div>
              {/* a plain link: the route handler starts the OAuth redirect */}
              <a className={styles.google} href="/api/auth/google">
                כניסה עם Google
              </a>
            </div>
          </div>

          <div className={styles.titleBlock}>
            <div>גיליון כניסה</div>
            <div>קנ״מ 1:1</div>
            <div>גרסה {pkg.version}</div>
          </div>
        </div>
      </div>
    </main>
  );
}
