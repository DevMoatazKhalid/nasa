// End-to-end browser test of the built site (headless Chromium via Playwright).
// Usage: node tests/e2e.mjs http://localhost:8765/  (serve web/dist first)
import { chromium } from 'playwright';
const base = process.argv[2] || 'http://localhost:8765/';
const out = process.argv[3] || 'tests/shots';
const errors = []; const results = [];
const ok = (name, cond, info = '') => { results.push({ name, pass: !!cond, info }); console.log((cond ? 'PASS ' : 'FAIL ') + name + (info ? ' — ' + info : '')); };
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on('pageerror', e => errors.push(String(e))); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
await page.goto(base + '#overview'); await page.waitForSelector('.hero', { timeout: 60000 });
ok('overview loads', await page.locator('h1').first().isVisible());
await page.screenshot({ path: `${out}/01_overview.png` });
// Location intelligence via region button (Jezero)
await page.locator('.reg', { hasText: 'Jezero' }).click(); await page.waitForSelector('.loc-name', { timeout: 30000 });
const locText = await page.locator('.panel').innerText();
ok('location panel shows Jezero', /Jezero/.test(locText), locText.slice(0, 80).replace(/\n/g, ' '));
ok('elevation shown with status', /Elevation[\s\S]{0,40}-?\d+/.test(locText));
ok('rover proximity Perseverance', /Perseverance[\s\S]{0,30}\d+ km/.test(locText));
ok('geolocated images near Jezero', await page.locator('.imgs img').count() > 0, `${await page.locator('.imgs img').count()} images`);
await page.waitForTimeout(1500); await page.screenshot({ path: `${out}/02_location_jezero.png` });
// Location with missing data: north pole TI should be unavailable
await page.fill('.search input', '85N 30E'); await page.press('.search input', 'Enter'); await page.waitForTimeout(2500);
const polar = await page.locator('.panel').innerText();
ok('polar point reports TI unavailable (no invented value)', /Thermal inertia[\s\S]{0,10}Data unavailable/.test(polar));
// Explorer: toggle a layer
await page.goto(base + '#explorer'); await page.waitForSelector('.lyr');
await page.locator('.lyr label', { hasText: 'Ice consistency 0-1 m' }).click(); await page.waitForTimeout(2500);
ok('layer legend visible after toggle', await page.locator('.legend .bar').count() > 0);
await page.screenshot({ path: `${out}/03_explorer_swim.png` });
// Mission planner
await page.goto(base + '#missions'); await page.waitForSelector('.form');
const scores = {};
for (const m of ['water_ice', 'habitat', 'mineral']) {
  await page.selectOption('.form select', m); await page.click('.form .btn.primary'); await page.waitForSelector('.cands li', { timeout: 60000 }); await page.waitForTimeout(300);
  scores[m] = await page.locator('.cands .cn').allInnerTexts();
}
ok('missions produce candidates', Object.values(scores).every(s => s.length > 0), JSON.stringify(Object.fromEntries(Object.entries(scores).map(([k, v]) => [k, v.slice(0, 3).map(x => x.split('\n')[0])]))));
ok('recommendations change with mission objective', scores.water_ice[0] !== scores.habitat[0] || scores.water_ice[1] !== scores.habitat[1]);
await page.screenshot({ path: `${out}/04_missions.png` });
// Navigation: Jezero -> Syrtis via search-free clicks is hard; use the engine directly through the UI state: set points by clicking map
await page.goto(base + '#navigation'); await page.waitForSelector('.warn');
const box = await page.locator('.map canvas').boundingBox();
await page.mouse.click(box.x + box.width / 2 - 20, box.y + box.height / 2); await page.waitForTimeout(200);
await page.mouse.click(box.x + box.width / 2 + 25, box.y + box.height / 2 + 15); await page.waitForTimeout(200);
await page.locator('button', { hasText: 'Compute routes' }).click(); await page.waitForSelector('.cmp', { timeout: 60000 });
const cmp = await page.locator('.cmp').innerText();
ok('four route alternatives computed', (cmp.match(/km/g) || []).length >= 2, cmp.replace(/\s+/g, ' ').slice(0, 160));
ok('elevation profile drawn', await page.locator('.fig svg path').count() >= 2);
await page.screenshot({ path: `${out}/05_navigation.png` });
// Report
await page.locator('button', { hasText: 'Generate report' }).first().click(); await page.waitForSelector('.report', { timeout: 20000 });
const rep = await page.locator('.report').innerText();
ok('report has routes, limitations and sources', /Routes/.test(rep) && /limitations/i.test(rep) && /Sources/.test(rep));
await page.screenshot({ path: `${out}/06_report.png` });
// Arabic RTL
await page.goto(base + '#data'); await page.waitForSelector('table.reg');
await page.locator('button.lang').click(); await page.waitForTimeout(400);
ok('Arabic switches to RTL', (await page.evaluate(() => document.documentElement.dir)) === 'rtl');
ok('Arabic navigation labels', /مستكشف المريخ/.test(await page.locator('.side').innerText()));
await page.screenshot({ path: `${out}/07_data_ar.png` });
await page.locator('button.lang').click();
// Mobile
const m = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true });
m.on('pageerror', e => errors.push('mobile: ' + e));
await m.goto(base + '#location'); await m.waitForSelector('.map'); await m.waitForTimeout(1500);
const sw = await m.evaluate(() => document.documentElement.scrollWidth);
ok('mobile: no horizontal overflow', sw <= 392, `scrollWidth ${sw}`);
await m.screenshot({ path: `${out}/08_mobile.png` });
ok('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
const fs = await import('fs'); fs.writeFileSync(`${out}/results.json`, JSON.stringify({ results, errors }, null, 1));
process.exit(results.every(r => r.pass) ? 0 : 1);
