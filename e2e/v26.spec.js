const { test, expect } = require('@playwright/test');
const path = require('path'), fs = require('fs');
const { fresh, openAgent, run, setField } = require('./helpers');
const AW = require('../src/agents.js'), PRO = require('../src/pro.js'), DOCX = require('../src/docx.js');
const FX = n => path.resolve(__dirname, 'fixtures', n);

test.describe('v2.6 规则引擎与工具（Node）', () => {
  test('V01 GB 50016 分类型疏散距离与防火分区', () => {
    expect(AW.evacLimit('中小学校', false, '否').between).toBe(35);
    expect(AW.evacLimit('中小学校', true, '否')).toMatchObject({ between: 30, dead: 15 });
    expect(AW.evacLimit('医院', true, '是').between).toBe(30);
    expect(AW.evacLimit('托儿所幼儿园', false, '否').dead).toBe(20);
    expect(AW.evacLimit('办公', false, '是')).toMatchObject({ between: 50, dead: 27.5 });
    expect(AW.compartmentLimit({ high: true, sprinkler: '是' }).limit).toBe(3000);
    expect(AW.compartmentLimit({ high: false, sprinkler: '否' }).limit).toBe(2500);
    expect(AW.compartmentLimit({ underground: true, sprinkler: '是' }).limit).toBe(1000);
    expect(AW.compartmentLimit({ type: '商业', high: false, sprinkler: '是', hall: '是', singleOrFirst: '是' }).limit).toBe(10000);
    expect(AW.compartmentLimit({ type: '商业', high: true, sprinkler: '是', hall: '是' }).limit).toBe(4000);
  });
  test('V02 规范校核：学校疏散 40m 不满足，日照按 GB 50099', () => {
    const a = AW.AGENTS.find(x => x.id === 'code'); const i = Object.fromEntries(a.fields.map(f => [f.key, f.default]));
    const r = AW.checkCompliance({ ...i, btype: '中小学校', sprinkler: '否', evacDist: 38, sunHours: 1.5, deadEnd: 25, basementComp: 800 });
    const bad = r.rows.filter(x => !x.pass).map(x => x.item).join('|');
    expect(bad).toContain('中小学校'); expect(bad).toContain('普通教室日照'); expect(bad).toContain('袋形'); expect(bad).toContain('地下室');
    expect(AW.sunlightByType('托儿所幼儿园')).toMatchObject({ hours: 3, day: '冬至日' });
  });
  test('V03 可编辑单方造价库影响估算', () => {
    const i = { stage: '投资估算', type: '办公', aboveArea: 10000, belowArea: 2000, region: '二线城市', grade: '标准型', infraFee: 0, contRate: 8 };
    const base = AW.estimateCost(i).eng;
    AW.setPrices({ '办公': 5000, '地下室': 6000 }); const c = AW.estimateCost(i);
    expect(c.ua).toBe(5000); expect(c.ub).toBe(6000); expect(c.eng).toBeGreaterThan(base);
    AW.resetPrices(); expect(AW.estimateCost(i).eng).toBeCloseTo(base);
  });
  test('V04 离线输出结合项目数据', async () => {
    const p = { name: '城北中学', code: 'X-1', type: '中小学校', area: 36000, stage: '方案设计', plan: { siteArea: 30000, far: 1.2 }, records: { review: [{ status: '待回复' }] } };
    const r = await AW.runAgent(AW.AGENTS.find(a => a.id === 'concept'), { siteArea: 30000, far: 1.2, density: 30, height: 24, gfa: 36000, floorHeight: 3.9, theme: '书院' }, p, {});
    expect(r.text).toContain('结合本项目的专业提示'); expect(r.text).toContain('GB 50099'); expect(r.text).toContain('36,000'); expect(r.text).toContain('未闭合事项 | 1 项');
    expect(AW.calcIndicators({ siteArea: 100, aboveArea: 150, footprint: 30 }).rows.map(x => x[0]).join()).toContain('平均层数');
  });
  test('V05 任务书文本提取 docx(deflate)/txt/pdf', async () => {
    const d = await PRO.extractText('a.docx', new Uint8Array(fs.readFileSync(FX('brief.docx')))); expect(d.text).toContain('城南图书馆');
    const t = await PRO.extractText('a.txt', new Uint8Array(fs.readFileSync(FX('brief.txt')))); expect(t.text).toContain('城东体育馆');
    const p = await PRO.extractText('a.pdf', new Uint8Array(fs.readFileSync(FX('brief.pdf')))); expect(p.text).toContain('Library GFA 15000');
    await expect(PRO.extractText('a.doc', new Uint8Array(4))).rejects.toThrow('.docx');
  });
  test('V06 diff / 检索 / 成果包', async () => {
    const d = PRO.diffLines('a\nb\nc', 'a\nB\nc\nd'); expect(PRO.diffStat(d)).toEqual({ add: 2, del: 1 });
    const projects = [{ id: 'p', name: 'P', code: 'C', runs: [{ id: 'r1', agent: 'code', text: '防火分区 3000 ㎡，防火分区', time: '2026' }, { id: 'r2', agent: 'brief', text: '无', time: '2026' }] }];
    const h = PRO.searchOutputs(projects, '防火分区', { code: '规范校核' }); expect(h).toHaveLength(1); expect(h[0]).toMatchObject({ name: '规范校核', count: 2 });
    const pk = PRO.buildPackage({ ...projects[0], stage: '施工图设计' }, { code: '规范校核', brief: '任务书' }, DOCX, '2026-10-20');
    expect(pk.count).toBe(2);
    const idx = await PRO.unzipEntry(pk.bytes, '00-文件目录.md'); expect(Buffer.from(idx).toString()).toContain('01-规范校核.docx');
    const inner = await PRO.unzipEntry(pk.bytes, '01-规范校核.docx'); expect(await PRO.docxText(inner)).toContain('防火分区 3000');
  });
});

