const { test, expect } = require('@playwright/test');
const AW = require('../src/agents.js');
const def = a => Object.fromEntries(a.fields.map(f => [f.key, f.default]));
const A = id => AW.AGENTS.find(a => a.id === id);

test('U01 智能体覆盖五个设计阶段共 15 个', () => {
  expect(AW.AGENTS.length).toBe(15);
  expect([...new Set(AW.AGENTS.map(a => a.stage))]).toEqual(['方案设计', '初步设计', '施工图设计', '施工配合', '竣工']);
  for (const a of AW.AGENTS) { expect(a.icon).toMatch(/^ri-/); if (!a.tool) { expect(typeof a.mock).toBe('function'); expect(typeof a.prompt).toBe('function'); } else expect(typeof a.summary).toBe('function'); }
});
test('U02 全部生成式/计算式智能体默认输出有效', () => {
  for (const a of AW.AGENTS.filter(a => !a.tool)) { const t = a.mock(def(a), { name: '测试工程', records: {} }); expect(t).toMatch(/^## /); expect(t).toContain('测试工程'); }
});
test('U03 日照标准 GB 50180 表 4.0.9', () => {
  expect(AW.sunlightStandard('Ⅱ 寒冷地区', '大城市')).toEqual({ day: '大寒日', hours: 2 });
  expect(AW.sunlightStandard('Ⅲ 夏热冬冷地区', '中小城市')).toEqual({ day: '大寒日', hours: 3 });
  expect(AW.sunlightStandard('Ⅳ 夏热冬暖地区', '中小城市')).toEqual({ day: '冬至日', hours: 1 });
  expect(AW.sunlightStandard('Ⅴ 温和地区', '大城市')).toEqual({ day: '冬至日', hours: 1 });
});
test('U04 场地容量：退线可建范围、计容上限', () => {
  const c = AW.siteCapacity({ siteArea: 8000, siteWidth: 100, siteDepth: 80, setbackN: 10, setbackS: 8, setbackE: 6, setbackW: 8, far: 1.5, density: 40, green: 35, height: 24, sunCoef: 1.2 });
  expect(c.buildable).toBe(86 * 62); expect(c.maxGfa).toBe(12000); expect(c.maxFootprint).toBe(3200); expect(c.minGreen).toBe(2800); expect(c.spacing).toBeCloseTo(28.8);
});
test('U05 防火分类 GB 50016 5.1.1', () => {
  expect(AW.fireClass('住宅', 54)).toBe('二类高层住宅'); expect(AW.fireClass('住宅', 54.1)).toBe('一类高层住宅'); expect(AW.fireClass('住宅', 27)).toBe('单、多层住宅');
  expect(AW.fireClass('公共建筑', 24)).toBe('单、多层公共建筑'); expect(AW.fireClass('公共建筑', 30, '否')).toBe('二类高层公共建筑'); expect(AW.fireClass('公共建筑', 30, '是')).toBe('一类高层公共建筑'); expect(AW.fireClass('公共建筑', 51)).toBe('一类高层公共建筑');
});
test('U06 规范校核：防火分区、疏散、栏杆、坡道、日照', () => {
  const b = def(A('code'));
  expect(AW.checkCompliance(b).failCount).toBe(0);
  const r = AW.checkCompliance({ ...b, height: 30, compArea: 3500, sprinkler: '是', fireLane: '否', railHeight: 1.05, ramp: 10, use: '住宅', sunHours: 1.5 });
  const f = r.rows.filter(x => !x.pass).map(x => x.item);
  expect(f).toEqual(expect.arrayContaining(['防火分区最大允许建筑面积', '消防车道', '临空栏杆高度', '轮椅坡道坡度', '住宅日照标准']));
  expect(r.rows.find(x => x.item === '防火分区最大允许建筑面积').req).toContain('3000');
});
test('U07 经济技术指标', () => {
  const c = AW.calcIndicators({ ...def(A('indicators')), aboveArea: 13000 });
  expect(c.far).toBeCloseTo(1.625); expect(c.carReq).toBe(104); expect(c.failCount).toBeGreaterThanOrEqual(2);
});
test('U08 投资估算 / 设计概算费用构成', () => {
  const i = { stage: '投资估算', type: '住宅', aboveArea: 1000, belowArea: 0, region: '二线城市', grade: '标准型', infraFee: 0, contRate: 8 };
  const c = AW.estimateCost(i);
  expect(c.eng).toBe(3300000); expect(c.engItems.reduce((s, x) => s + x.amount, 0)).toBeCloseTo(c.eng);
  const otherRate = 0.012 + 0.004 + 0.006 + 0.028 + 0.0015 + 0.016 + 0.003 + 0.004 + 0.0015;
  expect(c.other).toBeCloseTo(3300000 * otherRate); expect(c.total).toBeCloseTo(3300000 * (1 + otherRate) * 1.08);
  const g = AW.estimateCost({ ...i, stage: '设计概算', belowArea: 100, infraFee: 100, contRate: 5 });
  expect(g.engItems.length).toBe(10); expect(g.otherItems.find(x => x.name === '城市基础设施配套费').amount).toBe(110000);
});
test('U09 图号与图纸完整性', () => {
  const l = [{ discipline: '建筑', no: '建施-01', title: '建筑设计总说明', size: 'A1' }, { discipline: '建筑', no: '建施-02', title: '总平面图', size: 'A0' }, { discipline: '结构', no: '结施-01', title: '结构设计总说明', size: 'A2' }];
  expect(AW.drawingNo('建筑', l)).toBe('建施-03'); expect(AW.drawingNo('暖通', l)).toBe('暖施-01');
  const c = AW.drawingCheck(l); expect(c.a1).toBeCloseTo(3.5); expect(c.missingDisc).toEqual(['给排水', '暖通', '电气']); expect(c.missingArch).toEqual(['平面图', '立面图', '剖面图', '详图']);
});
test('U10 图审意见拆分与规范匹配', () => {
  const r = AW.planCheckReply('1. 疏散距离超限（强制性条文）\n2、栏杆高度不足\n3) 其他');
  expect(r.length).toBe(3); expect(r[0].basis).toContain('GB 50016'); expect(r[0].type).toBe('强制性条文'); expect(r[1].basis).toContain('GB 55031'); expect(r[2].basis).toBe('相关现行规范');
});
test('U11 报建清单与专项', () => {
  const a = AW.permitList({ matter: '建设工程规划许可证', civilDefense: '否', green: '否', sponge: '否', prefab: '否' });
  const b = AW.permitList({ matter: '建设工程规划许可证', civilDefense: '是', green: '是', sponge: '是', prefab: '是' });
  expect(b.length - a.length).toBe(4); expect(a.map(x => x[0]).join()).toContain('用地红线');
});
test('U12 变更 / 核定 / 现场 编号规则', () => {
  const l = [{ form: '设计变更单', discipline: '建筑' }, { form: '技术核定单', discipline: '结构' }];
  expect(AW.recordNo('change', { form: '设计变更单', discipline: '建筑' }, l)).toBe('SJBG-建-002');
  expect(AW.recordNo('change', { form: '设计变更单', discipline: '结构' }, l)).toBe('SJBG-结-001');
  expect(AW.recordNo('change', { form: '技术核定单', discipline: '电气' }, l)).toBe('JSHD-002');
  expect(AW.recordNo('service', {}, [1, 2])).toBe('XCFW-003');
});
test('U13 Markdown 转义与图标标记', () => {
  const h = AW.md('## 标题\n| a | b |\n|---|---|\n| [OK] | <x> |');
  expect(h).toContain('<h3>标题</h3>'); expect(h).toContain('&lt;x&gt;'); expect(h).toContain('ri-checkbox-circle-fill');
});
test('U14 LLM 成功 / 失败回退 / 计算型本地', async () => {
  const a = A('brief'), s = { mode: 'llm', apiKey: 'k', endpoint: 'http://x/v1/', model: 'm' }; let seen;
  const ok = async (url, o) => { seen = { url, body: JSON.parse(o.body), auth: o.headers.Authorization }; return { ok: true, json: async () => ({ choices: [{ message: { content: 'R' } }] }) }; };
  expect(await AW.runAgent(a, def(a), null, s, ok)).toEqual({ text: 'R', source: 'llm' });
  expect(seen.url).toBe('http://x/v1/chat/completions'); expect(seen.auth).toBe('Bearer k'); expect(seen.body.messages[0].content).toContain('GB 50016');
  const f = await AW.runAgent(a, def(a), null, s, async () => ({ ok: false, status: 401 })); expect(f.source).toBe('mock'); expect(f.error).toContain('401');
  expect((await AW.runAgent(A('cost'), def(A('cost')), null, { ...s, aiNotes: false }, ok)).source).toBe('calc');
  const withNote = await AW.runAgent(A('cost'), def(A('cost')), null, s, ok); expect(withNote.source).toBe('calc+llm'); expect(withNote.text).toContain('工程建设其他费用'); expect(withNote.text.endsWith('R')).toBe(true);
  expect((await AW.runAgent(A('cost'), def(A('cost')), null, { ...s, localCalc: false }, ok)).source).toBe('llm');
});
test('U15 源码无 emoji 图标', () => { expect(require('../scripts-check-emoji.js')).toEqual([]); });

const sseFetch = (chunks, delay = 5, ct = 'text/event-stream') => async () => ({ ok: true, headers: { get: () => ct }, body: new ReadableStream({ async start(c) { for (const x of chunks) { await new Promise(r => setTimeout(r, delay)); c.enqueue(new TextEncoder().encode(x)); } c.close(); } }) });
test('U16 SSE 解析：keep-alive、分片、[DONE]、错误事件', () => {
  const p = AW.parseSSE(': keep-alive\n\ndata: {"choices":[{"delta":{"content":"你"}}]}\ndata: {"choices":[{"delta":{"reasoning_content":"想"}}]}\ndata: [DONE]\ndata: {"cho');
  expect(p.deltas.map(d => d.content + d.reasoning)).toEqual(['你', '想']); expect(p.done).toBe(true); expect(p.rest).toBe('data: {"cho');
  expect(AW.parseSSE('data: {"error":{"message":"busy"}}\n').deltas[0].error).toBe('busy');
  expect(AW.chatUrl('https://api.deepseek.com/')).toBe('https://api.deepseek.com/chat/completions'); expect(AW.chatUrl('http://x/v1/chat/completions')).toBe('http://x/v1/chat/completions');
});
test('U17 流式调用：逐段回调并拼接', async () => {
  const seen = []; const ev = s => `data: ${JSON.stringify({ choices: [{ delta: { content: s } }] })}\n\n`;
  const t = await AW.callLLM({ apiKey: 'k', endpoint: 'http://x', model: 'm' }, { prompt: 'p', stream: true, onDelta: x => seen.push(x), fetchImpl: sseFetch([': keep-alive\n\n', ev('## 标'), ev('题'), 'data: [DONE]\n\n']) });
  expect(t).toBe('## 标题'); expect(seen).toEqual(['## 标', '## 标题']);
});
test('U18 超时与错误处理：首字超时、HTTP 503、流内错误、空响应', async () => {
  const S = { apiKey: 'k', endpoint: 'http://x', model: 'm', timeout: 0.2 };
  const hang = async (u, o) => ({ ok: true, headers: { get: () => 'text/event-stream' }, body: new ReadableStream({ start(c) { const i = setInterval(() => c.enqueue(new TextEncoder().encode(': keep-alive\n\n')), 30); o.signal.addEventListener('abort', () => { clearInterval(i); c.error(new Error('aborted')); }); } }) });
  await expect(AW.callLLM(S, { prompt: 'p', stream: true, fetchImpl: hang })).rejects.toThrow('等待模型响应超时');
  await expect(AW.callLLM(S, { prompt: 'p', fetchImpl: async () => ({ ok: false, status: 503, json: async () => ({ error: { message: 'Service is too busy' } }) }) })).rejects.toThrow(/HTTP 503：Service is too busy（模型服务繁忙/);
  await expect(AW.callLLM(S, { prompt: 'p', stream: true, fetchImpl: sseFetch(['data: {"error":{"message":"overloaded"}}\n\n']) })).rejects.toThrow('模型返回错误：overloaded');
  await expect(AW.callLLM(S, { prompt: 'p', stream: true, fetchImpl: sseFetch(['data: [DONE]\n\n']) })).rejects.toThrow('模型未返回内容');
  const r = await AW.runAgent(A('brief'), def(A('brief')), null, { ...S, mode: 'llm' }, null, { stream: true, fetchImpl: hang });
});
test('U19 上下文注入：规划条件、指标、记录', () => {
  const p = { name: '成都七中某校区', code: 'SJ-1', plan: { siteArea: 30000, far: 1.2, density: 30, green: 35, height: 24 }, runs: [{ agent: 'indicators', input: { ...def(A('indicators')), siteArea: 30000, aboveArea: 33000 } }], records: { change: [{ no: 'SJBG-建-001', form: '设计变更单', discipline: '建筑', sheet: '建施-05', status: '已签发' }] } };
  const m = AW.buildMessages(A('brief'), def(A('brief')), p);
  expect(m[0].content).toContain('GB 50099-2011'); expect(m[0].content).toContain('严禁编造条文号');
  expect(m[1].content).toContain('容积率 ≤ 1.2'); expect(m[1].content).toContain('容积率 1.10'); expect(m[1].content).toContain('SJBG-建-001'); expect(m[1].content).toContain('【输出格式】');
  const n = AW.buildMessages(A('code'), def(A('code')), p, 'note', 'CALC'); expect(n[1].content).toContain('【本地计算结果】\nCALC'); expect(n[1].content).toContain('AI 说明与建议');
});
const PL = require('../src/pilot.js');
test('U20 AI 主导引擎：JSON 解析、规则推算、记录草拟编号与规则校验、前序摘要', async () => {
  expect(PL.parseJSON('```json\n{"values":{"a":1}}\n```').values.a).toBe(1);
  const p = { name: 'X', area: 36000, type: '中小学校', plan: { siteArea: 30000, far: 1.2, density: 30, green: 35, height: 24 }, runs: [{ agent: 'brief', text: '任务书要点 ABC' }], records: { drawings: [], review: [], change: [], service: [] } };
  const f = PL.heuristicFill(A('indicators'), p); expect(+f.aboveArea).toBeLessThanOrEqual(30000 * 1.2); expect(+f.aboveArea + +f.belowArea).toBe(36000); expect(f.heightLimit).toBe('24');
  const r = await PL.aiRecords('drawings', p, { mode: 'mock' }); expect(r.records[0].no).toBe('建施-01'); expect(r.verify).toContain('drawingCheck'); expect(r.records.every(x => x.ai)).toBe(true);
  const rv = await PL.aiRecords('review', p, { mode: 'mock' }); expect(rv.verify).toContain('强制性条文 1 条');
  expect(PL.digest(p, 'site')).toContain('任务书要点 ABC'); expect(PL.PIPELINE.map(s => s.id)).toEqual(['brief', 'site', 'concept', 'indicators', 'cost', 'code', 'review', 'drawings', 'plancheck', 'construction', 'completion']);
  const res = await PL.runStep(PL.PIPELINE[3], p, { mode: 'mock' }); expect(res.text).toContain('规则工具 calcIndicators'); expect(res.text).toContain('下一步建议');
});
