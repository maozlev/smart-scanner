// Archive and migration in a real browser: two scans of the NCD5168 fixture, a reload, a
// restore, and both kinds of migration.
// Usage: node scripts/browser-check/archive.mjs <base url>     (needs fixtures/, which is not in the repo)
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const here = dirname(fileURLToPath(import.meta.url));
const base = process.argv[2] ?? 'http://localhost:3000';
const out = join(here, 'out');
const pdf = join(here, '..', '..', 'fixtures', 'tables', 'NCD5168[_EN](5).pdf');
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
const page = await browser.newPage({ viewport: { width: 1400, height: 900 }, locale: 'he-IL', acceptDownloads: true });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

const tab = (name) => page.locator('nav.tabs').getByRole('button', { name });
const archiveRows = () => page.locator('section.card', { hasText: 'ארכיון סריקות' }).locator('tbody tr');
const scan = async () => {
  await page.setInputFiles('input[type="file"]', pdf);
  await page.locator('header').getByRole('button', { name: 'סריקה', exact: true }).click();
  await page.waitForSelector('.computing');
  await page.waitForSelector('.computing', { state: 'detached', timeout: 300000 });
  await page.waitForSelector('table.review');
};
const exportedLines = async () => {
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'ייצוא CSV' }).click();
  const path = join(out, 'archive-cut-list.csv');
  await (await downloadPromise).saveAs(path);
  return readFileSync(path, 'utf8').split('\r\n').filter(Boolean).slice(1);
};

try {
  await page.goto(base + '/');
  await page.fill('input[name="username"]', credentials.AUTH_USERNAME ?? '');
  await page.fill('input[name="password"]', credentials.AUTH_PASSWORD ?? '');
  await page.click('button[type="submit"]');
  await page.waitForURL('**/scan', { timeout: 20000 });
  await page.evaluate(() => localStorage.removeItem('scanner.archive'));
  await page.reload();

  await scan();
  await tab('ארכיון').click();
  check('the scan is archived on its own', (await archiveRows().count()) === 1);
  const cells = await archiveRows().first().locator('td').allInnerTexts();
  check('entry shows 30 approved lines and 161 pieces', cells[4] === '30' && cells[5] === '161', `${cells[4]} / ${cells[5]}`);
  check('entry is named after the file', (await archiveRows().first().locator('input[aria-label="שם הסריקה"]').inputValue()) === 'NCD5168[_EN](5)');

  // a review edit is written through to the entry: reject one row
  await tab('סקירה').click();
  await page.locator('table.review tbody tr:not(.reasons)').first().getByRole('button', { name: 'דחייה' }).click();
  await tab('ארכיון').click();
  check('rejecting a row updates the entry', (await archiveRows().first().locator('td').nth(4).innerText()) === '29');
  await archiveRows().first().locator('input[aria-label="שם הסריקה"]').fill('מגדל א');

  await page.reload();
  await tab('ארכיון').click();
  check('the archive survives a reload', (await archiveRows().count()) === 1);
  check('the new name survives a reload', (await archiveRows().first().locator('input[aria-label="שם הסריקה"]').inputValue()) === 'מגדל א');

  await archiveRows().first().getByRole('button', { name: 'שחזר' }).click();
  await page.waitForSelector('table.review');
  const restored = page.locator('table.review tbody tr:not(.reasons)');
  check('restore brings back 30 rows', (await restored.count()) === 30);
  check('restore keeps the decisions', (await page.locator('table.review .chip.ok').count()) === 29 && (await page.locator('table.review .chip.off').count()) === 1);
  await page.screenshot({ path: join(out, 'archive-restored.png') });

  // a second scan becomes a second entry
  await scan();
  await tab('ארכיון').click();
  check('a second scan is a second entry', (await archiveRows().count()) === 2);
  await page.screenshot({ path: join(out, 'archive.png') });

  for (let i = 0; i < 2; i++) await archiveRows().nth(i).locator('input[type="checkbox"]').check();
  await page.getByRole('button', { name: 'איחוד לחיתוך משותף' }).click();
  await page.waitForSelector('text=סיכום לפי חומר');
  check('merged migration keeps 10 materials', (await page.locator('table.data tbody tr').count()) === 10);
  const merged = await exportedLines();
  check('merged migration exports 59 lines', merged.length === 59, String(merged.length));
  check('merged types are untouched', merged.every((l) => !l.includes(' · ')));
  await tab('ארכיון').click();
  check('the migration is saved as a third entry', (await archiveRows().count()) === 3);
  const mergedName = await archiveRows().first().locator('input[aria-label="שם הסריקה"]').inputValue();
  check('the migration is named after its sources', mergedName.startsWith('איחוד: '), mergedName);

  for (let i = 1; i < 3; i++) await archiveRows().nth(i).locator('input[type="checkbox"]').check();
  await page.getByRole('button', { name: 'רשימה משולבת, כל סריקה בנפרד' }).click();
  await page.waitForSelector('text=סיכום לפי חומר');
  // 10 materials in one scan and 9 in the other, whose only 6 mm plate row was rejected
  const apart = await page.locator('table.data tbody tr').count();
  check('separate migration keeps each scan\'s materials apart', apart === 19, String(apart));
  const separate = await exportedLines();
  check('separate types carry the scan name', separate.length === 59 && separate.every((l) => l.includes(' · ')), separate[0]);
  await page.screenshot({ path: join(out, 'archive-migration.png') });

  await tab('ארכיון').click();
  await archiveRows().first().getByRole('button', { name: 'מחק' }).click();
  check('deleting removes the entry', (await archiveRows().count()) === 3);

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
