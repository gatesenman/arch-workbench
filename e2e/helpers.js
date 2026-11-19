const path = require('path'), fs = require('fs');
const URL = 'file://' + path.resolve(__dirname, '../src/index.html');
const SHOT = n => process.env.SHOTS ? path.resolve(__dirname, '../screenshots', n) : null;
async function fresh(page) { await page.goto(URL); await page.evaluate(() => localStorage.clear()); await page.reload(); await page.waitForSelector('#tree .titem');
  await page.evaluate(() => { /* FORCE_MOCK + skip onboard */ const db = JSON.parse(localStorage.getItem('aw-db-v2') || '{}'); if (db.settings) Object.assign(db.settings, { mode: 'mock', apiKey: '', aiAutoFill: false }); db.onboarded = true; localStorage.setItem('aw-db-v2', JSON.stringify(db)); }); await page.reload(); await page.waitForSelector('#tree .titem');
  await page.evaluate(() => { const m = document.querySelector('#modal'); if (m && !m.classList.contains('hidden')) { const b = document.querySelector('#obOk,#tplClose,#sCancel,#cNo,#modalClose'); if (b) b.click(); else m.classList.add('hidden'); } }); }
async function shot(page, n) { const p = SHOT(n); if (!p) return; await page.waitForFunction(() => !document.querySelector('.caret, #skel')); await page.waitForTimeout(450); await page.screenshot({ path: p }); }
/** 通过"新建项目"对话框创建项目（每个故事的起点） */
async function createProject(page, o = {}) {
  await page.click('#tb-newProject');
  await page.fill('#pName', o.name || '城北中学扩建工程'); await page.fill('#pCode', o.code || 'SJ-2026-101');
  await page.fill('#pClient', o.client || '城北区教育局'); await page.fill('#pLoc', o.location || '江苏省南京市');
  await page.selectOption('#pType', o.type || '中小学校'); await page.fill('#pArea', String(o.area || 18000));
  await page.selectOption('#pStage', o.stage || '方案设计'); await page.fill('#pLeader', o.leader || '王设计');
  await page.click('#pSave');
  await page.waitForSelector('#modal.hidden', { state: 'attached' });
}
async function openAgent(page, id) { await page.click(`#tree .titem[data-id=${id}]`); }
async function run(page) { await page.click('#runBtn'); await page.waitForFunction(() => !document.querySelector('#runBtn').disabled); }
/** 触发下载并返回 {name, text} */
async function dl(page, selector) {
  const [d] = await Promise.all([page.waitForEvent('download'), page.click(selector)]);
  const fp = await d.path(); const buf = fs.readFileSync(fp); return { name: d.suggestedFilename(), text: buf.toString('utf8'), size: buf.length, buf };
}
async function setField(page, key, val) { const el = page.locator('#f-' + key); (await el.evaluate(e => e.tagName)) === 'SELECT' ? await el.selectOption(String(val)) : await el.fill(String(val)); }
async function addRecord(page, vals) { await page.click('#rAdd'); for (const [k, v] of Object.entries(vals)) { const el = page.locator('#r-' + k); (await el.evaluate(e => e.tagName)) === 'SELECT' ? await el.selectOption(String(v)) : await el.fill(String(v)); } await page.click('#rSave'); }
module.exports = { URL, fresh, shot, createProject, openAgent, run, dl, setField, addRecord };
