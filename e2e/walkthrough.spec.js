/**
 * End-to-end feature walk — every agent, pipeline, export, UX surface.
 * Writes matrix to test-results/walkthrough-matrix.tsv
 */
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const { fresh, createProject, openAgent, run, setField, dl, shot } = require('./helpers');

const OUT = path.resolve(__dirname, '../test-results/walkthrough');
const MATRIX = path.join(OUT, 'matrix.tsv');
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(MATRIX, 'area\tfeature\tstatus\tnote\n');

function row(area, feature, status, note = '') {
  fs.appendFileSync(MATRIX, [area, feature, status, String(note).replace(/\t|\n/g, ' ')].join('\t') + '\n');
}

test.describe.configure({ mode: 'serial' });
test.setTimeout(300000);

let page;
test.beforeAll(async ({ browser }) => {
  page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await fresh(page);
});

test('W01 demo projects + onboarding + theme', async () => {
  try {
    await expect(page.locator('#sbProject')).toContainText('成都市某中学');
    await expect(page.locator('#projectSelect')).toContainText('滨江');
    row('demo', '预载成都中学+滨江', 'PASS');
  } catch (e) { row('demo', '预载示例项目', 'FAIL', e.message); throw e; }

  try {
    await page.evaluate(() => { const db = JSON.parse(localStorage.getItem('aw-db-v2')); db.onboarded = false; localStorage.setItem('aw-db-v2', JSON.stringify(db)); });
    await page.reload(); await page.waitForSelector('#obOk', { timeout: 5000 });
    await expect(page.locator('#modalBody')).toContainText('AI 主导');
    await page.click('#obOk');
    row('onboard', '新手引导显示/关闭', 'PASS');
  } catch (e) { row('onboard', '新手引导', 'FAIL', e.message); }

  try {
    await page.keyboard.press('Control+t');
    await expect(page.locator('#sbTheme')).toContainText(/浅色|深色/);
    await page.keyboard.press('Control+t');
    row('theme', 'Ctrl+T 切换主题', 'PASS');
  } catch (e) { row('theme', '主题切换', 'FAIL', e.message); }
});

const AGENTS = [
  ['brief', '设计任务书'], ['site', '规划条件'], ['concept', '体量试算'], ['render', '效果图提示词'],
  ['report', '方案汇报'], ['indicators', '指标核算'], ['cost', '投资估算'], ['permit', '报建清单'],
  ['code', '规范校核'], ['plancheck', '图审回复'], ['completion', '竣工验收']
];

test('W02 every form agent run + word/md export', async () => {
  await createProject(page, { name: '走查演示工程', code: 'SJ-WALK-001', type: '中小学校', area: 36000, stage: '方案设计' });
  for (const [id, name] of AGENTS) {
    try {
      await openAgent(page, id);
      if (id === 'brief') await setField(page, 'brief', '成都市某中学新建工程，48班，总建筑面积36000㎡，用地30000㎡，执行GB 50099-2011。');
      await run(page);
      await expect(page.locator('#output')).not.toBeEmpty({ timeout: 15000 });
      const text = await page.locator('#output').innerText();
      if (text.length < 40) throw new Error('output too short: ' + text.length);
      // docx
      const [d1] = await Promise.all([page.waitForEvent('download'), page.click('#wordBtn')]);
      expect(d1.suggestedFilename()).toMatch(/\.docx$/i);
      // md
      const [d2] = await Promise.all([page.waitForEvent('download'), page.click('#mdBtn')]);
      expect(d2.suggestedFilename()).toMatch(/\.md$/i);
      row('agent', name + ' 运行+导出', 'PASS', `chars=${text.length}`);
    } catch (e) {
      row('agent', name + ' 运行+导出', 'FAIL', e.message);
    }
  }
  await shot(page, '26-走查-任务书成果.png');
});

test('W03 record agents: AI草拟 / CSV / 批量 / 撤销', async () => {
  for (const [id, label] of [['review', '三级校审'], ['drawings', '图纸目录'], ['change', '变更核定'], ['service', '现场服务']]) {
    try {
      await openAgent(page, id);
      const before = await page.locator('#recTable tr[data-id]').count();
      await page.click('#rAi');
      await page.waitForTimeout(400);
      const after = await page.locator('#recTable tr[data-id]').count();
      expect(after).toBeGreaterThan(before);
      // CSV
      const [csv] = await Promise.all([page.waitForEvent('download'), page.click('#rCsv')]);
      expect(csv.suggestedFilename()).toMatch(/\.csv$/i);
      // summary doc
      await page.click('#rSum');
      await expect(page.locator('#output')).not.toBeEmpty();
      const [doc] = await Promise.all([page.waitForEvent('download'), page.click('#wordBtn')]);
      expect(doc.suggestedFilename()).toMatch(/\.docx$/i);
      row('records', label + ' AI草拟+CSV+汇总导出', 'PASS', `rows ${before}->${after}`);
    } catch (e) {
      row('records', label, 'FAIL', e.message);
    }
  }
  // batch + undo on review
  try {
    await openAgent(page, 'review');
    await page.locator('#recTable [data-ck]').first().evaluate(el => { el.checked = true; });
    await page.click('#rBatchClose');
    const id = await page.locator('#recTable tr[data-id]').first().getAttribute('data-id');
    await page.click(`#recTable tr[data-id="${id}"]`);
    await page.click('#rDel'); await page.click('#cYes');
    await expect(page.locator(`#recTable tr[data-id="${id}"]`)).toHaveCount(0);
    await page.keyboard.press('Control+z');
    await expect(page.locator(`#recTable tr[data-id="${id}"]`)).toHaveCount(1);
    row('ux', '批量闭合+删除+Ctrl+Z撤销', 'PASS');
  } catch (e) { row('ux', '批量/撤销', 'FAIL', e.message); }
});

