const { test, expect } = require('@playwright/test');
const { fresh, createProject, shot } = require('./helpers');
test.beforeEach(async ({ page }) => { await fresh(page); });
const waitIdle = page => page.waitForFunction(() => !document.querySelector('#plStop'), null, { timeout: 120000 });

test('US-28 AI 自动推进（离线）：11 步全流程、关键节点人工签字、退回重做、阶段推进', async ({ page }) => {
  await createProject(page); await page.keyboard.press('Control+p');
  await expect(page.locator('#pipeView')).toBeVisible(); await expect(page.locator('#plSteps .pl-step')).toHaveCount(11);
  await page.selectOption('#plMode', 'key'); await page.click('#plStart'); await waitIdle(page);
  // 任务书非关键节点 → AI 自动通过；场地分析为关键节点 → 等待人工
  await expect(page.locator('.pl-step[data-s="brief"]')).toHaveClass(/auto/); await expect(page.locator('.pl-step[data-s="site"]')).toHaveClass(/await/);
  await expect(page.locator('#plCheck')).toContainText('关键节点'); await expect(page.locator('#plOut')).toContainText('下一步建议');
  // 退回：必须填写意见
  await page.click('#plReject'); await expect(page.locator('.toast.err')).toContainText('请填写退回意见');
  await page.fill('#plComment', '限高按 24 m 复核'); await page.click('#plReject'); await waitIdle(page);
  await expect(page.locator('.pl-step[data-s="site"]')).toHaveClass(/await/);
  let guard = 0; while (guard++ < 12 && await page.locator('#plApprove').count()) { await page.click('#plApprove'); await waitIdle(page); }
  await expect(page.locator('#plProgress')).toHaveText('11 / 11 步已完成'); await expect(page.locator('.toast.ok').last()).toContainText('全流程已完成');
  await expect(page.locator('#sbStage')).toHaveText('阶段：竣工验收');
  // 规则工具被调用并被引用；记录由 AI 草拟、规则编号
  await page.click('.pl-step[data-s="indicators"]'); await expect(page.locator('#plOut')).toContainText('规则工具 calcIndicators 已执行'); await expect(page.locator('#plDetail')).toContainText('已确认签字：王设计');
  await page.click('.pl-step[data-s="drawings"]'); await expect(page.locator('#plOut')).toContainText('规则工具 drawingCheck');
  await page.click('#tree .titem[data-id="drawings"]'); await expect(page.locator('#recTable tr.ai').first()).toContainText('建施-');
  await page.click('#tree .titem[data-id="change"]'); await expect(page.locator('#recTable tr.ai')).toHaveCount(1); await expect(page.locator('#recTable')).toContainText('JSHD-');
  const db = await page.evaluate(() => JSON.parse(localStorage.getItem('aw-db-v2'))); const p = db.projects.find(x => x.id === db.currentProject);
  expect(p.records.signoff.map(x => x.step)).toEqual(['site', 'indicators', 'code', 'review', 'plancheck', 'completion']);
  expect(p.plan.height).toBeGreaterThan(0);
});
test('US-29 每步人工确认 + 人工修改：AI 参数载入表单', async ({ page }) => {
  await createProject(page); await page.click('#tb-pipeline'); await page.click('#plStart'); await waitIdle(page);
  await expect(page.locator('.pl-step[data-s="brief"]')).toHaveClass(/await/);
  await page.fill('#plSigner', ''); await page.click('#plApprove'); await expect(page.locator('.toast.err')).toContainText('请填写签字人');
  await page.click('#plEdit'); await expect(page.locator('#f-brief')).toBeVisible(); await expect(page.locator('.tab.active')).toContainText('任务书');
});
test('US-30 AI 填写 / AI 草拟（离线规则推算）与 AI 助手面板', async ({ page }) => {
  await createProject(page); await page.click('#tree .titem[data-id="indicators"]'); await page.click('#aiFillBtn');
  await expect(page.locator('.field.ai-filled')).not.toHaveCount(0); await expect(page.locator('#f-farLimit')).toHaveValue('1.2');
  await page.click('#tree .titem[data-id="review"]'); const n = await page.locator('#recTable tr[data-id]').count(); await page.click('#rAi');
  await expect(page.locator('#recTable tr.ai')).toHaveCount(3); expect(await page.locator('#recTable tr[data-id]').count()).toBe(n + 3);
  await page.keyboard.press('Control+l'); await expect(page.locator('#chatPanel')).toBeVisible();
  await page.fill('#chatInput', '下一步做什么？'); await page.keyboard.press('Enter');
  await expect(page.locator('#chatList .cm.assistant')).toContainText('建议下一步'); await expect(page.locator('#chatList .cm.assistant')).toContainText('离线工具规划');
  await shot(page, '22-AI助手.png');
});
test('US-31 AI 自动推进（模拟 DeepSeek 接口）：AI 生成 JSON 参数并流式出成果', async ({ page }) => {
  const ev = s => `data: ${JSON.stringify({ choices: [{ delta: { content: s } }] })}\n\n`; const seen = [];
  await page.route('https://fake-llm.test/chat/completions', r => { const b = JSON.parse(r.request().postData()); const u = b.messages[b.messages.length - 1].content; seen.push(u);
    const body = /返回 JSON：\{"values"/.test(u) ? JSON.stringify({ values: { brief: '成都某中学 48 班，总建筑面积 36000㎡。', siteArea: 30000, far: 1.2, height: 24 }, reason: '依据规划条件' }) : /"records"/.test(u) ? JSON.stringify({ records: [{ discipline: '建筑', title: '总平面图' }, { discipline: '建筑', title: '一层平面图' }], reason: 'AI' }) : '## 成果\n依据 GB 50352-2019。\n### 下一步建议\n- 确认';
    b.stream ? r.fulfill({ headers: { 'content-type': 'text/event-stream' }, body: ev(body) + 'data: [DONE]\n\n' }) : r.fulfill({ contentType: 'application/json', body: JSON.stringify({ choices: [{ message: { content: body } }] }) }); });
  await createProject(page);
  await page.evaluate(() => { const db = JSON.parse(localStorage.getItem('aw-db-v2')); Object.assign(db.settings, { mode: 'llm', endpoint: 'https://fake-llm.test', apiKey: 'sk-fake', model: 'deepseek-chat' }); localStorage.setItem('aw-db-v2', JSON.stringify(db)); });
  await page.reload(); await page.click('#tb-pipeline'); await page.selectOption('#plMode', 'key'); await page.click('#plStart'); await waitIdle(page);
  await expect(page.locator('.pl-step[data-s="site"]')).toHaveClass(/await/); await expect(page.locator('#plDetail')).toContainText('AI 填写依据：依据规划条件');
  await expect(page.locator('#plOut')).toContainText('GB 50352-2019');
  expect(seen.some(u => u.includes('【前序阶段成果摘要】'))).toBe(true); // 后续阶段引用前序成果
  await shot(page, '21-AI自动推进.png');
});
