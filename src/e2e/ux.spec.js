const { test, expect } = require('@playwright/test');
const { fresh, createProject, openAgent, shot } = require('./helpers');
test.beforeEach(async ({ page }) => { await fresh(page); });

test('US-32 记住最近项目/智能体；资源管理器阶段轨道与最近', async ({ page }) => {
  await createProject(page); await openAgent(page, 'indicators'); await openAgent(page, 'cost');
  await expect(page.locator('#tree .tgrp.recent')).toContainText('最近');
  await expect(page.locator('#tree .stage-rail .sr.cur')).toHaveCount(1);
  await page.reload(); await page.waitForSelector('#tree .titem');
  await expect(page.locator('.tab.active')).toContainText('估算');
  await page.keyboard.press('Control+Digit1');
  await expect(page.locator('.tab.active')).toContainText('估算');
});
test('US-33 标签溢出菜单、撤销删除、批量闭合', async ({ page }) => {
  await page.setViewportSize({ width: 1100, height: 800 });
  await createProject(page);
  for (const id of ['brief', 'site', 'concept', 'indicators', 'cost', 'code', 'permit', 'plancheck', 'render', 'report']) await openAgent(page, id);
  await expect(page.locator('#tabMore')).toBeVisible();
  await page.click('#tree .titem[data-id=review]');
  await page.click('#rAi'); await expect(page.locator('#recTable tr.ai').first()).toBeVisible();
  await page.locator('#recTable [data-ck]').first().evaluate(el => { el.checked = true; el.dispatchEvent(new Event('change', { bubbles: true })); });
  await page.click('#rBatchClose');
  await expect(page.locator('#recTable select[data-inline=status]').first()).toHaveValue('已闭合');
  const id = await page.locator('#recTable tr[data-id]').first().getAttribute('data-id');
  await page.click(`#recTable tr[data-id="${id}"]`); await page.click('#rDel'); await page.click('#cYes');
  await expect(page.locator(`#recTable tr[data-id="${id}"]`)).toHaveCount(0);
  await page.keyboard.press('Control+z');
  await expect(page.locator(`#recTable tr[data-id="${id}"]`)).toHaveCount(1);
});
test('US-34 表单自动聚焦、状态栏流水线迷你进度、粘性操作条', async ({ page }) => {
  await createProject(page); await page.click('#tb-pipeline'); await page.selectOption('#plMode', 'key'); await page.click('#plStart');
  await page.waitForFunction(() => !document.querySelector('#plStop'), null, { timeout: 60000 });
  await expect(page.locator('#sbPipe')).toBeVisible(); await expect(page.locator('#sbPipe')).toContainText('/');
  await page.click('#plApprove'); await page.waitForFunction(() => !document.querySelector('#plStop'));
  await openAgent(page, 'brief');
  await expect(page.locator('#f-brief')).toBeFocused({ timeout: 3000 });
  await expect(page.locator('.form-actions.sticky')).toBeVisible();
  await shot(page, '23-UX总览-迷你进度.png');
});