test('W04 AI pipeline all steps + mini progress', async () => {
  try {
    await page.click('#tb-pipeline');
    await page.selectOption('#plMode', 'key');
    await page.click('#plStart');
    for (let i = 0; i < 14; i++) {
      await page.waitForFunction(() => !document.querySelector('#plStop'), null, { timeout: 120000 });
      if (await page.locator('#plApprove').count()) {
        await page.fill('#plComment', '走查确认');
        await page.click('#plApprove');
      } else break;
    }
    await expect(page.locator('#plProgress')).toHaveText('11 / 11 步已完成');
    await expect(page.locator('#sbPipe')).toBeVisible();
    row('pipeline', 'AI自动推进11步+签字', 'PASS');
    await shot(page, '27-走查-全流程完成.png');
  } catch (e) { row('pipeline', 'AI自动推进', 'FAIL', e.message); throw e; }
});

test('W05 palette / shortcuts / settings / templates / JSON export / chat', async () => {
  try {
    await page.click('#tree .titem[data-id=dashboard]');
    await page.keyboard.press('Control+k');
    await expect(page.locator('#palette')).not.toHaveClass(/hidden/);
    await page.locator('#palInput').click();
    await page.keyboard.type('规范');
    await expect(page.locator('#palList .pitem.on')).toContainText('规范符合性校核');
    await page.keyboard.press('Enter');
    await expect(page.locator('#palette')).toBeHidden();
    await expect(page.locator('.tab.active')).toContainText(/规范/);
    row('ux', '命令面板 Ctrl+K', 'PASS');
  } catch (e) { row('ux', '命令面板', 'FAIL', e.message); }

  try {
    await page.keyboard.press('Control+p');
    await expect(page.locator('#pipeView')).toBeVisible();
    row('ux', 'Ctrl+P 打开流水线', 'PASS');
  } catch (e) { row('ux', 'Ctrl+P', 'FAIL', e.message); }

  try {
    await page.keyboard.press('Control+l');
    await expect(page.locator('#chatPanel')).toBeVisible();
    await page.fill('#chatInput', '下一步做什么？');
    await page.keyboard.press('Enter');
    await expect(page.locator('#chatList .cm.assistant')).toBeVisible({ timeout: 10000 });
    row('ux', 'AI助手 Ctrl+L', 'PASS');
    await page.click('#chatClose');
  } catch (e) { row('ux', 'AI助手', 'FAIL', e.message); }

  try {
    await page.click('#tb-settings');
    await expect(page.locator('#sEndpoint')).toBeVisible();
    await expect(page.locator('#sKey')).toHaveAttribute('type', 'password');
    await page.click('#sCancel');
    row('settings', 'AI设置对话框', 'PASS');
  } catch (e) { row('settings', 'AI设置', 'FAIL', e.message); }

  try {
    await page.click('#tb-templates');
    await expect(page.locator('#modalBody')).toContainText('01-设计任务书');
    await page.click('#tplClose');
    row('templates', '院标模板库', 'PASS');
  } catch (e) { row('templates', '院标模板', 'FAIL', e.message); }

  try {
    const [j] = await Promise.all([page.waitForEvent('download'), page.click('#tb-exportProject')]);
    expect(j.suggestedFilename()).toMatch(/\.json$/i);
    const buf = require('fs').readFileSync(await j.path(), 'utf8');
    expect(buf).not.toContain('sk-10dbf7');
    row('export', '项目JSON导出(无密钥)', 'PASS');
  } catch (e) { row('export', '项目JSON', 'FAIL', e.message); }

  try {
    await openAgent(page, 'indicators');
    await expect(page.locator('#aiFillBtn')).toBeVisible();
    await page.click('#aiFillBtn');
    await page.waitForTimeout(500);
    await expect(page.locator('.field.ai-filled').first()).toBeVisible({ timeout: 10000 });
    row('ux', 'AI填写表单', 'PASS');
  } catch (e) { row('ux', 'AI填写', 'FAIL', e.message); }

  await shot(page, '28-走查-AI填写与面板.png');
});

test('W06 write summary', async () => {
  const lines = fs.readFileSync(MATRIX, 'utf8').trim().split('\n').slice(1);
  const pass = lines.filter(l => l.includes('\tPASS\t')).length;
  const fail = lines.filter(l => l.includes('\tFAIL\t')).length;
  fs.writeFileSync(path.join(OUT, 'summary.txt'), `PASS=${pass} FAIL=${fail} TOTAL=${lines.length}\n` + lines.join('\n'));
  console.log(`WALKTHROUGH PASS=${pass} FAIL=${fail}`);
  expect(fail, fs.readFileSync(MATRIX, 'utf8')).toBe(0);
});
