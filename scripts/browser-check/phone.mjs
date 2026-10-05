// The app on a phone-sized touch screen, in a real browser, using the demo drawing (which is
// in the repository): the notice on the login page, the bottom action bar, the whole flow, the
// help dialog, and that no screen spills sideways.
// Usage: node scripts/browser-check/phone.mjs <base url>
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const here = dirname(fileURLToPath(import.meta.url));
const base = process.argv[2] ?? 'http://localhost:3000';
const out = join(here, 'out');
mkdirSync(out, { recursive: true });

const credentials = { AUTH_USERNAME: process.env.AUTH_USERNAME, AUTH_PASSWORD: process.env.AUTH_PASSWORD };
try {
  for (const line of readFileSync(join(here, '..', '..', '.env.local'), 'utf8').split(/\r?\n/)) {
    const [key, ...rest] = line.split('=');
    if (key in credentials) credentials[key] ??= rest.join('=').trim();
  }
} catch {
  // no .env.local: the environment variables are the only source
}

let failed = 0;
const check = (name, ok, detail = '') => {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
};

const browser = await chromium.launch({ channel: 'msedge', headless: true });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, locale: 'he-IL' });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

// nothing may be wider than the screen: a page that scrolls sideways is broken on a phone
const fits = async (what) => {
  const { content, screen } = await page.evaluate(() => ({ content: document.documentElement.scrollWidth, screen: document.documentElement.clientWidth }));
  check(`${what}: fits the screen width`, content <= screen + 1, `${content}px in ${screen}px`);
};
const shot = (name) => page.screenshot({ path: join(out, `phone-${name}.png`) });
const visible = (locator) => locator.isVisible();

try {
  await page.goto(base + '/');
  const advice = page.getByRole('alertdialog', { name: 'מומלץ להשתמש במחשב' });
  await advice.waitFor({ state: 'visible', timeout: 5000 });
  const adviceText = await advice.innerText();
  check('login on a phone opens with the "a computer is recommended" notice', adviceText.includes('עובדת גם בטלפון') && adviceText.includes('סריקה'), adviceText.replace(/\s+/g, ' ').slice(0, 60));
  const covered = await page.evaluate(() => {
    const field = document.querySelector('input[name="username"]').getBoundingClientRect();
    return !document.elementFromPoint(field.x + field.width / 2, field.y + field.height / 2)?.closest('form');
  });
  check('the notice covers the login form until it is acknowledged', covered);
  await shot('advice');
  await advice.getByRole('button', { name: 'הבנתי, להמשיך בטלפון' }).tap();
  await advice.waitFor({ state: 'hidden', timeout: 5000 });
  await page.waitForTimeout(3500); // the login card fades in
  await fits('login');

  await page.fill('input[name="username"]', credentials.AUTH_USERNAME ?? '');
  await page.fill('input[name="password"]', credentials.AUTH_PASSWORD ?? '');
  await page.locator('button[type="submit"]').tap();
  await page.waitForURL('**/scan', { timeout: 20000 });

  const bar = page.locator('.quickbar');
  check('the action bar is at the bottom of the screen', (await visible(bar)) && (await bar.boundingBox()).y > 700);
  check('the header keeps only clear, help and logout', !(await visible(page.locator('header button.desk-only').first())) && (await visible(page.locator('header').getByRole('button', { name: 'הסבר' }))));
  check('scan is disabled with no drawing', await bar.getByRole('button', { name: 'סריקה' }).isDisabled());
  await fits('empty screen');
  await shot('empty');

  // --- help ---
  await page.locator('header').getByRole('button', { name: 'הסבר' }).tap();
  const help = page.getByRole('dialog', { name: 'הסבר על המערכת' });
  await help.waitFor();
  check('help opens with the demo video on top', (await help.locator('video source').getAttribute('src')) === '/demo-video/demo.mp4');
  const assets = await page.evaluate(async () => {
    const status = async (url) => (await fetch(url, { method: 'HEAD' })).status;
    return [await status('/demo-video/demo.mp4'), await status('/demo-video/poster.jpg'), await status('/demo/demo-drawing.pdf')];
  });
  check('the video, its poster and the demo drawing are served', assets.every((s) => s === 200), assets.join(' '));
  await fits('help');
  await shot('help');
  await help.getByRole('button', { name: 'סגור' }).tap();
  await help.waitFor({ state: 'hidden' });

  // --- the flow, on the demo drawing ---
  await page.getByRole('button', { name: 'טעינת שרטוט לדוגמה' }).tap();
  await page.waitForSelector('table.data tbody tr');
  await fits('file list');
  const started = Date.now();
  await bar.getByRole('button', { name: 'סריקה' }).tap();
  await page.waitForSelector('table.review', { timeout: 300000 });
  check('scan from the bottom bar opens the review', true, `${((Date.now() - started) / 1000).toFixed(1)} s`);
  const rows = page.locator('table.review tbody tr:not(.reasons)');
  check('8 rows, all approved', (await rows.count()) === 8 && (await page.locator('table.review .chip.ok').count()) === 8);
  const card = await rows.first().evaluate((tr) => ({ display: getComputedStyle(tr).display, label: getComputedStyle(tr.children[1], '::before').content }));
  check('each row is a card with labelled fields', card.display === 'block' && card.label.includes('סוג'), `${card.display} ${card.label}`);
  const scanned = await page.locator('.table-scan img').boundingBox();
  const frame = await page.locator('.table-scan').boundingBox();
  check('the scanned table keeps a readable size and scrolls in its own window', scanned.width >= 700 && frame.width <= 390, `${Math.round(scanned.width)}px in a ${Math.round(frame.width)}px window`);
  await fits('review');
  await shot('review');

  // editing with the phone keyboard: empty a length, then restore it
  const length = rows.first().locator('input[aria-label="אורך"]');
  await length.fill('');
  check('emptied length takes the row out', (await page.locator('table.review .chip.warn').count()) === 1);
  await length.fill('4200');
  check('restored length puts it back', (await page.locator('table.review .chip.ok').count()) === 8);

  await page.getByRole('button', { name: 'לסיכום וייצוא' }).tap();
  await page.waitForSelector('text=סיכום לפי חומר');
  check('summary lists 8 materials as cards', (await page.locator('table.cards tbody tr').count()) === 8);
  await fits('summary');
  await shot('summary');

  await page.locator('nav.tabs').getByRole('button', { name: 'ארכיון' }).tap();
  await page.waitForSelector('text=ארכיון סריקות');
  check('the scan is in the archive', (await page.locator('section.card', { hasText: 'ארכיון סריקות' }).locator('tbody tr').count()) >= 1);
  await fits('archive');
  await shot('archive');

  check('no browser errors', errors.length === 0, errors.join(' | '));
} catch (error) {
  failed++;
  console.log('FAIL  flow stopped:', String(error).split('\n')[0]);
  console.log('  browser errors:', errors.join(' | '));
  await page.screenshot({ path: join(out, 'failure.png'), fullPage: true });
} finally {
  await browser.close();
}
process.exit(failed ? 1 : 0);
