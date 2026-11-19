const { test, expect } = require('@playwright/test');
const { fresh, openAgent, run, shot } = require('./helpers');
test.beforeEach(async ({ page }) => { await fresh(page); });

test('US-35 示例项目预载与院标 docx 导出', async ({ page }) => {
  await expect(page.locator('#sbProject')).toContainText('成都市某中学');
  await expect(page.locator('#projectSelect')).toContainText('滨江社区文化中心');
  await openAgent(page, 'indicators'); await run(page);
  const [download] = await Promise.all([page.waitForEvent('download'), page.click('#wordBtn')]);
  expect(download.suggestedFilename()).toMatch(/\.docx$/i);
  const fs = require('fs'); const buf = fs.readFileSync(await download.path());
  expect(buf[0]).toBe(0x50); expect(buf[1]).toBe(0x4b);
  await shot(page, '24-院标docx与示例项目.png');
});
test('US-36 新手引导与院标模板库', async ({ page }) => {
  await page.evaluate(() => { const db = JSON.parse(localStorage.getItem('aw-db-v2')); db.onboarded = false; localStorage.setItem('aw-db-v2', JSON.stringify(db)); });
  await page.reload();
  await page.waitForSelector('#obOk', { timeout: 5000 });
  await expect(page.locator('#modalBody')).toContainText('人工把关');
  await page.click('#obOk');
  await page.click('#tb-templates');
  await expect(page.locator('#modalBody')).toContainText('01-设计任务书分析报告.docx');
  await page.click('#tplClose');
});
