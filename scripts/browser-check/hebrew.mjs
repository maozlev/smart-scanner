// A Hebrew sheet in a real browser: the pile schedule cannot be read as a cut list, so the
// operator maps its columns and the numbers become lines.
// Usage: node scripts/browser-check/hebrew.mjs <base url>     (needs fixtures/, which is not in the repo)
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const here = dirname(fileURLToPath(import.meta.url));
const base = process.argv[2] ?? 'http://localhost:3000';
const out = join(here, 'out');
const pdf = join(here, '..', '..', 'fixtures', 'tables', '833.1-01-20.pdf');
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

try {
  await page.goto(base + '/');
  await page.fill('input[name="username"]', credentials.AUTH_USERNAME ?? '');
  await page.fill('input[name="password"]', credentials.AUTH_PASSWORD ?? '');
  await page.click('button[type="submit"]');
  await page.waitForURL('**/scan', { timeout: 20000 });

  await page.setInputFiles('input[type="file"]', pdf);
  await page.waitForSelector('table.data tbody tr');
  const started = Date.now();
  await page.locator('header').getByRole('button', { name: 'סריקה', exact: true }).click();
  await page.waitForSelector('.mapping', { timeout: 300000 });
  check('scan finishes with tables to map', true, `${((Date.now() - started) / 1000).toFixed(1)} s`);
  check('no cut list was invented', (await page.locator('table.review').count()) === 0);

  const cards = page.locator('section.card', { has: page.locator('.mapping') });
  const count = await cards.count();
  console.log(`  ${count} tables offered for mapping`);
  for (let i = 0; i < count; i++) await cards.nth(i).screenshot({ path: join(out, `hebrew-table-${i}.png`) });

  // The pile schedule is the 12x7 table. Columns left to right: top level, length in metres,
  // diameter, type, X, Y, pile name. It has no quantity column: each row is one pile.
  const pile = page.locator('section.card', { hasText: '12×7' });
  check('the pile schedule is offered', (await pile.count()) === 1);
  const map =
    process.env.PILE_MAP ??
    JSON.stringify({ roles: ['ignore', 'length', 'ignore', 'ignore', 'ignore', 'ignore', 'label'], headerTop: 1, headerBottom: 0, unit: 'm', fixedType: 'כלונס', fixedQty: 1 });
  if (map) {
    const { roles, headerTop, headerBottom, unit, fixedType, fixedQty } = JSON.parse(map);
    const selects = pile.locator('table.mapping-grid select');
    for (let c = 0; c < roles.length; c++) await selects.nth(c).selectOption(roles[c]);
    const fields = pile.locator('.fields .field');
    await fields.nth(0).locator('input').fill(String(headerTop));
    await fields.nth(1).locator('input').fill(String(headerBottom));
    await fields.nth(2).locator('select').selectOption(unit);
    await fields.nth(3).locator('input').fill(fixedType);
    await fields.nth(4).locator('input').fill(String(fixedQty ?? ''));
    await pile.screenshot({ path: join(out, 'hebrew-mapping.png') });
    await pile.getByRole('button', { name: 'יצירת שורות' }).click();
    const mapped = page.locator('section.card', { has: page.locator('table.review') });
    await mapped.waitFor();
    const rows = mapped.locator('table.review tbody tr:not(.reasons)');
    const lines = [];
    for (let r = 0; r < (await rows.count()); r++) {
      const inputs = rows.nth(r).locator('input');
      lines.push((await Promise.all([0, 1, 2, 3, 4].map((i) => inputs.nth(i).inputValue()))).join('|'));
    }
    console.log(lines.map((l) => '  ' + l).join('\n'));
    check('nothing is approved before a person looks', (await mapped.locator('.chip.ok').count()) === 0);
    await mapped.screenshot({ path: join(out, 'hebrew-rows.png') });
    await mapped.getByRole('button', { name: 'אישור כל השורות השלמות' }).click();
    const approved = await mapped.locator('.chip.ok').count();
    check('whole rows are approved in one click', approved > 0, `${approved} of ${lines.length}`);
    await page.getByRole('button', { name: 'לסיכום וייצוא' }).click();
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'ייצוא CSV' }).click();
    await (await downloadPromise).saveAs(join(out, 'hebrew-cut-list.csv'));
    const csv = readFileSync(join(out, 'hebrew-cut-list.csv'), 'utf8').split('\r\n').filter(Boolean);
    check('the approved rows are exported', csv.length === approved + 1, `${csv.length - 1} lines`);
  }
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
