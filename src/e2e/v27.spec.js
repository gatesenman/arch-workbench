/* v2.7 AI 增强：用模拟的 OpenAI 兼容接口（SSE / tool_calls）测试；真实 API 测试仍由 DEEPSEEK_API_KEY 控制 */
const { test, expect } = require('@playwright/test');
const { fresh, openAgent, run } = require('./helpers');
const AW = require('../src/agents.js'); const AI = require('../src/ai.js'); const PL = require('../src/pilot.js');

const sse = text => { const parts = text.match(/[\s\S]{1,12}/g); return parts.map(c => `data: ${JSON.stringify({ choices: [{ delta: { content: c } }] })}\n\n`).join('') + 'data: [DONE]\n\n'; };
const resp = (status, body, ct = 'application/json') => ({ ok: status < 400, status, headers: { get: () => ct }, json: async () => (typeof body === 'string' ? JSON.parse(body) : body), body: null });
const PROJ = () => ({ id: 'p', name: '城北中学', code: 'SJ-1', type: '中小学校', area: 36000, stage: '方案设计', plan: { siteArea: 30000, far: 1.2, density: 30, green: 35, height: 24 }, runs: [{ id: 'r1', agent: 'brief', text: '## 任务书\n普通教室 48 间，风雨操场 3000 ㎡。', input: { brief: '本项目为 48 班初中，风雨操场 3000㎡。' } }], records: { drawings: [{ discipline: '建筑', title: '总平面图', size: 'A1' }] } });

