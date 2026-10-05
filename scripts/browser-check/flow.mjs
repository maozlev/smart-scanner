// Drives a real browser (installed Edge) through the whole flow on the NCD5168 fixture:
// login, upload, scan, review, summary, CSV export.
// Usage: node scripts/browser-check/flow.mjs <base url>     (needs fixtures/, which is not in the repo)
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const here = dirname(fileURLToPath(import.meta.url));
const base = process.argv[2] ?? 'http://localhost:3000';
const out = join(here, 'out');
const pdf = join(here, '..', '..', 'fixtures', 'tables', 'NCD5168[_EN](5).pdf');
mkdirSync(out, { recursive: true });

// the login the local server accepts: the environment, else .env.local (never written here)
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
const page = await browser.newPage({ viewport: { width: 1400, height: 900 }, locale: 'he-IL', acceptDownloads: true });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
page.on('response', (r) => r.status() >= 400 && console.log('  HTTP', r.status(), r.url()));

try {
  await page.goto(base + '/');
  await page.fill('input[name="username"]', credentials.AUTH_USERNAME ?? '');
  await page.fill('input[name="password"]', credentials.AUTH_PASSWORD ?? '');
  await page.click('button[type="submit"]');
  await page.waitForURL('**/scan', { timeout: 20000 });
  check('login reaches the scan page', true);

  await page.setInputFiles('input[type="file"]', pdf);
  await page.waitForSelector('table.data tbody tr');
  const started = Date.now();
  await page.locator('header').getByRole('button', { name: 'סריקה', exact: true }).click();
  await page.waitForSelector('.computing');
  check('progress dialog appears', true);
  await page.waitForSelector('table.review', { timeout: 300000 });
  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  check('scan finishes and opens the review', true, `${seconds} s`);

  const alerts = await page.locator('.alert').allInnerTexts();
  check('review shows no error', alerts.length === 0, alerts.join(' | '));
  const rows = page.locator('table.review tbody tr:not(.evidence)');
  check('30 rows read', (await rows.count()) === 30, String(await rows.count()));
  const auto = await page.locator('table.review .chip.ok').count();
  check('all 30 rows auto-approved', auto === 30, String(auto));
  check('grand total note shown', (await page.getByText('3814.4').count()) > 0);
  const first = rows.nth(2).locator('input');
  const values = await Promise.all([0, 1, 2, 3, 4].map((i) => first.nth(i).inputValue()));
  check('row 828 reads L60X60X6 / 1052 / 4', values.join('|') === 'L60X60X6|828 Horizontal|1052||4', values.join('|'));
  const images = await page.locator('table.review tr.evidence img').evaluateAll((list) => list.filter((i) => i.naturalWidth > 100).length);
  check('every row shows its drawing strip', images === 30, String(images));
  await page.screenshot({ path: join(out, 'review.png') });
  const unknown = page.locator('img.unknown-table');
  for (let i = 0; i < (await unknown.count()); i++) await unknown.nth(i).screenshot({ path: join(out, `unknown-${i}.png`) });

  // a wrong edit must take the row out of the list until it is whole again
  await first.nth(2).fill('');
  check('emptied length leaves the list', (await page.locator('table.review .chip.warn').count()) === 1);
  await first.nth(2).fill('1052');
  check('restored length is approved again', (await page.locator('table.review .chip.ok').count()) === 30);

  await page.getByRole('button', { name: 'לסיכום וייצוא' }).click();
  await page.waitForSelector('text=סיכום לפי חומר');
  const types = await page.locator('table.data tbody tr').count();
  check('summary lists 10 materials', types === 10, String(types));
  // the sheet's other tables (bolts, packages, revisions) were read and are not cut lists:
  // they must not raise the "left out" warning
  check('summary warns about nothing', (await page.locator('.alert').count()) === 0);
  await page.screenshot({ path: join(out, 'summary.png') });

  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'ייצוא CSV' }).click();
  const download = await downloadPromise;
  const csvPath = join(out, 'cut-list.csv');
  await download.saveAs(csvPath);
  const csv = readFileSync(csvPath, 'utf8');
  // not trim(): it would eat the byte-order mark the header is checked for
  const lines = csv.split('\r\n').filter(Boolean);
  check('CSV has the header and 30 lines', lines.length === 31 && lines[0] === '\uFEFFסוג,סימון,אורך,רוחב,כמות', `${lines.length} lines`);
  check('CSV line for item 828', lines.includes('L60X60X6,828 Horizontal,1052,,4'));
  if (process.env.EXPECT_CSV) check('CSV equals the Node pipeline output', csv === readFileSync(process.env.EXPECT_CSV, 'utf8'));

  const xlsxPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'ייצוא XLSX' }).click();
  await (await xlsxPromise).saveAs(join(out, 'cut-list.xlsx'));
  check('XLSX downloads', true);

  check('no browser errors', errors.length === 0, errors.join(' | '));
} catch (error) {
  failed++;
  console.log('FAIL  flow stopped:', String(error).split('\n')[0]);
  console.log('  browser errors:', errors.join(' | '));
  await page.screenshot({ path: join(out, 'failure.png') });
} finally {
  await browser.close();
}
process.exit(failed ? 1 : 0);
