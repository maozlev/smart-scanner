// Records the demo video shown in the help dialog: a real browser walking through the app on
// the demo drawing.
//   node scripts/demo-video/record.mjs <base url> <ffmpeg path>
// Writes public/demo-video/demo.mp4 and poster.jpg. Needs a full ffmpeg (H.264) for the
// conversion, e.g. the binary from the `ffmpeg-static` package, because the browser records WebM.
// When the screens change, the film goes stale: record it again.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const base = process.argv[2];
const ffmpeg = process.argv[3];
if (!base || !ffmpeg) throw new Error('usage: record.mjs <base url> <ffmpeg path>');

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const work = path.join(root, 'scripts', 'demo-video', 'out');
const target = path.join(root, 'public', 'demo-video');
fs.rmSync(work, { recursive: true, force: true });
fs.mkdirSync(work, { recursive: true });
fs.mkdirSync(target, { recursive: true });

const credentials = { AUTH_USERNAME: process.env.AUTH_USERNAME, AUTH_PASSWORD: process.env.AUTH_PASSWORD };
try {
  for (const line of fs.readFileSync(path.join(root, '.env.local'), 'utf8').split(/\r?\n/)) {
    const [key, ...rest] = line.split('=');
    if (key in credentials) credentials[key] ??= rest.join('=').trim();
  }
} catch {
  // no .env.local: the environment variables are the only source
}

// a small window and a large caption: the film is also watched on a phone, where 1280 px would be unreadable
const SIZE = { width: 1040, height: 585 };
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const context = await browser.newContext({ viewport: SIZE, locale: 'he-IL', recordVideo: { dir: work, size: SIZE } });
const recordingStarted = Date.now();

// a visible pointer and a caption bar, re-created on every page load
await context.addInitScript(() => {
  const build = () => {
    if (document.getElementById('demo-cursor')) return;
    const cursor = document.createElement('div');
    cursor.id = 'demo-cursor';
    cursor.style.cssText =
      'position:fixed;z-index:99999;width:22px;height:22px;margin:-11px 0 0 -11px;border-radius:50%;pointer-events:none;' +
      'background:rgba(255,196,60,.55);border:2px solid #fff;box-shadow:0 0 0 1px rgba(0,0,0,.35);left:-50px;top:-50px;transition:transform .12s';
    const caption = document.createElement('div');
    caption.id = 'demo-caption';
    caption.dir = 'rtl';
    caption.style.cssText =
      'position:fixed;z-index:99998;left:0;right:0;bottom:18px;margin:0 auto;width:fit-content;max-width:90%;padding:12px 26px;border-radius:10px;' +
      'pointer-events:none;font:600 30px/1.3 "Segoe UI",system-ui,sans-serif;color:#fff;background:rgba(15,26,48,.94);' +
      'box-shadow:0 6px 24px rgba(0,0,0,.35);text-align:center;opacity:0;transition:opacity .3s';
    document.body.append(cursor, caption);
    window.addEventListener('mousemove', (e) => {
      cursor.style.left = `${e.clientX}px`;
      cursor.style.top = `${e.clientY}px`;
    });
    window.addEventListener('mousedown', () => (cursor.style.transform = 'scale(.7)'));
    window.addEventListener('mouseup', () => (cursor.style.transform = 'none'));
  };
  if (document.body) build();
  else document.addEventListener('DOMContentLoaded', build);
});

const page = await context.newPage();
const wait = (ms) => page.waitForTimeout(ms);
const caption = async (text) => {
  await page.evaluate((t) => {
    const el = document.getElementById('demo-caption');
    if (!el) return;
    el.textContent = t;
    el.style.opacity = t ? '1' : '0';
  }, text);
};
const moveTo = async (locator) => {
  await locator.scrollIntoViewIfNeeded();
  const box = await locator.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 28 });
};
// moves the pointer to the element the way a person would, then clicks it
const click = async (locator, pause = 450) => {
  await moveTo(locator);
  await wait(pause);
  await locator.click();
};
const tab = (name) => page.locator('nav.tabs').getByRole('button', { name });