test.describe('v2.7 AI 引擎（Node，模拟接口）', () => {
  test('A01 function calling 循环：模型调用规则工具 → 回填 → 带来源回答', async () => {
    AI.bindUsage({}); const bodies = [];
    const f = async (url, o) => { const b = JSON.parse(o.body); bodies.push(b);
      if (!b.messages.some(m => m.role === 'tool')) return resp(200, { choices: [{ message: { role: 'assistant', content: '', tool_calls: [
        { id: 'c1', type: 'function', function: { name: 'check_fire_code', arguments: JSON.stringify({ height: 30, evacDist: 38, sprinkler: '否' }) } },
        { id: 'c2', type: 'function', function: { name: 'search_knowledge', arguments: '{"query":"教学建筑 疏散距离"}' } }] } }], usage: { prompt_tokens: 900, completion_tokens: 60 } });
      const tool = b.messages.filter(m => m.role === 'tool').map(m => JSON.parse(m.content)); expect(tool[0].fail).toBeGreaterThan(0);
      return resp(200, { choices: [{ message: { role: 'assistant', content: `高层教学建筑疏散距离应 ≤ 30 m [来源1]，当前不满足 ${tool[0].fail} 项。` } }], usage: { prompt_tokens: 1500, completion_tokens: 80 } }); };
    const tr = []; const r = await AI.runToolAgent({ settings: { mode: 'llm', apiKey: 'k', endpoint: 'https://mock', model: 'deepseek-chat', retries: 0 }, project: PROJ(), question: '30m 教学楼疏散？', fetchImpl: f, onTrace: e => tr.push(e.type) });
    expect(bodies[0].tools.map(t => t.function.name)).toEqual(expect.arrayContaining(['calc_indicators', 'estimate_cost', 'check_fire_code', 'sunlight_standard', 'check_drawings', 'search_knowledge', 'get_project']));
    expect(tr).toEqual(expect.arrayContaining(['think', 'tool', 'result', 'answer'])); expect(r.source).toBe('llm');
    expect(r.text).toContain('[来源1]'); expect(r.text).toContain('参考来源'); expect(r.text).toContain('GB 50016');
    expect(AI.usage.prompt).toBe(2400); expect(AI.usage.completion).toBe(140); expect(AI.usage.cost).toBeGreaterThan(0);
  });
  test('A02 离线：意图规划调用同一套工具', async () => {
    const r = await AI.runToolAgent({ settings: {}, project: PROJ(), question: '容积率和投资估算多少？日照标准？' });
    const tools = r.trace.filter(x => x.type === 'tool').map(x => x.name);
    expect(tools).toEqual(expect.arrayContaining(['calc_indicators', 'estimate_cost', 'sunlight_standard', 'search_knowledge']));
    expect(r.text).toContain('冬至日 ≥ 2 h'); expect(r.text).toContain('万元'); expect(r.source).toBe('mock');
  });
  test('A03 重试 + 回退链 + 按智能体模型 + 用量', async () => {
    AI.bindUsage({}); const seen = [];
    const f = async (url, o) => { const b = JSON.parse(o.body); seen.push(url.split('/')[2] + ':' + b.model);
      if (url.includes('primary')) return resp(503, { error: { message: 'busy' } });
      return { ok: true, status: 200, headers: { get: () => 'text/event-stream' }, body: new Response(sse('## 结果\n备用模型生成')).body }; };
    const s = { mode: 'llm', apiKey: 'k', endpoint: 'https://primary', model: 'deepseek-chat', retries: 1, _fastRetry: true, stream: true, fallback: 'qwen|https://backup/v1|qwen-plus|k2', agentModels: { brief: 'deepseek-reasoner' } };
    const t = await AW.callLLM(s, { messages: [{ role: 'user', content: '测试' }], stream: true, agentId: 'brief', fetchImpl: f });
    expect(t).toContain('备用模型生成');
    expect(seen).toEqual(['primary:deepseek-reasoner', 'primary:deepseek-reasoner', 'primary:deepseek-chat', 'primary:deepseek-chat', 'backup:qwen-plus']);
    expect(AI.usage.fails).toBe(4); expect(AI.usage.byModel['qwen-plus'].calls).toBe(1);
    const f401 = []; await expect(AW.callLLM({ ...s, fallback: '' }, { messages: [{ role: 'user', content: 'x' }], fetchImpl: async u => { f401.push(u); return resp(401, { error: { message: 'bad' } }); } })).rejects.toThrow('401');
    expect(f401.length).toBe(1); // 401 不重试、不回退到同一密钥
    expect(Object.keys(AI.PROVIDERS)).toEqual(['deepseek', 'qwen', 'zhipu', 'wenxin', 'kimi', 'ollama']);
  });
  test('A04 知识库 BM25 + 上传资料 + 引用', () => {
    const p = PROJ(); p.kb = [{ id: 'k1', name: '成都市中小学设计导则.txt', kind: '规范', text: '风雨操场净高不应低于 9 m，宜设于校园北侧。\n\n食堂应与教学区保持 25 m 以上距离。' }];
    const kb = AI.buildKB(p); const h = AI.searchKB(kb, '风雨操场 净高');
    expect(h[0].title).toContain('设计导则'); expect(AI.searchKB(kb, '袋形走道 疏散')[0].title).toContain('5.5.17');
    expect(kb.docs.some(d => d.kind === '任务书')).toBe(true); expect(AI.tokenize('防火分区GB50016')).toEqual(expect.arrayContaining(['防火', '分区', 'gb50016']));
  });
  test('A05 命令 / @提及 / 记忆压缩 / 建议', () => {
    const c = AI.parseCommand('/估算 结合 @规范校核 结果'); expect(c.cmd).toBe('/估算'); expect(c.mentions).toEqual(['code']);
    expect(AI.parseCommand('/校核').text).toContain('GB 50016');
    const h = Array.from({ length: 12 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: i % 2 ? `容积率 1.${i} 满足，绿地率 3${i}%` : '问题' + i }));
    const m = AI.compressMemory(h, 8); expect(m.history).toHaveLength(8); expect(m.memory).toContain('容积率 1.1');
    expect(AI.suggestions(PROJ())).toContain('/校核');
  });
  test('A06 AI 自检：数据矛盾、超限高、规范不满足 → 待人工确认 + 置信度', () => {
    const p = PROJ(); const r = AI.selfCheck('## 说明\n总建筑面积 52000 ㎡，建筑高度 28 m。【模拟输出】', 'report', p);
    expect(r.issues.map(x => x.msg).join()).toMatch(/偏差.*超过规划限高|超过规划限高/s); expect(r.needHuman).toBe(true); expect(r.confidence).toBeLessThan(60);
    const i = Object.fromEntries(AW.AGENTS.find(a => a.id === 'code').fields.map(f => [f.key, f.default]));
    expect(AI.selfCheck('### 一\n ok', 'code', p, { ...i, compArea: 9000 }).issues.some(x => /防火分区/.test(x.msg))).toBe(true);
    expect(AI.markPending('正文', r.issues)).toContain('【待人工确认】');
  });
  test('A07 AI 二次审查（模拟接口 JSON）合并问题并取较低置信度', async () => {
    const f = async () => resp(200, { choices: [{ message: { content: '{"confidence":55,"issues":[{"level":"err","msg":"风雨操场未考虑疏散宽度","basis":"GB 50099"}]}' } }] });
    const r = await AI.reviewWithLLM({ mode: 'llm', apiKey: 'k', endpoint: 'https://m', model: 'x', stream: false, retries: 0 }, '### 一\n内容', 'brief', PROJ(), null, { fetchImpl: f });
    expect(r.source).toBe('llm'); expect(r.confidence).toBe(55); expect(r.issues.find(x => x.ai).msg).toContain('风雨操场');
  });
  test('A08 内联改写（离线）与提示词模板覆盖', () => {
    expect(AI.inlineOffline('table', '容积率：1.2\n绿地率：35%')).toContain('| 容积率 | 1.2 |');
    expect(AI.inlineOffline('formal', '请补充日照分析。请提供地形图。')).toMatch(/^经研究[\s\S]*一、请补充日照分析/);
    expect(AI.inlineOffline('polish', '我们觉得大概要 3 天搞定')).toBe('经分析认为约要 3 天完成。');
    expect(AI.inlineOffline('shorten', '第一句。第二句含 GB 50016。第三句。第四句。').length).toBeLessThan(20);
    AW.setPromptOverrides({ brief: { system: '自定义系统提示', format: '只输出三节' } });
    const m = AW.buildMessages(AW.AGENTS[0], {}, PROJ()); expect(m[0].content).toBe('自定义系统提示'); expect(m[1].content).toContain('只输出三节');
    AW.setPromptOverrides({}); expect(AW.buildMessages(AW.AGENTS[0], {}, PROJ())[0].content).toBe(AW.SYSTEM_PROMPT);
  });
  test('A09 流水线：校核不通过 → AI 重规划 → 重新校核通过', async () => {
    const r = await PL.runStep(PL.PIPELINE.find(s => s.id === 'code'), PROJ(), {}, { override: { height: 30, evacDist: 45, compArea: 5200, railHeight: 1.0, ramp: 8 } });
    expect(r.replan[0].before).toBeGreaterThanOrEqual(4); expect(r.replan.slice(-1)[0].after).toBe(0);
    expect(r.text).toContain('AI 重规划记录'); expect(r.text).toContain('疏散距离'); expect(r.text).toContain('[OK]');
    const ri = await PL.runStep(PL.PIPELINE.find(s => s.id === 'indicators'), PROJ(), {}, { override: { aboveArea: 42000, greenArea: 6000 } });
    expect(ri.replan[0].after).toBe(0); expect(ri.text).toContain('容积率上限');
    const off = await PL.runStep(PL.PIPELINE.find(s => s.id === 'code'), PROJ(), { replan: false }, { override: { compArea: 9000 } }); expect(off.replan).toBeUndefined();
  });
});

