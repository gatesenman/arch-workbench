/* 真实大模型集成测试：仅当设置环境变量 DEEPSEEK_API_KEY 时运行（密钥不写入代码与产物）
 * 运行：DEEPSEEK_API_KEY=$(cat /workspace/.deepseek_key) [DEEPSEEK_MODEL=deepseek-chat] npx playwright test e2e/real-api.spec.js */
const { test, expect } = require('@playwright/test');
const fs = require('fs'), path = require('path');
const { fresh, createProject, openAgent, run, setField } = require('./helpers');
const KEY = process.env.DEEPSEEK_API_KEY, MODEL = process.env.DEEPSEEK_MODEL || 'deepseek-chat';
const REPORT = path.resolve(__dirname, '../test-results/real-api');
test.skip(!KEY, '未设置 DEEPSEEK_API_KEY，跳过真实接口测试');
test.describe.configure({ mode: 'serial', timeout: 600000 });

const AGENTS = ['brief', 'site', 'concept', 'render', 'report', 'permit', 'plancheck', 'indicators', 'cost', 'code', 'completion'];
let page;
test.beforeAll(async ({ browser }) => {
  fs.mkdirSync(REPORT, { recursive: true }); page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await fresh(page);
  await createProject(page, { name: '成都市某中学新建工程', code: 'SJ-2026-CD07', client: '成都市某区教育局', location: '四川省成都市武侯区', type: '中小学校', area: 36000, stage: '方案设计', leader: '张建国' });
  await page.evaluate(([k, m]) => { const db = JSON.parse(localStorage.getItem('aw-db-v2')); Object.assign(db.settings, { mode: 'llm', endpoint: 'https://api.deepseek.com', apiKey: k, model: m, stream: true, aiNotes: true, timeout: 120, maxTokens: 4000 }); localStorage.setItem('aw-db-v2', JSON.stringify(db)); }, [KEY, MODEL]);
  await page.reload(); await page.waitForSelector('#tree .titem');
});
test.afterAll(async () => { await page.evaluate(() => { const db = JSON.parse(localStorage.getItem('aw-db-v2')); db.settings.apiKey = ''; localStorage.setItem('aw-db-v2', JSON.stringify(db)); }); });

for (const id of AGENTS) {
  test(`REAL ${id}`, async () => {
    await openAgent(page, id);
    if (id === 'site') { for (const [k, v] of Object.entries({ location: '四川省成都市武侯区某地块', climate: 'Ⅲ 夏热冬冷地区', landUse: 'A33 中小学用地', siteArea: 30000, siteWidth: 200, siteDepth: 150, far: 1.2, density: 30, green: 35, height: 24, sunCoef: 1.0 })) await setField(page, k, v); }
    if (id === 'brief') await setField(page, 'brief', '一、项目概况：成都市某中学新建工程，办学规模 48 班初中（2400 名学生），规划用地面积约 30000㎡，总建筑面积约 36000㎡（其中地下约 6000㎡）。\n二、功能要求：普通教室 48 间、专用教室及实验室 3200㎡、图书馆 1500㎡、风雨操场 3000㎡、学生食堂 2600㎡、行政办公 1200㎡、300m 环形跑道运动场。\n三、技术要求：绿色建筑二星级，装配率不低于 50%，执行 GB 50099-2011。\n四、投资控制：约 2.6 亿元。\n五、进度：2026 年 12 月完成方案报批，2027 年 9 月开工。');
    if (id === 'indicators') { for (const [k, v] of Object.entries({ siteArea: 30000, aboveArea: 30000, belowArea: 6000, footprint: 8200, greenArea: 10800, height: 23.9, floorsAbove: 5, carRate: 0.5, carAbove: 20, carBelow: 110, bikeRate: 3, bikeProvided: 900 })) await setField(page, k, v); }
    if (id === 'cost') { await setField(page, 'type', '中小学校'); await setField(page, 'aboveArea', 30000); await setField(page, 'belowArea', 6000); await setField(page, 'region', '新一线城市'); }
    if (id === 'code') { await setField(page, 'height', 23.9); await setField(page, 'compArea', 3800); await setField(page, 'evacDist', 32); }
    const t0 = Date.now(); await run(page); const sec = ((Date.now() - t0) / 1000).toFixed(1);
    const badge = await page.locator('#srcBadge').innerText(); const text = await page.locator('#output').innerText(); const banner = await page.locator('.mock-banner').count();
    const ok = !banner && /AI 实时生成|规则计算 \+ AI 建议/.test(badge) && !/AI 说明与建议生成失败/.test(text);
    const err = banner ? (await page.locator('.mock-banner').innerText()) : (text.match(/AI 说明与建议生成失败：.*/) || [''])[0];
    fs.appendFileSync(path.join(REPORT, 'summary.tsv'), [new Date().toISOString(), id, MODEL, ok ? 'OK' : 'FAIL', sec, text.length, err.replace(/\s+/g, ' ').slice(0, 200)].join('\t') + '\n');
    fs.writeFileSync(path.join(REPORT, `${id}.md`), text);
    if (ok) await page.screenshot({ path: path.resolve(__dirname, `../screenshots/real-${id}.png`) });
    expect(ok, `真实接口失败：${err}`).toBe(true);
    expect(text.length).toBeGreaterThan(200);
    if (!['render'].includes(id)) expect(text).toMatch(/GB|规范|规定|标准/);
  });
}
