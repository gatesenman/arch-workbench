/* 真实接口全流程：仅当设置 DEEPSEEK_API_KEY 时运行 */
const { test, expect } = require('@playwright/test');
const fs = require('fs'), path = require('path');
const { fresh, createProject } = require('./helpers');
const KEY = process.env.DEEPSEEK_API_KEY, MODEL = process.env.DEEPSEEK_MODEL || 'deepseek-chat';
test.skip(!KEY, '未设置 DEEPSEEK_API_KEY，跳过真实接口全流程测试');
test.setTimeout(3600000);
test('REAL-PIPE 成都某中学：AI 自动推进 11 步（关键节点自动签字）', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 }); await fresh(page);
  await createProject(page, { name: '成都市某中学新建工程', code: 'SJ-2026-CD07', client: '成都市某区教育局', location: '四川省成都市武侯区', type: '中小学校', area: 36000, stage: '前期策划', leader: '张建国' });
  await page.evaluate(([k, m]) => { const db = JSON.parse(localStorage.getItem('aw-db-v2')); Object.assign(db.settings, { mode: 'llm', endpoint: 'https://api.deepseek.com', apiKey: k, model: m, stream: true, timeout: 120 }); const p = db.projects.find(x => x.id === db.currentProject); p.plan = { siteArea: 30000, far: 1.2, density: 30, green: 35, height: 24 }; localStorage.setItem('aw-db-v2', JSON.stringify(db)); }, [KEY, MODEL]);
  await page.reload(); await page.click('#tb-pipeline'); await page.selectOption('#plMode', 'key'); await page.click('#plStart');
  for (let i = 0; i < 12; i++) { await page.waitForFunction(() => !document.querySelector('#plStop'), null, { timeout: 900000 }); if (!(await page.locator('#plApprove').count())) break; await page.fill('#plComment', '同意，按 AI 成果推进'); await page.click('#plApprove'); }
  const db = await page.evaluate(() => { const d = JSON.parse(localStorage.getItem('aw-db-v2')); d.settings.apiKey = ''; localStorage.setItem('aw-db-v2', JSON.stringify(d)); return d; });
  const p = db.projects.find(x => x.id === db.currentProject); const dir = path.resolve(__dirname, '../test-results/real-api'); fs.mkdirSync(dir, { recursive: true });
  const rows = Object.entries(p.pipeline.steps).map(([id, s]) => { const r = p.runs.find(x => x.id === s.runId) || {}; return { id, status: s.status, source: r.source, elapsed: s.elapsed, error: s.error, len: (r.text || '').length }; });
  fs.writeFileSync(path.join(dir, 'pipeline.json'), JSON.stringify({ model: MODEL, rows, runs: p.runs.filter(r => r.pipeline).map(r => ({ step: r.step, source: r.source, text: r.text })) }, null, 2));
  await page.screenshot({ path: path.resolve(__dirname, '../screenshots/real-pipeline.png') });
  expect(rows.filter(r => r.status === 'approved' || r.status === 'auto').length).toBe(11);
  expect(rows.filter(r => r.source === 'mock' || r.error), JSON.stringify(rows)).toHaveLength(0);
});
