const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const OUT = path.resolve('test-results/screenshots-2.5');
fs.mkdirSync(OUT, { recursive: true });
(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto('file://' + path.resolve('src/index.html'), { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#obOk', { timeout: 8000 });
  await page.screenshot({ path: path.join(OUT, '01-onboarding.png'), fullPage: false });
  await page.click('#obOk');
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(OUT, '02-dashboard-ctxbar.png'), fullPage: false });
  // pipeline
  await page.evaluate(() => { const b = [...document.querySelectorAll('button')].find(x => /自动推进|推进/.test(x.textContent||'') || x.title?.includes('推进')); if (b) b.click(); });
  await page.waitForTimeout(500);
  // try open via Ctrl+P
  await page.keyboard.press('Control+P');
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(OUT, '03-pipeline.png'), fullPage: false });
  // open brief agent
  await page.evaluate(() => {
    const n = [...document.querySelectorAll('.nav-item,[data-id],.tree-item')].find(el => /任务书/.test(el.textContent||''));
    if (n) n.click();
  });
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(OUT, '04-agent-empty-actions.png'), fullPage: false });
  // run
  await page.keyboard.press('F5');
  await page.waitForTimeout(800);
  await page.screenshot({ path: path.join(OUT, '05-agent-output.png'), fullPage: false });
  // theme light
  await page.keyboard.press('Control+T');
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(OUT, '06-light-theme.png'), fullPage: false });
  // palette
  await page.keyboard.press('Control+K');
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(OUT, '07-palette.png'), fullPage: false });
  await page.keyboard.press('Escape');
  // records empty/list
  await page.evaluate(() => {
    const n = [...document.querySelectorAll('.nav-item,[data-id],.tree-item')].find(el => /图纸目录|三级校审/.test(el.textContent||''));
    if (n) n.click();
  });
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(OUT, '08-records.png'), fullPage: false });
  console.log('SHOTS', fs.readdirSync(OUT).join(', '));
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
