const { test, expect } = require('@playwright/test');
const H = require('./helpers');
const { fresh, shot, createProject, openAgent, run, dl, setField, addRecord } = H;
const out = p => p.locator('#output');

test.beforeEach(async ({ page }) => { await fresh(page); });

test('US-01 桌面软件界面框架', async ({ page }) => {
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await expect(page.locator('#menus .menu > span')).toHaveText(['文件', '编辑', '视图', '智能体', '工具', '窗口', '帮助']);
  await expect(page.locator('#tree .tgrp')).toHaveText([/方案设计/, /初步设计/, /施工图设计/, /施工配合/, /竣工/]);
  await expect(page.locator('#tree .titem')).toHaveCount(17);
  await expect(page.locator('#toolbar .tb')).toHaveCount(17);
  await expect(page.locator('#statusbar')).toContainText('离线模拟模式');
  // 图标字体为本地 Remix Icon
  const ff = await page.locator('#toolbar .tb i').first().evaluate(e => getComputedStyle(e, '::before').fontFamily);
  expect(ff).toContain('remixicon');
  expect(await page.evaluate(async () => { await document.fonts.ready; return document.fonts.check('14px remixicon'); })).toBe(true);
  // 菜单：智能体菜单按阶段分组
  await page.locator('.menu[data-m="3"] > span').click();
  await expect(page.locator('.menu[data-m="3"] .grp')).toHaveCount(5);
  await shot(page, '02-菜单栏-智能体菜单.png');
  await page.locator('.menu[data-m="3"] a[data-agent=code]').click();
  await expect(page.locator('.tab.active')).toContainText('规范校核');
  // 标签右键菜单：关闭其他
  await openAgent(page, 'brief');
  await page.locator('.tab', { hasText: '任务书' }).click({ button: 'right' });
  await page.locator('#ctxmenu a[data-c=others]').click();
  await expect(page.locator('.tab')).toHaveCount(1);
  // 面板显隐与分隔条拖动
  await page.keyboard.press('Control+b'); await expect(page.locator('#sidebar')).toBeHidden();
  await page.keyboard.press('Control+b'); await expect(page.locator('#sidebar')).toBeVisible();
  await page.keyboard.press('Control+j'); await expect(page.locator('#bottom')).toBeHidden();
  await page.keyboard.press('Control+j');
  const w0 = await page.locator('#sidebar').evaluate(e => e.offsetWidth);
  const sp = await page.locator('[data-split=side]').boundingBox();
  await page.mouse.move(sp.x + 2, sp.y + 200); await page.mouse.down(); await page.mouse.move(sp.x + 62, sp.y + 200); await page.mouse.up();
  expect(await page.locator('#sidebar').evaluate(e => e.offsetWidth)).toBeGreaterThan(w0 + 40);
  // 资源管理器搜索
  await page.fill('#navSearch', '图审'); await expect(page.locator('#tree .titem[data-id=plancheck]')).toBeVisible(); await expect(page.locator('#tree .titem[data-id=brief]')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('US-02 项目创建、属性、切换、导出与导入', async ({ page }) => {
  await page.keyboard.press('Control+n');
  await page.fill('#pName', ''); await page.click('#pSave'); await expect(page.locator('#pErr')).toHaveText('请填写工程名称');
  await page.fill('#pName', 'X'); await page.fill('#pCode', ''); await page.click('#pSave'); await expect(page.locator('#pErr')).toHaveText('请填写工程编号');
  await page.click('#pCancel');
  await createProject(page);
  await expect(page.locator('#propGrid')).toContainText('城北中学扩建工程');
  await expect(page.locator('#propGrid')).toContainText('SJ-2026-101');
  await expect(page.locator('#statusbar')).toContainText('阶段：方案设计');
  await expect(page.locator('#stageFlow .sf.cur')).toContainText('方案设计');
  await shot(page, '03-新建项目-总览.png');
  await page.click('#editProj'); await page.selectOption('#pStage', '初步设计'); await page.click('#pSave');
  await expect(page.locator('#statusbar')).toContainText('阶段：初步设计');
  const f = await dl(page, '#tb-exportProject');
  expect(f.name).toBe('SJ-2026-101城北中学扩建工程.json'); const pj = JSON.parse(f.text); expect(pj.stage).toBe('初步设计');
  await page.selectOption('#projectSelect', { label: 'SJ-2026-018 滨江社区文化中心' });
  await expect(page.locator('#propGrid')).toContainText('滨江社区文化中心');
  const tmp = require('path').join(require('os').tmpdir(), 'aw-import.json'); require('fs').writeFileSync(tmp, JSON.stringify({ ...pj, name: '导入的项目' }));
  await page.setInputFiles('#fileInput', tmp);
  await expect(page.locator('#propGrid')).toContainText('导入的项目');
  await page.reload(); await expect(page.locator('#projectSelect option')).toHaveCount(4);
});

test('US-03 设计任务书分析：输入任务书 → 分析报告 → 导出 Word', async ({ page }) => {
  await createProject(page);
  await openAgent(page, 'brief'); await setField(page, 'scope', '仅方案设计'); await run(page);
  await expect(page.locator('.mock-banner')).toContainText('【模拟输出】');
  await expect(out(page)).toContainText('城北中学扩建工程');
  await expect(out(page)).toContainText('建筑工程设计文件编制深度规定');
  await expect(out(page)).toContainText('图书馆');
  await expect(out(page)).toContainText('需建设单位澄清事项');
  await shot(page, '04-设计任务书分析.png');
  const w = await dl(page, '#wordBtn'); expect(w.name).toBe('SJ-2026-101-城北中学扩建工程-设计任务书分析.docx');
  expect(w.name).toMatch(/\.docx$/); expect(w.size).toBeGreaterThan(500); expect(w.buf[0]).toBe(0x50); expect(w.buf[1]).toBe(0x4b);
  await expect(page.locator('#hist li')).toHaveCount(1);
});

test('US-04 规划条件与场地分析：规划条件 → 容量测算 → 写入项目 → 导出', async ({ page }) => {
  await createProject(page);
  await openAgent(page, 'site');
  await setField(page, 'siteArea', 10000); await setField(page, 'siteWidth', 125); await setField(page, 'siteDepth', 80);
  await setField(page, 'far', 2.0); await setField(page, 'density', 30); await setField(page, 'height', 30); await setField(page, 'landUse', 'A33 中小学用地');
  await run(page);
  await expect(out(page)).toContainText('退线后可建范围');
  await expect(out(page)).toContainText('20,000 ㎡');
  await expect(out(page)).toContainText('3,000 ㎡');
  await expect(page.locator('#props')).toContainText('≤ 2');
  await expect(page.locator('#bottomBody')).toContainText('规划条件已写入项目');
  await shot(page, '05-规划条件与场地分析.png');
  const m = await dl(page, '#mdBtn'); expect(m.name).toContain('规划条件与场地分析.md'); expect(m.text).toContain('开发容量测算');
});

test('US-05 概念方案与体量试算：引用规划条件 → 方案比选 → 导出', async ({ page }) => {
  await createProject(page);
  await openAgent(page, 'site'); await setField(page, 'height', 18); await run(page);
  await openAgent(page, 'concept');
  await expect(page.locator('#f-height')).toHaveValue('18');
  await setField(page, 'gfa', 9000); await setField(page, 'floorHeight', 4.2); await run(page);
  await expect(out(page)).toContainText('最多 4 层');
  await expect(out(page)).toContainText('方案A·点式塔楼');
  await expect(out(page)).toContainText('推荐');
  await shot(page, '06-概念方案与体量试算.png');
  const w = await dl(page, '#wordBtn'); expect(w.text).toContain('围合院落');
});

test('US-06 效果图提示词：方案描述 → 正负提示词 → 复制/导出', async ({ page }) => {
  await createProject(page);
  await openAgent(page, 'render'); await setField(page, 'tool', 'Stable Diffusion'); await setField(page, 'view', '鸟瞰'); await run(page);
  await expect(out(page)).toContainText('aerial view'); await expect(out(page)).toContainText('负面提示词'); await expect(out(page)).toContainText('ControlNet');
  await page.click('#copyBtn'); await expect(page.locator('#sbMsg')).toContainText('已复制');
  const m = await dl(page, '#mdBtn'); expect(m.text).toContain('【模拟输出】');
});

test('US-07 方案汇报与沟通：四类文件 → 工作联系函导出 Word', async ({ page }) => {
  await createProject(page);
  await openAgent(page, 'report');
  for (const [k, t] of [['方案汇报提纲', '需决策事项'], ['会议纪要', '待办事项'], ['方案设计说明', 'GB 50352-2019'], ['工作联系函', 'SJ-2026-101-LXH']]) {
    await setField(page, 'kind', k); await run(page); await expect(out(page)).toContainText(t);
  }
  await expect(out(page)).toContainText('王设计');
  const w = await dl(page, '#wordBtn'); expect(w.text).toContain('工作联系函');
});

test('US-08 经济技术指标核算：指标表 → 超限提示 → 导出', async ({ page }) => {
  await createProject(page);
  await openAgent(page, 'indicators');
  await expect(page.locator('#srcBadge')).toHaveText('');
  await setField(page, 'aboveArea', 13000); await setField(page, 'carBelow', 50); await run(page);
  await expect(page.locator('#srcBadge')).toContainText('本地规则计算');
  await expect(out(page)).toContainText('主要经济技术指标表');
  await expect(out(page)).toContainText('1.63');
  await expect(out(page)).toContainText('项指标不满足规划条件');
  await shot(page, '07-经济技术指标核算.png');
  await setField(page, 'aboveArea', 9000); await setField(page, 'carBelow', 70); await run(page);
  await expect(out(page)).toContainText('各项指标均满足规划设计条件');
  const w = await dl(page, '#wordBtn'); expect(w.text).toContain('容积率'); expect(w.text).not.toContain('【模拟输出】');
});

test('US-09 投资估算 / 设计概算：费用构成 → 总投资 → 导出', async ({ page }) => {
  await createProject(page);
  await openAgent(page, 'cost');
  await expect(page.locator('#f-type')).toHaveValue('中小学校');
  await setField(page, 'type', '住宅'); await setField(page, 'aboveArea', 1000); await setField(page, 'belowArea', 0); await run(page);
  await expect(out(page)).toContainText('工程建设其他费用'); await expect(out(page)).toContainText('基本预备费');
  await expect(out(page)).toContainText('330.00'); // 工程费用 330 万
  await setField(page, 'stage', '设计概算'); await setField(page, 'contRate', 5); await run(page);
  await expect(out(page)).toContainText('设计概算表'); await expect(out(page)).toContainText('暖通空调工程');
  await shot(page, '08-投资估算设计概算.png');
  const w = await dl(page, '#wordBtn'); expect(w.name).toContain('投资估算'); expect(w.text).toContain('建设项目总投资');
});

test('US-10 报建资料清单：工规证 + 专项 → 清单 → 导出', async ({ page }) => {
  await createProject(page);
  await openAgent(page, 'permit'); await setField(page, 'sponge', '是'); await run(page);
  await expect(out(page)).toContainText('建设工程规划许可证申报材料清单');
  await expect(out(page)).toContainText('用地红线图'); await expect(out(page)).toContainText('海绵城市设计专篇'); await expect(out(page)).toContainText('人防');
  await setField(page, 'matter', '施工图审查送审'); await run(page);
  await expect(out(page)).toContainText('岩土工程勘察报告');
  const m = await dl(page, '#mdBtn'); expect(m.text).toContain('施工图审查送审');
});

test('US-11 规范符合性校核：参数 → 条文校核 → 整改建议 → 导出 Word', async ({ page }) => {
  await createProject(page);
  await openAgent(page, 'code');
  await setField(page, 'height', 36); await setField(page, 'compArea', 3600); await setField(page, 'fireLane', '否'); await setField(page, 'railHeight', 1.05); await setField(page, 'ramp', 10);
  await run(page);
  await expect(out(page)).toContainText('二类高层公共建筑');
  await expect(out(page)).toContainText('GB 50016 5.3.1'); await expect(out(page)).toContainText('GB 55019-2021'); await expect(out(page)).toContainText('GB 50352-2019 6.7.3');
  await expect(out(page)).toContainText('整改建议');
  await expect(out(page).locator('.ri-close-circle-fill')).toHaveCount(5); await expect(out(page)).toContainText('表 5.5.17');
  await shot(page, '09-规范符合性校核.png');
  const w = await dl(page, '#wordBtn'); expect(w.text).toContain('×'); expect(w.text).toContain('不满足');
});

test('US-12 三级校审：校对/审核/审定意见 → 回复闭合 → 校审记录单', async ({ page }) => {
  await createProject(page);
  await openAgent(page, 'review');
  await addRecord(page, { level: '校对', opinion: '疏散楼梯宽度未标注', category: '强制性条文', reviewer: '张工' });
  await addRecord(page, { level: '审核', opinion: '屋面防水等级与说明不一致', category: '一般性条文', reviewer: '陈总工' });
  await addRecord(page, { level: '审定', opinion: '立面材料建议统一', category: '建议', reviewer: '刘院长' });
  await expect(page.locator('#recTable tr[data-id]')).toHaveCount(3);
  await expect(page.locator('#recTable')).toContainText('JS-003');
  await expect(page.locator('#recWarn')).toContainText('不得出图');
  await page.click('#rSum'); await expect(out(page)).toContainText('不得出图');
  await page.locator('#recTable tr', { hasText: 'JS-001' }).click(); await page.click('#rEdit');
  await page.fill('#r-reply', '已补充，梯段净宽 1.40m'); await page.click('#rSave');
  for (const n of ['JS-001', 'JS-002', 'JS-003']) await page.locator('#recTable tr', { hasText: n }).locator('select').selectOption('已闭合');
  await expect(page.locator('#recWarn')).toHaveCount(0);
  await page.click('#rSum'); await expect(out(page)).toContainText('全部校审意见已闭合');
  await expect(out(page)).toContainText('已补充，梯段净宽 1.40m');
  await shot(page, '10-三级校审.png');
  const w = await dl(page, '#wordBtn'); expect(w.name).toContain('校审记录单'); expect(w.name).toMatch(/\.docx$/); expect(w.size).toBeGreaterThan(500);
  const c = await dl(page, '#rCsv'); expect(c.text).toContain('校审级别');
});

test('US-13 图纸目录与图号：建施/结施/水施/暖施/电施 → 升版/作废 → 目录导出', async ({ page }) => {
  await createProject(page);
  await openAgent(page, 'drawings');
  const sheets = [['建筑', '建筑设计总说明', 'A1'], ['建筑', '总平面图', 'A0'], ['建筑', '一层平面图', 'A1'], ['建筑', '南立面图', 'A1'], ['建筑', '1-1剖面图', 'A1'], ['建筑', '墙身详图', 'A2'],
    ['结构', '结构设计总说明', 'A1'], ['给排水', '给排水设计说明', 'A1'], ['暖通', '暖通设计说明', 'A1'], ['电气', '电气设计说明', 'A3']];
  for (const [d, t, s] of sheets.slice(0, 3)) await addRecord(page, { discipline: d, title: t, size: s });
  await expect(page.locator('#recWarn')).toContainText('缺少专业：结施、水施、暖施、电施');
  for (const [d, t, s] of sheets.slice(3)) await addRecord(page, { discipline: d, title: t, size: s });
  await expect(page.locator('#recTable')).toContainText('建施-06'); await expect(page.locator('#recTable')).toContainText('结施-01'); await expect(page.locator('#recTable')).toContainText('电施-01');
  await expect(page.locator('#recWarn')).toContainText('齐全');
  await expect(page.locator('#recWarn')).toContainText('折合 A1 9.75 张');
  await page.locator('#recTable tr', { hasText: '一层平面图' }).click(); await page.click('#rRev');
  await expect(page.locator('#recTable tr', { hasText: '一层平面图' })).toContainText('第2版');
  await page.locator('#recTable tr', { hasText: '电气设计说明' }).locator('select').selectOption('已作废');
  await expect(page.locator('#recWarn')).toContainText('电施');
  await page.selectOption('#rFd', '建筑'); await expect(page.locator('#recTable tr[data-id]')).toHaveCount(6); await page.selectOption('#rFd', '');
  await page.click('#rSum'); await expect(out(page)).toContainText('图纸目录'); await expect(out(page)).toContainText('共 **9** 张'.replace(/\*/g, ''));
  await shot(page, '11-图纸目录与图号.png');
  const c = await dl(page, '#rCsv'); expect(c.text).toContain('建施-01'); expect(c.text.split('\n').length).toBe(11);
  const w = await dl(page, '#wordBtn'); expect(w.text).toContain('折合 A1');
  await page.reload(); await openAgent(page, 'drawings'); await expect(page.locator('#recTable tr[data-id]')).toHaveCount(10);
});

test('US-14 施工图审查意见回复：审查意见 → 逐条回复单 → 导出 Word', async ({ page }) => {
  await createProject(page);
  await openAgent(page, 'plancheck'); await run(page);
  await expect(out(page)).toContainText('施工图审查意见回复单');
  await expect(out(page)).toContainText('GB 55015-2021'); await expect(out(page)).toContainText('GB 55030-2022');
  await expect(out(page)).toContainText('其中强制性条文 1 条');
  await expect(out(page).locator('table').nth(1).locator('tr')).toHaveCount(6);
  await shot(page, '12-施工图审查意见回复.png');
  const w = await dl(page, '#wordBtn'); expect(w.name).toContain('施工图审查意见回复'); expect(w.text).toContain('修改图号');
});

test('US-15 设计变更单 / 技术核定单：登记 → 编号 → 生成单据 → 汇总导出', async ({ page }) => {
  await createProject(page, { stage: '施工配合' });
  await openAgent(page, 'change');
  await addRecord(page, { form: '设计变更单', discipline: '建筑', costImpact: '增加', amount: 3.5 });
  await addRecord(page, { form: '技术核定单', discipline: '结构', reason: '施工单位建议', content: '地下室外墙后浇带改为膨胀加强带', costImpact: '减少', amount: 1.2 });
  await addRecord(page, { form: '设计变更单', discipline: '建筑', content: '主入口雨棚标高调整' });
  await expect(page.locator('#recTable')).toContainText('SJBG-建-001'); await expect(page.locator('#recTable')).toContainText('SJBG-建-002'); await expect(page.locator('#recTable')).toContainText('JSHD-001');
  await page.locator('#recTable tr', { hasText: 'JSHD-001' }).click(); await page.click('#rDoc');
  await expect(out(page)).toContainText('技术核定单'); await expect(out(page)).toContainText('设计单位意见'); await expect(out(page)).toContainText('监理单位');
  const w = await dl(page, '#wordBtn'); expect(w.name).toContain('技术核定单'); expect(w.text).toContain('膨胀加强带');
  await page.locator('#recTable tr', { hasText: 'SJBG-建-001' }).click(); await page.click('#rDoc');
  await expect(out(page)).toContainText('设计变更通知单');
  await shot(page, '13-设计变更单.png');
  await page.click('#rSum'); await expect(out(page)).toContainText('造价影响合计 2.30 万元');
  await page.locator('#recTable tr', { hasText: 'SJBG-建-002' }).click(); await page.click('#rDel'); await page.click('#cYes');
  await expect(page.locator('#recTable tr[data-id]')).toHaveCount(2);
});

test('US-16 现场服务记录：登记 → 记录表 → 周报导出', async ({ page }) => {
  await createProject(page, { stage: '施工配合' });
  await openAgent(page, 'service');
  await addRecord(page, { type: '设计交底', location: '全楼', issue: '施工单位对屋面构造层次提出疑问', advice: '按建施-15 屋面做法施工' });
  await addRecord(page, { type: '隐蔽工程验收配合', needChange: '是' });
  await expect(page.locator('#recTable')).toContainText('XCFW-002');
  await page.locator('#recTable tr', { hasText: 'XCFW-001' }).locator('select').selectOption('已闭合');
  await page.locator('#recTable tr', { hasText: 'XCFW-002' }).click(); await page.click('#rDoc');
  await expect(out(page)).toContainText('设计单位现场服务记录表'); await expect(out(page)).toContainText('止水钢板');
  await page.click('#rSum'); await expect(out(page)).toContainText('现场服务 2 次，问题闭合 1 项，未闭合 1 项；需出变更 1 项');
  await shot(page, '14-现场服务记录.png');
  const w = await dl(page, '#wordBtn'); expect(w.name).toContain('现场服务汇总');
});

test('US-17 竣工验收：汇总项目记录 → 未闭合拦截 → 质量检查报告导出', async ({ page }) => {
  await createProject(page, { stage: '竣工' });
  await openAgent(page, 'change'); await addRecord(page, { form: '设计变更单' });
  await openAgent(page, 'service'); await addRecord(page, {});
  await openAgent(page, 'completion'); await run(page);
  await expect(out(page)).toContainText('设计单位工程质量检查报告');
  await expect(out(page)).toContainText('SJBG-建-001');
  await expect(out(page)).toContainText('闭合后');
  await openAgent(page, 'change'); await page.locator('#recTable tr[data-id] select').selectOption('已实施');
  await openAgent(page, 'service'); await page.locator('#recTable tr[data-id] select').selectOption('已闭合');
  await openAgent(page, 'completion'); await setField(page, 'planVerify', '是'); await setField(page, 'archive', '是'); await run(page);
  await expect(out(page)).toContainText('同意');
  await shot(page, '15-竣工验收.png');
  const w = await dl(page, '#wordBtn'); expect(w.name).toContain('竣工验收'); expect(w.text).toContain('设计单位（盖章）');
});

test('US-18 AI 接口设置：测试连接 → AI 生成 → 失败回退', async ({ page }) => {
  await page.route('https://fake-llm.test/v1/chat/completions', r => r.fulfill({ json: { choices: [{ message: { content: '## AI 返回\n来自真实接口' } }] } }));
  await createProject(page);
  await page.click('#tb-settings');
  await page.selectOption('#sMode', 'llm'); await page.fill('#sEndpoint', 'https://fake-llm.test/v1'); await page.fill('#sKey', 'sk-test'); await page.fill('#sModel', 'deepseek-chat');
  await page.click('#sTest'); await expect(page.locator('#sResult')).toContainText('连接成功');
  await shot(page, '16-AI接口设置.png');
  await page.click('#sSave'); await expect(page.locator('#statusbar')).toContainText('AI 接口：deepseek-chat');
  await openAgent(page, 'brief'); await run(page);
  await expect(page.locator('#srcBadge')).toContainText('AI 实时生成'); await expect(page.locator('.mock-banner')).toHaveCount(0); await expect(out(page)).toContainText('来自真实接口');
  await openAgent(page, 'indicators'); await run(page); await expect(page.locator('#srcBadge')).toContainText('规则计算 + AI 建议'); await expect(out(page)).toContainText('主要经济技术指标表'); await expect(out(page)).toContainText('来自真实接口');
  await page.unroute('https://fake-llm.test/v1/chat/completions');
  await page.route('https://fake-llm.test/v1/chat/completions', r => r.fulfill({ status: 500, body: 'err' }));
  await openAgent(page, 'brief'); await run(page);
  await expect(page.locator('.mock-banner')).toContainText('HTTP 500');
  await expect(page.locator('#bottomBody')).toContainText('已回退为模拟输出');
  const w = await dl(page, '#wordBtn'); expect(w.name).toMatch(/\.docx$/); expect(w.size).toBeGreaterThan(500);
});

test('US-19 主题、布局、快捷键与历史成果回看', async ({ page }) => {
  await createProject(page);
  await page.keyboard.press('Control+t'); await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await openAgent(page, 'brief'); await page.keyboard.press('F5'); await expect(page.locator('.mock-banner')).toBeVisible();
  await shot(page, '17-浅色主题-任务书.png');
  await page.keyboard.press('Control+w'); await expect(page.locator('.tab')).toHaveCount(1);
  await page.click('#tb-toggleProps'); await expect(page.locator('#props')).toBeHidden();
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light'); await expect(page.locator('#props')).toBeHidden();
  await page.click('#tb-toggleProps');
  await page.locator('#hist li').first().click();
  await expect(page.locator('.tab.active')).toContainText('任务书'); await expect(out(page)).toContainText('设计任务书分析报告');
  await page.locator('.menu[data-m="6"] > span').click(); await page.locator('a[data-act=shortcuts]').click();
  await expect(page.locator('#modalBody')).toContainText('Ctrl+B'); await page.keyboard.press('Escape'); await expect(page.locator('#modal')).toBeHidden();
});

test('US-20 问题面板：汇总未闭合事项并跳转', async ({ page }) => {
  await createProject(page);
  await openAgent(page, 'review'); await addRecord(page, { category: '强制性条文' });
  await openAgent(page, 'drawings'); await addRecord(page, { title: '建筑设计总说明' });
  await page.click('#btabs span[data-b=problems]');
  await expect(page.locator('#probCount')).toHaveText('3');
  await expect(page.locator('#bottomBody')).toContainText('[三级校审] JS-001');
  await expect(page.locator('#bottomBody')).toContainText('缺少专业图纸');
  await expect(page.locator('#statusbar')).toContainText('未闭合事项 3');
  await shot(page, '18-问题面板.png');
  await page.locator('#bottomBody [data-open=review]').dblclick(); await expect(page.locator('.tab.active')).toContainText('三级校审');
  await page.locator('#recTable tr[data-id] select').selectOption('已闭合');
  await expect(page.locator('#probCount')).toHaveText('2');
});

test('总览截图（示例项目）', async ({ page }) => {
  await shot(page, '01-项目总览-深色.png');
  await expect(page.locator('#stageFlow .sf')).toHaveCount(5);
});
