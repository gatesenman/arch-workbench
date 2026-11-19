const { test, expect } = require('@playwright/test');
const { fresh, createProject, openAgent, run, dl } = require('./helpers');
const ev = s => `data: ${JSON.stringify({ choices: [{ delta: { content: s } }] })}\n\n`;
async function useLLM(page, extra = {}) {
  await page.evaluate(x => { const db = JSON.parse(localStorage.getItem('aw-db-v2')); Object.assign(db.settings, { mode: 'llm', endpoint: 'https://fake-llm.test', apiKey: 'sk-fake', model: 'deepseek-chat', stream: true, aiNotes: true }, x); localStorage.setItem('aw-db-v2', JSON.stringify(db)); }, extra);
  await page.reload(); await page.waitForSelector('#tree .titem');
}
test.beforeEach(async ({ page }) => { await fresh(page); });

test('US-25 SSE 流式显示：逐字渲染、状态徽标、结果入历史与导出', async ({ page }) => {
  let body = null;
  await page.route('https://fake-llm.test/chat/completions', async r => { body = JSON.parse(r.request().postData());
    await r.fulfill({ status: 200, headers: { 'content-type': 'text/event-stream' }, body: ': keep-alive\n\n' + ['## 设计任务书分析报告\n\n', '### 一、任务书要点\n', '| 项目 | 内容 |\n|---|---|\n| 总建筑面积 | 12000 ㎡ |\n', '\n依据 GB 50099-2011。'].map(ev).join('') + 'data: [DONE]\n\n' }); });
  await createProject(page); await useLLM(page);
  await openAgent(page, 'site'); await page.route('https://fake-llm.test/chat/completions', r => r.fulfill({ headers: { 'content-type': 'text/event-stream' }, body: ev('## 场地分析') + 'data: [DONE]\n\n' }));
  await run(page); await page.unroute('https://fake-llm.test/chat/completions');
  await page.route('https://fake-llm.test/chat/completions', async r => { body = JSON.parse(r.request().postData()); await r.fulfill({ headers: { 'content-type': 'text/event-stream' }, body: ['## 设计任务书分析报告\n\n', '| 项目 | 内容 |\n|---|---|\n| 总建筑面积 | 12000 ㎡ |\n', '\n依据 GB 50099-2011。'].map(ev).join('') + 'data: [DONE]\n\n' }); });
  await openAgent(page, 'brief'); await run(page);
  expect(body.stream).toBe(true); expect(body.model).toBe('deepseek-chat');
  expect(body.messages[1].content).toContain('城北中学扩建工程'); expect(body.messages[1].content).toContain('容积率 ≤ 1.5'); // 规划条件已注入上下文
  await expect(page.locator('#srcBadge')).toContainText('AI 实时生成');
  await expect(page.locator('#output table')).toHaveCount(1); await expect(page.locator('#output')).toContainText('GB 50099-2011');
  await expect(page.locator('.mock-banner')).toHaveCount(0);
  await expect(page.locator('#bottomBody')).toContainText('用时');
  const w = await dl(page, '#wordBtn'); expect(w.text).toContain('GB 50099-2011'); expect(w.text).not.toContain('sk-fake');
  const j = await dl(page, '#tb-exportProject'); expect(j.text).not.toContain('sk-fake');
});
test('US-26 规则型智能体追加 AI 说明与建议；AI 失败保留本地结果', async ({ page }) => {
  await page.route('https://fake-llm.test/chat/completions', r => r.fulfill({ headers: { 'content-type': 'text/event-stream' }, body: ev('## AI 说明与建议\n') + ev('1. 建议将计容面积减少 1000 ㎡。') + 'data: [DONE]\n\n' }));
  await createProject(page); await useLLM(page);
  await openAgent(page, 'indicators'); await run(page);
  await expect(page.locator('#srcBadge')).toContainText('规则计算 + AI 建议');
  await expect(page.locator('#output')).toContainText('主要经济技术指标表'); await expect(page.locator('#output h4', { hasText: 'AI 说明与建议' })).toHaveCount(1);
  await page.unroute('https://fake-llm.test/chat/completions'); await page.route('https://fake-llm.test/chat/completions', r => r.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { message: 'Service is too busy' } }) }));
  await openAgent(page, 'code'); await run(page);
  await expect(page.locator('#output')).toContainText('规范符合性校核报告'); await expect(page.locator('#output')).toContainText('AI 说明与建议生成失败：HTTP 503');
  await expect(page.locator('.toast.err')).toContainText('已保留本地计算结果');
});
test('US-27 等待超时与手动停止：回退模拟并提示', async ({ page }) => {
  await page.route('https://fake-llm.test/chat/completions', () => { /* 永不响应 */ });
  await createProject(page); await useLLM(page, { timeout: 1 });
  await openAgent(page, 'render'); await run(page);
  await expect(page.locator('.mock-banner')).toContainText('等待模型响应超时（1 秒）');
  await useLLM(page, { timeout: 60 }); await openAgent(page, 'render');
  await page.click('#runBtn'); await expect(page.locator('#stopBtn')).toBeVisible(); await expect(page.locator('#srcBadge')).toContainText('等待模型响应');
  await page.click('#stopBtn'); await page.waitForFunction(() => !document.querySelector('#runBtn').disabled);
  await expect(page.locator('.mock-banner')).toContainText('已取消'); await expect(page.locator('#stopBtn')).toBeHidden();
});