/* ---------------- 界面：拦截模拟接口 ---------------- */
async function useMockLLM(page, opts = {}) {
  const log = { bodies: [] };
  await page.route('https://mock-llm.test/**', async route => { const b = JSON.parse(route.request().postData() || '{}'); log.bodies.push(b);
    if (opts.fail503 && route.request().url().includes('/primary/')) return route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":{"message":"busy"}}' });
    if (b.tools) { if (!b.messages.some(m => m.role === 'tool')) return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ choices: [{ message: { role: 'assistant', content: '', tool_calls: [{ id: 't1', type: 'function', function: { name: 'calc_indicators', arguments: '{}' } }, { id: 't2', type: 'function', function: { name: 'search_knowledge', arguments: '{"query":"日照 教室"}' } }] } }], usage: { prompt_tokens: 800, completion_tokens: 40 } }) });
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ choices: [{ message: { role: 'assistant', content: '## 指标结论\n容积率满足规划条件；普通教室冬至日日照 ≥ 2 h [来源1]。' } }], usage: { prompt_tokens: 1200, completion_tokens: 50 } }) }); }
    if (b.stream) return route.fulfill({ contentType: 'text/event-stream', body: sse('## 模拟 AI 成果\n\n### 一、概况\n总建筑面积 36000 ㎡，由模拟接口流式生成。\n\n### 下一步建议\n- 复核日照') });
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ choices: [{ message: { content: '| 项目 | 内容 |\n|---|---|\n| 改写 | AI 表格 |' } }] }) }); });
  await page.evaluate(o => { const db = JSON.parse(localStorage.getItem('aw-db-v2')); Object.assign(db.settings, { mode: 'llm', apiKey: 'test-key', endpoint: o.fail503 ? 'https://mock-llm.test/primary/v1' : 'https://mock-llm.test/v1', model: 'deepseek-chat', stream: true, aiAutoFill: false, retries: 0, fallback: o.fail503 ? 'qwen|https://mock-llm.test/backup/v1|qwen-plus|k2' : '' }); localStorage.setItem('aw-db-v2', JSON.stringify(db)); }, opts);
  await page.reload(); await page.waitForSelector('#tree .titem'); return log;
}