// --- not part of the film: log in, start from an empty archive ---
await page.goto(base + '/');
await page.fill('input[name="username"]', credentials.AUTH_USERNAME ?? '');
await page.fill('input[name="password"]', credentials.AUTH_PASSWORD ?? '');
await page.click('button[type="submit"]');
await page.waitForURL('**/scan');
await page.evaluate(() => localStorage.removeItem('scanner.archive'));
await page.reload();
await page.getByRole('button', { name: 'טעינת שרטוט לדוגמה' }).waitFor();
await page.mouse.move(520, 380);
await wait(600);
const filmStarts = Date.now() - recordingStarted;

// --- the film ---
await caption('מטבלת הכמויות שבשרטוט לרשימת חיתוך');
await wait(2800);

await caption('מעלים שרטוטים: קובצי PDF מתוכנת השרטוט');
await click(page.getByRole('button', { name: 'טעינת שרטוט לדוגמה' }));
await page.waitForSelector('table.data tbody tr');
await wait(2000);

await caption('המערכת מאתרת את הטבלה וקוראת אותה');
await click(page.locator('header').getByRole('button', { name: 'סריקה', exact: true }));
await page.waitForSelector('table.review', { timeout: 120000 });
await caption('');
await wait(500);
const posterAt = Date.now() - recordingStarted + 2500;

await caption('למעלה: הטבלה כפי שהיא בשרטוט');
await moveTo(page.locator('.table-scan'));
await wait(3400);
await caption('מתחתיה: הכמויות שנקראו, שורה לכל חלק');
await page.locator('table.review').evaluate((el) => el.scrollIntoView({ behavior: 'smooth', block: 'start' }));
await wait(900);
await page.mouse.move(560, 300, { steps: 20 });
await wait(3000);
await caption('שורה שהחשבון שלה מסתדר מאושרת אוטומטית');
await moveTo(page.locator('table.review .chip.ok').nth(1));
await wait(3000);
await caption('כל ערך אפשר לתקן, לאשר או לדחות');
await moveTo(page.locator('table.review tbody tr:not(.reasons)').nth(2).locator('input[aria-label="אורך"]'));
await wait(1200);
await moveTo(page.locator('table.review tbody tr:not(.reasons)').nth(2).getByRole('button', { name: 'דחייה' }));
await wait(2400);

await caption('');
await click(page.getByRole('button', { name: 'לסיכום וייצוא' }));
await page.waitForSelector('text=סיכום לפי חומר');
await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' }));
await wait(600);
await caption('סיכום לפי חומר');
await page.mouse.move(560, 300, { steps: 20 });
await wait(2800);
await caption('ומייצאים קובץ Excel שמחשבון הנסטינג מייבא');
await moveTo(page.getByRole('button', { name: 'ייצוא XLSX' }));
await wait(3400);

await caption('');
await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' }));
await wait(500);
await click(tab('ארכיון'));
await page.waitForSelector('text=ארכיון סריקות');
await caption('כל סריקה נשמרת בארכיון, ואפשר לאחד כמה סריקות');
await moveTo(page.locator('section.card', { hasText: 'ארכיון סריקות' }).locator('tbody tr').first());
await wait(3600);

await caption('טבלה בעברית? מסמנים מה כל עמודה מכילה. ״הסבר״ מפרט');
await moveTo(page.locator('header').getByRole('button', { name: 'הסבר' }));
await wait(3800);
const filmEnds = Date.now() - recordingStarted;

const video = page.video();
await context.close();
await browser.close();
const raw = await video.path();

const from = (filmStarts / 1000).toFixed(2);
const length = ((filmEnds - filmStarts) / 1000).toFixed(2);
const run = (args) => execFileSync(ffmpeg, ['-y', '-loglevel', 'error', ...args], { stdio: 'inherit' });
run(['-ss', from, '-t', length, '-i', raw, '-an', '-c:v', 'libx264', '-preset', 'slow', '-crf', '27', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', path.join(target, 'demo.mp4')]);
// the poster: the review screen, with its first caption up
run(['-ss', (posterAt / 1000).toFixed(2), '-i', raw, '-frames:v', '1', '-q:v', '4', path.join(target, 'poster.jpg')]);
fs.rmSync(work, { recursive: true, force: true });

const mb = (file) => (fs.statSync(path.join(target, file)).size / 1e6).toFixed(2);
console.log(`demo.mp4 ${mb('demo.mp4')} MB, ${length} s; poster.jpg ${mb('poster.jpg')} MB`);
