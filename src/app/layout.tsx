import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './globals.css';

export const metadata: Metadata = {
  title: 'Smart Scanner — משרטוט לכתב כמויות',
  description: 'קריאת טבלאות חומרים וחיתוכים משרטוטים, והפקת רשימת חיתוך',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="he" dir="rtl">
      <body>
        {children}
      </body>
    </html>
  );
}