test.describe('v2.7 界面', () => {
  test.beforeEach(async ({ page }) => { await fresh(page); });
  test('A10 助手：工具调用轨迹 + [来源] + 用量 + 插入到成果', async ({ page }) => {
    await useMockLLM(page); await openAgent(page, 'brief'); await run(page); const n0 = +(await page.locator('#histN').textContent());
    await page.keyboard.press('Control+L'); await expect(page.locator('#chatList .chip').first()).toBeVisible();
    await page.fill('#chatInput', '容积率满足吗？教室日照？'); await page.click('#chatSend');
    await expect(page.locator('#chatList .cm.assistant .cb').last()).toContainText('参考来源');
    await expect(page.locator('#chatList .trace').last()).toContainText('调用 经济技术指标核算'); await expect(page.locator('#chatList .trace').last()).toContainText('调用 检索项目知识库');
    await expect(page.locator('#sbUsage')).toContainText('tokens');
    await page.locator('[data-ins]').last().click(); await expect(page.locator('#output')).toContainText('AI 助手补充'); await expect(page.locator('#histN')).toHaveText(String(n0 + 1));
  });
  test('A11 斜杠命令补全、/帮助、@提及、离线工具规划', async ({ page }) => {
    await page.keyboard.press('Control+L'); await page.fill('#chatInput', '/'); await page.locator('#chatInput').dispatchEvent('input');
    await expect(page.locator('#slashMenu')).toContainText('/校核'); await page.fill('#chatInput', '/帮助'); await page.keyboard.press('Escape'); await page.click('#chatSend');
    await expect(page.locator('#chatList')).toContainText('助手命令');
    await page.fill('#chatInput', '/校核 @指标核算'); await page.click('#chatSend');
    await expect(page.locator('#chatList .trace').last()).toContainText('GB 50016 防火与规范校核'); await expect(page.locator('#chatList .cb').last()).toContainText('离线工具规划');
    await page.reload(); await page.waitForSelector('#tree .titem'); await page.keyboard.press('Control+L'); await expect(page.locator('#chatList')).toContainText('助手命令'); // 多轮记忆按项目持久化
  });
  test('A12 AI 自检面板 + 标注待人工确认 + AI 二次审查（模拟）', async ({ page }) => {
    await openAgent(page, 'code'); await page.fill('#f-compArea', '9000'); await run(page);
    await expect(page.locator('#selfChk')).toContainText('置信度'); await expect(page.locator('#selfChk')).toContainText('防火分区');
    await page.click('#scMark'); await expect(page.locator('#output')).toContainText('AI 自检 · 待人工确认');
    await useMockLLM(page); await openAgent(page, 'brief'); await run(page); await expect(page.locator('#output')).toContainText('模拟接口流式生成');
    await page.route('https://mock-llm.test/**', r => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ choices: [{ message: { content: '{"confidence":61,"issues":[{"level":"warn","msg":"未说明绿建二星级具体措施","basis":"GB/T 50378"}]}' } }] }) }));
    await page.click('#scAi'); await expect(page.locator('#selfChk')).toContainText('未说明绿建二星级'); await expect(page.locator('#selfChk .conf')).toContainText('61%');
  });
  test('A13 选区内联 AI：生成表格并替换', async ({ page }) => {
    await openAgent(page, 'brief'); await run(page); const n0 = +(await page.locator('#histN').textContent());
    await page.evaluate(() => { const p = [...document.querySelectorAll('#output li, #output p')].find(x => x.textContent.length > 8); const r = document.createRange(); r.selectNodeContents(p); const s = getSelection(); s.removeAllRanges(); s.addRange(r); p.dispatchEvent(new MouseEvent('mouseup', { bubbles: true })); });
    await expect(page.locator('#selTools')).toHaveClass(/on/); await page.click('#selTools [data-op=table]');
    await expect(page.locator('#inlOut table')).toBeVisible(); await page.click('#inlRep');
    await expect(page.locator('#toasts')).toContainText('已替换'); await expect(page.locator('#histN')).toHaveText(String(n0 + 1)); await expect(page.locator('#output table').first()).toBeVisible();
  });
  test('A14 提示词模板：编辑生效于请求 + 恢复默认 + 按智能体模型', async ({ page }) => {
    const log = await useMockLLM(page);
    await page.evaluate(() => document.querySelector('[data-act=prompts]').click()); await page.selectOption('#ptAgent', 'brief');
    await page.fill('#ptSys', '你是测试院总建筑师。只用三节。'); await page.fill('#ptModel', 'qwen-max'); await page.click('#ptSave');
    await expect(page.locator('#ptAgent')).toContainText('已自定义'); await page.click('#ptCancel');
    await openAgent(page, 'brief'); await run(page);
    const b = log.bodies.find(x => x.stream); expect(b.messages[0].content).toBe('你是测试院总建筑师。只用三节。'); expect(b.model).toBe('qwen-max');
    await page.evaluate(() => document.querySelector('[data-act=prompts]').click()); await page.selectOption('#ptAgent', 'brief'); await page.click('#ptReset');
    await expect(page.locator('#ptSys')).toHaveValue(/资深建筑专业负责人/);
  });
  test('A15 多模型回退：主接口 503 → 备用模型生成；用量统计对话框', async ({ page }) => {
    const log = await useMockLLM(page, { fail503: true }); await openAgent(page, 'render'); await run(page);
    await expect(page.locator('#output')).toContainText('模拟接口流式生成');
    expect(log.bodies.map(b => b.model)).toEqual(expect.arrayContaining(['deepseek-chat', 'qwen-plus']));
    await page.evaluate(() => document.querySelector('[data-act=usage]').click()); await expect(page.locator('#modalBody')).toContainText('qwen-plus'); await expect(page.locator('#modalBody')).toContainText('合计');
    await page.click('#usClose'); await page.click('#tb-settings'); await expect(page.locator('#sPreset')).toContainText('文心一言'); await expect(page.locator('#sFallback')).toHaveValue(/qwen-plus/);
  });
  test('A16 知识库：上传规范文本并检索', async ({ page }) => {
    await page.evaluate(() => document.querySelector('[data-act=kb]').click());
    await page.setInputFiles('#kbFile', { name: '地方标准-风雨操场.txt', mimeType: 'text/plain', buffer: Buffer.from('风雨操场净高不应低于 9 m，屋面宜采用轻钢结构。') });
    await expect(page.locator('.kb-list')).toContainText('地方标准-风雨操场'); await page.fill('#kbQ', '风雨操场 净高'); await page.click('#kbGo');
    await expect(page.locator('#kbRes')).toContainText('[来源1] 地方标准-风雨操场');
    await page.click('#kbClose'); await page.keyboard.press('Control+L'); await page.fill('#chatInput', '风雨操场净高要求？'); await page.click('#chatSend');
    await expect(page.locator('#chatList .cb').last()).toContainText('地方标准-风雨操场');
  });
});