test.describe('v2.6 界面', () => {
  test.beforeEach(async ({ page }) => { await fresh(page); });
  test('V10 导入任务书 docx → 表单填充 → 运行', async ({ page }) => {
    await openAgent(page, 'brief'); await page.setInputFiles('#briefFile', FX('brief.docx'));
    await expect(page.locator('#f-brief')).toHaveValue(/城南图书馆/); await expect(page.locator('#toasts')).toContainText('任务书已导入');
    await run(page); await expect(page.locator('#outBody')).toContainText('结合本项目的专业提示');
    await page.setInputFiles('#briefFile', FX('brief.pdf')); await expect(page.locator('#f-brief')).toHaveValue(/Library GFA/);
  });
  test('V11 版本历史与对比 + 自动保存指示', async ({ page }) => {
    await openAgent(page, 'cost'); await run(page);
    await expect(page.locator('#sbSave')).toContainText('已自动保存');
    await setField(page, 'aboveArea', 12000); await run(page);
    await expect(page.locator('#histN')).toHaveText('2');
    await page.click('#histBtn'); await expect(page.locator('#modalTitle')).toContainText('2 版');
    await expect(page.locator('#hvStat')).toContainText(/\+\d+ 行/); expect(await page.locator('#hvDiff .dl.add').count()).toBeGreaterThan(0);
    await page.click('#hvClose');
  });
  test('V12 单方造价库编辑生效', async ({ page }) => {
    await page.evaluate(() => document.querySelector('[data-act=prices]').click());
    await page.fill('#pr-文化场馆', '9000'); await page.click('#prSave');
    await openAgent(page, 'cost'); await setField(page, 'type', '文化场馆'); await setField(page, 'region', '二线城市'); await setField(page, 'grade', '标准型'); await run(page);
    await expect(page.locator('#outBody')).toContainText('9,000 元/㎡');
    expect(await page.evaluate(() => window.__aw.db().settings.prices['文化场馆'])).toBe(9000);
  });
  test('V13 全局成果检索（命令面板）', async ({ page }) => {
    await page.keyboard.press('Control+K'); await page.fill('#palInput', '任务书分析');
    await page.fill('#palInput', '办学规模'); await expect(page.locator('#palList')).toContainText('成果');
    await page.keyboard.press('Enter'); await expect(page.locator('#outBody')).toContainText('办学规模');
  });
  test('V14 项目成果包导出 zip', async ({ page }) => {
    await openAgent(page, 'code'); await run(page);
    const [d] = await Promise.all([page.waitForEvent('download'), page.keyboard.press('Control+Shift+E')]);
    expect(d.suggestedFilename()).toMatch(/成果包\.zip$/);
    const u8 = new Uint8Array(fs.readFileSync(await d.path())); const idx = Buffer.from(await PRO.unzipEntry(u8, '00-文件目录.md')).toString();
    expect(idx).toContain('规范符合性校核'); expect(idx).toContain('设计任务书分析');
  });
});
