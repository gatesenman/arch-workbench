/* v2.7 AI 增强：多模型 / 重试回退 / 用量统计、工具调用智能体、项目知识库（BM25 + 引用）、
 * 助手命令（/命令、@智能体、记忆）、AI 自检、选区内联改写、提示词模板、流水线重规划。
 * 原则：规则引擎是 AI 的工具；离线时用同一套工具按意图规划执行，结果可复核。 */
(function (root, factory) {
  const AW = root.AW || (typeof require !== 'undefined' ? require('./agents.js') : null);
  const m = factory(AW); if (typeof module === 'object' && module.exports) module.exports = m; else root.AW_AI = m;
})(typeof self !== 'undefined' ? self : globalThis, function (AW) {
  const num = (v, d = 0) => { const n = parseFloat(v); return isFinite(n) ? n : d; };
  const fmt = (n, d = 0) => Number(n).toLocaleString('zh-CN', { minimumFractionDigits: d, maximumFractionDigits: d });
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const llmOn = s => !!(s && s.mode === 'llm' && s.apiKey);

  /* ================= 1. 多模型 ================= */
  /* 价格为公开牌价的示意值（元 / 百万 tokens，输入/输出），仅用于用量估算 */
  const PROVIDERS = {
    deepseek: { name: 'DeepSeek', endpoint: 'https://api.deepseek.com', models: ['deepseek-chat', 'deepseek-reasoner', 'deepseek-flash'], price: [2, 8], tools: true },
    qwen: { name: '通义千问', endpoint: 'https://dashscope.aliyuncs.com/compatible-mode/v1', models: ['qwen-plus', 'qwen-max', 'qwen-turbo'], price: [0.8, 2], tools: true },
    zhipu: { name: '智谱 GLM', endpoint: 'https://open.bigmodel.cn/api/paas/v4', models: ['glm-4-plus', 'glm-4-air', 'glm-4-flash'], price: [5, 5], tools: true },
    wenxin: { name: '文心一言（千帆 v2）', endpoint: 'https://qianfan.baidubce.com/v2', models: ['ernie-4.0-turbo-8k', 'ernie-speed-128k'], price: [3, 9], tools: true },
    kimi: { name: 'Kimi（Moonshot）', endpoint: 'https://api.moonshot.cn/v1', models: ['moonshot-v1-32k', 'moonshot-v1-8k', 'kimi-latest'], price: [24, 24], tools: true },
    ollama: { name: '本地 Ollama', endpoint: 'http://localhost:11434/v1', models: ['qwen2.5:14b', 'qwen2.5:7b', 'deepseek-r1:14b'], price: [0, 0], tools: true, local: true }
  };
  function providerOf(endpoint) { const e = String(endpoint || ''); for (const [k, p] of Object.entries(PROVIDERS)) if (e.startsWith(p.endpoint.replace(/\/v\d$/, '')) || e.includes(new URL(p.endpoint).host)) return k; return 'custom'; }
  const estTokens = s => Math.ceil(String(s || '').replace(/\s+/g, ' ').length / 1.6);
  /** 解析备用链：每行 “服务商|接口地址|模型|API Key” */
  function parseChain(text) { return String(text || '').split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#')).map(l => { const [prov, endpoint, model, apiKey] = l.split('|').map(x => (x || '').trim()); const P = PROVIDERS[prov]; return { provider: prov, endpoint: endpoint || (P && P.endpoint) || '', model: model || (P && P.models[0]) || '', apiKey: apiKey || (P && P.local ? 'ollama' : '') }; }).filter(x => x.endpoint && x.model); }
  /** 候选模型序列：按智能体指定模型 → 主模型 → 备用链 */
  function candidates(settings, agentId) {
    const s = settings || {}; const list = [];
    const per = (s.agentModels || {})[agentId];
    if (per) { const m = String(per).split('|'); list.push({ ...s, model: m[m.length - 1].trim(), ...(m.length > 1 ? (() => { const c = parseChain(per)[0]; return c || {}; })() : {}), _why: '智能体专用模型' }); }
    list.push({ ...s, _why: '主模型' });
    parseChain(s.fallback).forEach(c => list.push({ ...s, ...c, _why: '备用：' + (PROVIDERS[c.provider] ? PROVIDERS[c.provider].name : c.provider) }));
    const seen = new Set(); return list.filter(x => { const k = x.endpoint + '|' + x.model; if (seen.has(k) || !x.apiKey || !x.endpoint) return false; seen.add(k); return true; });
  }
  const retryable = msg => /HTTP (408|409|425|429|5\d\d)|网络错误|超时|流式读取中断|模型未返回内容/.test(String(msg));
  /* 用量统计（由 app 注入持久化对象） */
  let USAGE = { calls: 0, fails: 0, prompt: 0, completion: 0, cost: 0, byModel: {}, log: [] };
  function bindUsage(obj) { USAGE = obj; ['calls', 'fails', 'prompt', 'completion', 'cost'].forEach(k => USAGE[k] ||= 0); USAGE.byModel ||= {}; USAGE.log ||= []; return USAGE; }
  function record(model, endpoint, pt, ct, ok, real, agentId) {
    const pv = PROVIDERS[providerOf(endpoint)]; const price = pv ? pv.price : [2, 8]; const cost = (pt * price[0] + ct * price[1]) / 1e6;
    USAGE.calls++; if (!ok) USAGE.fails++; USAGE.prompt += pt; USAGE.completion += ct; USAGE.cost += cost;
    const b = USAGE.byModel[model] ||= { calls: 0, prompt: 0, completion: 0, cost: 0, fails: 0 }; b.calls++; b.prompt += pt; b.completion += ct; b.cost += cost; if (!ok) b.fails++;
    USAGE.log.push({ t: Date.now(), model, agent: agentId || '', pt, ct, ok, real: !!real }); if (USAGE.log.length > 200) USAGE.log.shift();
    onUsage && onUsage(USAGE);
  }
  let onUsage = null; const setUsageHook = f => { onUsage = f; };
  /** 包装 AW.callLLM：按候选序列逐个尝试，每个候选可重试（指数退避），记录 tokens */
  const rawCall = AW._rawCallLLM || AW.callLLM; AW._rawCallLLM = rawCall;
  async function callWithFallback(settings, promptOrOpts, fetchImpl) {
    const o = typeof promptOrOpts === 'string' ? { prompt: promptOrOpts } : (promptOrOpts || {});
    if (!settings || !settings.apiKey || !settings.endpoint) return null;
    const cands = candidates(settings, o.agentId); const retries = Math.max(0, Math.min(3, num(settings.retries, 1))); let lastErr;
    const pin = (o.messages || [{ content: o.prompt }]).map(m => m.content || '').join('\n');
    for (const c of cands) {
      for (let k = 0; k <= retries; k++) {
        try { const t = await rawCall(c, o, fetchImpl); record(c.model, c.endpoint, estTokens(pin), estTokens(t), true, false, o.agentId); o.onRoute && o.onRoute({ model: c.model, why: c._why, attempt: k + 1 }); return t; }
        catch (e) { lastErr = e; record(c.model, c.endpoint, estTokens(pin), 0, false, false, o.agentId); if (/已取消/.test(e.message)) throw e; if (/401|402|403|404/.test(e.message)) break; if (!retryable(e.message)) break; if (k < retries) await sleep(Math.min(300 * 2 ** k, 2000) * (settings._fastRetry ? 0.01 : 1)); }
      }
    }
    throw lastErr || new Error('无可用模型');
  }
  AW.callLLM = callWithFallback;

  /** 非流式 chat，支持 tools / tool_calls，返回真实 usage */
  async function chatOnce(c, body, fetchImpl, signal) {
    const f = fetchImpl || (typeof fetch !== 'undefined' ? fetch : null);
    const url = String(c.endpoint).replace(/\/+$/, '').replace(/\/chat\/completions$/, '') + '/chat/completions';
    const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null; const tm = setTimeout(() => ctrl && ctrl.abort(), (c.timeout || 90) * 1000);
    signal && signal.addEventListener('abort', () => ctrl && ctrl.abort());
    let r; try { r = await f(url, { method: 'POST', signal: ctrl && ctrl.signal, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + c.apiKey }, body: JSON.stringify({ model: c.model, temperature: num(c.temperature, 0.3), stream: false, ...body }) }); }
    catch (e) { clearTimeout(tm); throw new Error('网络错误：' + (e.message || e)); }
    clearTimeout(tm);
    if (!r.ok) { let msg = ''; try { const j = await r.json(); msg = (j.error && (j.error.message || j.error)) || ''; } catch { } throw new Error(`HTTP ${r.status}${msg ? '：' + msg : ''}${r.status === 401 ? '（API Key 无效）' : ''}`); }
    const j = await r.json(); const m = j.choices && j.choices[0] && j.choices[0].message; if (!m) throw new Error('模型未返回内容');
    const u = j.usage || {}; return { message: m, usage: { pt: u.prompt_tokens || estTokens(JSON.stringify(body.messages)), ct: u.completion_tokens || estTokens(m.content || JSON.stringify(m.tool_calls || '')), real: !!j.usage } };
  }
  async function chatTools(settings, body, opts = {}) {
    const cands = candidates(settings, opts.agentId); const retries = Math.max(0, Math.min(3, num(settings.retries, 1))); let lastErr;
    for (const c of cands) for (let k = 0; k <= retries; k++) {
      try { const r = await chatOnce(c, body, opts.fetchImpl, opts.signal); record(c.model, c.endpoint, r.usage.pt, r.usage.ct, true, r.usage.real, opts.agentId); return { ...r, model: c.model, why: c._why }; }
      catch (e) { lastErr = e; record(c.model, c.endpoint, 0, 0, false, false, opts.agentId); if (/401|402|403|404/.test(e.message) || !retryable(e.message)) break; if (k < retries) await sleep(Math.min(300 * 2 ** k, 2000) * (settings._fastRetry ? 0.01 : 1)); }
    }
    throw lastErr || new Error('无可用模型');
  }

  /* ================= 2. 项目知识库（BM25） ================= */
  function tokenize(s) {
    const t = String(s || '').toLowerCase(); const out = [];
    (t.match(/[a-z]+[0-9.]*|[0-9]+(?:\.[0-9]+)?/g) || []).forEach(w => out.push(w));
    (t.match(/[\u4e00-\u9fa5]+/g) || []).forEach(seg => { if (seg.length === 1) out.push(seg); for (let i = 0; i < seg.length - 1; i++) out.push(seg.slice(i, i + 2)); });
    return out;
  }
  function chunk(text, size = 360) {
    const paras = String(text || '').replace(/\r/g, '').split(/\n(?=#{1,4}\s)|\n{2,}/).map(x => x.trim()).filter(Boolean); const out = []; let cur = '';
    for (const p of paras) { if ((cur + '\n' + p).length > size && cur) { out.push(cur); cur = p; } else cur = cur ? cur + '\n' + p : p; while (cur.length > size * 1.6) { out.push(cur.slice(0, size)); cur = cur.slice(size); } }
    if (cur) out.push(cur); return out;
  }
  /** 内置规范要点（离线也可引用；条文以规范原文为准） */
  const NORM_SNIPPETS = [
    ['GB 50016-2014(2018) 5.3.1', '民用建筑防火分区最大允许建筑面积：高层民用建筑 1500 ㎡；单、多层民用建筑 2500 ㎡；地下或半地下建筑（室）500 ㎡，设备用房不应大于 1000 ㎡。设置自动灭火系统时可按本表增加 1.0 倍。'],
    ['GB 50016-2014(2018) 表 5.5.17', '直通疏散走道的房间疏散门至最近安全出口的直线距离：托儿所幼儿园老年人照料设施 25/20 m；医疗建筑单多层 35/20 m，高层病房 24/12 m；教学建筑单多层 35/22 m，高层 30/15 m；高层旅馆、展览建筑 30/15 m；其他建筑单多层 40/22 m，高层 40/20 m。建筑内全部设置自动喷水灭火系统时可增加 25%。'],
    ['GB 50016-2014(2018) 5.3.4', '一、二级耐火等级建筑内的商店营业厅、展览厅，设置自动灭火系统和火灾自动报警系统并采用不燃或难燃装修材料时：设置在高层建筑内时不应大于 4000 ㎡；设置在单层建筑或仅设置在多层建筑首层内时不应大于 10000 ㎡；设置在地下或半地下时不应大于 2000 ㎡。'],
    ['GB 50099-2011 4.3.3', '普通教室冬至日满窗日照不应少于 2 h；至少应有 1 间科学教室或生物实验室的室内能在冬季获得直射阳光。'],
    ['GB 50099-2011 4.3.7', '各类教室的外窗与相对的教学用房或室外运动场地边缘间的距离不应小于 25 m。'],
    ['GB 50180-2018 4.0.9', '住宅建筑日照标准：Ⅰ、Ⅱ、Ⅲ气候区大城市大寒日 ≥ 2 h，中小城市大寒日 ≥ 3 h；Ⅳ气候区大城市大寒日 ≥ 3 h，中小城市冬至日 ≥ 1 h；Ⅴ、Ⅵ气候区冬至日 ≥ 1 h。'],
    ['GB 50352-2019 6.7.3', '临空高度在 24 m 以下时，栏杆高度不应低于 1.05 m；临空高度在 24 m 及以上时，栏杆高度不应低于 1.10 m；上人屋面和交通、商业、旅馆、学校、医院等建筑临开敞中庭的栏杆高度不应低于 1.2 m。'],
    ['GB 55019-2021 2.3', '轮椅坡道的坡度不应大于 1:12；每段坡道的提升高度不应大于 750 mm。'],
    ['GB 50352-2019 4.2.4', '建筑基地机动车出入口位置距大中城市主干道交叉口的距离，自道路红线交点量起不应小于 70 m。']
  ];
  function buildKB(p, opts = {}) {
    const docs = []; const add = (src, title, text, kind) => chunk(text).forEach((c, i) => docs.push({ id: `${src}#${i + 1}`, src, title, kind, text: c }));
    if (opts.norms !== false) NORM_SNIPPETS.forEach(([t, x]) => add('norm:' + t, t, x, '规范'));
    (p && p.kb || []).forEach(d => add('kb:' + d.id, d.name, d.text, d.kind || '资料'));
    const latest = {}; (p && p.runs || []).forEach(r => { latest[r.agent] = r; });
    const names = Object.fromEntries((AW.AGENTS || []).map(a => [a.id, a.name]));
    Object.values(latest).forEach(r => add('run:' + r.id, (names[r.agent] || r.agent) + ' 成果', r.text, '成果'));
    const brief = (p && p.runs || []).filter(r => r.agent === 'brief' && r.input && r.input.brief).slice(-1)[0];
    if (brief) add('brief:' + brief.id, '设计任务书原文', brief.input.brief, '任务书');
    if (p) add('proj:' + p.id, '项目信息', AW.buildContext(p), '项目');
    const tf = docs.map(d => { const m = new Map(); const toks = tokenize(d.title + ' ' + d.text); toks.forEach(t => m.set(t, (m.get(t) || 0) + 1)); return { m, len: toks.length }; });
    const df = new Map(); tf.forEach(x => x.m.forEach((_, t) => df.set(t, (df.get(t) || 0) + 1)));
    const avg = tf.reduce((s, x) => s + x.len, 0) / Math.max(tf.length, 1);
    return { docs, tf, df, avg, N: docs.length };
  }
  function searchKB(kb, q, k = 4) {
    const qs = [...new Set(tokenize(q))]; if (!qs.length || !kb.N) return [];
    const k1 = 1.5, b = 0.75;
    return kb.docs.map((d, i) => { const { m, len } = kb.tf[i]; let s = 0;
      qs.forEach(t => { const f = m.get(t); if (!f) return; const n = kb.df.get(t); const idf = Math.log(1 + (kb.N - n + 0.5) / (n + 0.5)); s += idf * f * (k1 + 1) / (f + k1 * (1 - b + b * len / kb.avg)); });
      return { ...d, score: s }; }).filter(x => x.score > 0.5).sort((a, b) => b.score - a.score).slice(0, k);
  }
  const citeBlock = hits => hits.length ? '\n\n---\n**参考来源**\n' + hits.map((h, i) => `- [来源${i + 1}] ${h.kind} · ${h.title}（${h.id.split('#')[1] ? '片段 ' + h.id.split('#')[1] : ''}）`).join('\n') : '';

  /* ================= 3. 工具（function calling） ================= */
  const S = (props, req) => ({ type: 'object', properties: props, required: req || [] });
  const n = d => ({ type: 'number', description: d }), t = d => ({ type: 'string', description: d });
  const TOOLS = [
    { name: 'get_project', label: '读取项目数据', icon: 'ri-folder-info-line', description: '读取当前项目基本信息、规划条件、记录统计与最近成果列表', parameters: S({}) },
    { name: 'calc_indicators', label: '经济技术指标核算', icon: 'ri-bar-chart-box-line', description: '按 GB 50352 口径核算容积率、建筑密度、绿地率、停车配建并对照规划条件', parameters: S({ siteArea: n('规划用地面积 ㎡'), aboveArea: n('地上计容面积 ㎡'), belowArea: n('地下面积 ㎡'), footprint: n('基底面积 ㎡'), greenArea: n('绿地面积 ㎡'), height: n('建筑高度 m'), farLimit: n('容积率上限'), densityLimit: n('密度上限 %'), greenLimit: n('绿地率下限 %'), heightLimit: n('限高 m') }) },
    { name: 'estimate_cost', label: '投资估算', icon: 'ri-money-cny-circle-line', description: '按单方造价库估算工程费用、其他费用、预备费与总投资', parameters: S({ type: t('建筑类型'), aboveArea: n('地上面积'), belowArea: n('地下面积'), region: t('一线城市/新一线城市/二线城市/三四线城市'), grade: t('经济型/标准型/品质型/高端型'), stage: t('投资估算/设计概算') }) },
    { name: 'check_fire_code', label: 'GB 50016 防火与规范校核', icon: 'ri-fire-line', description: '按建筑类型校核建筑分类、防火分区、安全出口、疏散距离、栏杆、无障碍、日照', parameters: S({ btype: t('建筑类型'), height: n('建筑高度 m'), sprinkler: t('是/否'), compArea: n('最大防火分区 ㎡'), evacDist: n('疏散距离 m'), exits: n('安全出口数') }) },
    { name: 'sunlight_standard', label: '日照标准查询', icon: 'ri-sun-line', description: '查询建筑类型对应的日照标准（GB 50180 / GB 50099 等）', parameters: S({ type: t('建筑类型'), climate: t('气候区，如 Ⅲ 夏热冬冷地区'), citySize: t('大城市/中小城市') }, ['type']) },
    { name: 'check_drawings', label: '图纸目录完整性检查', icon: 'ri-file-list-3-line', description: '检查项目图纸目录专业是否齐全、建施必备图纸是否缺失、折合 A1 张数', parameters: S({}) },
    { name: 'search_knowledge', label: '检索项目知识库', icon: 'ri-book-search-line', description: '在项目知识库（任务书、成果、上传规范、内置规范要点）中检索，返回带来源编号的片段', parameters: S({ query: t('检索词') }, ['query']) }
  ];
  const toolSpec = () => TOOLS.map(x => ({ type: 'function', function: { name: x.name, description: x.description, parameters: x.parameters } }));
  function defaultsFor(id) { const a = (AW.AGENTS || []).find(x => x.id === id); return a ? Object.fromEntries(a.fields.map(f => [f.key, f.default])) : {}; }
  function execTool(name, args, ctx) {
    const p = ctx.project || {}; const pl = p.plan || {}; args = args || {};
    const clean = o => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== ''));
    switch (name) {
      case 'get_project': { const r = p.records || {}; return { name: p.name, code: p.code, type: p.type, area: p.area, stage: p.stage, location: p.location, plan: pl, records: Object.fromEntries(Object.entries(r).map(([k, v]) => [k, Array.isArray(v) ? v.length : 0])), openReview: (r.review || []).filter(x => x.status !== '已闭合').length, latestRuns: [...new Set((p.runs || []).map(x => x.agent))] }; }
      case 'calc_indicators': { const last = (p.runs || []).filter(x => x.agent === 'indicators' && x.input).slice(-1)[0];
        const i = { ...defaultsFor('indicators'), ...(last ? last.input : {}), ...(pl.siteArea ? { siteArea: pl.siteArea, farLimit: pl.far, densityLimit: pl.density, greenLimit: pl.green, heightLimit: pl.height } : {}), ...clean(args) };
        const c = AW.calcIndicators(i); return { input: i, far: +c.far.toFixed(3), density: +c.density.toFixed(2), greenRate: +c.greenRate.toFixed(2), carReq: c.carReq, car: c.car, failCount: c.failCount, fails: c.rows.filter(r => r[4] === false).map(r => `${r[0]} ${r[2]}（要求 ${r[3]}）`) }; }
      case 'estimate_cost': { const i = { ...defaultsFor('cost'), type: p.type || '办公', ...clean(args) }; if (!args.aboveArea && p.area) { i.aboveArea = Math.round(p.area * 0.82); i.belowArea = Math.round(p.area * 0.18); }
        const c = AW.estimateCost(i); return { input: i, unitAbove: Math.round(c.ua), unitBelow: Math.round(c.ub), engineering万元: +(c.eng / 1e4).toFixed(1), other万元: +(c.other / 1e4).toFixed(1), contingency万元: +(c.contingency / 1e4).toFixed(1), total万元: +(c.total / 1e4).toFixed(1), perSqm: Math.round(c.perSqm) }; }
      case 'check_fire_code': { const i = { ...defaultsFor('code'), btype: p.type || '办公', ...(pl.height ? { height: Math.min(pl.height, 23.9) } : {}), ...clean(args) }; if (i.btype === '住宅') i.use = '住宅';
        const c = AW.checkCompliance(i); return { input: { btype: i.btype, height: i.height, sprinkler: i.sprinkler, compArea: i.compArea, evacDist: i.evacDist }, cls: c.cls, pass: c.passCount, fail: c.failCount, fails: c.rows.filter(r => !r.pass).map(r => `${r.item}：${r.actual}，应 ${r.req}（${r.basis}）`), keyRows: c.rows.filter(r => /防火分区|疏散|日照/.test(r.item)).map(r => `${r.item}：${r.actual} / ${r.req} → ${r.pass ? '满足' : '不满足'}（${r.basis}）`) }; }
      case 'sunlight_standard': { const s = AW.sunlightByType(args.type || p.type, args.climate || 'Ⅲ 夏热冬冷地区', args.citySize || '大城市'); return s || { note: '该类型无强制日照标准，但不得降低周边日照敏感建筑现状日照' }; }
      case 'check_drawings': { const d = AW.drawingCheck((p.records && p.records.drawings) || []); return { count: d.count, a1: +d.a1.toFixed(2), missingDisc: d.missingDisc, missingArch: d.missingArch }; }
      case 'search_knowledge': { const hits = searchKB(ctx.kb || buildKB(p), args.query || '', 4); ctx.cites = ctx.cites || []; return { hits: hits.map(h => { let k = ctx.cites.findIndex(c => c.id === h.id); if (k < 0) { ctx.cites.push(h); k = ctx.cites.length - 1; } return { ref: `[来源${k + 1}]`, title: h.title, kind: h.kind, text: h.text.slice(0, 420) }; }) }; }
      default: return { error: '未知工具：' + name };
    }
  }

  /* 离线规划：按问题意图选择工具（与在线 function calling 同一套工具） */
  function planOffline(q, p) {
    const full = String(q); const forced = [...full.matchAll(/请调用工具 (\w+)/g)].map(m => m[1]); const s = full.split(/\n\n【@|\n（请调用工具/)[0]; const calls = [];
    forced.forEach(n => { if (n !== 'search_knowledge') calls.push([n, n === 'sunlight_standard' ? { type: p && p.type } : {}]); });
    const has = n => calls.some(c => c[0] === n);
    if (!has('calc_indicators') && /容积率|密度|绿地|指标|停车|计容/.test(s)) calls.push(['calc_indicators', {}]);
    if (!has('estimate_cost') && /估算|造价|投资|概算|单方/.test(s)) calls.push(['estimate_cost', {}]);
    if (!has('check_fire_code') && /防火|疏散|分区|消防|规范|校核|强条|栏杆|无障碍/.test(s)) { const h = s.match(/(\d+(?:\.\d+)?)\s*(m|米)/); calls.push(['check_fire_code', h ? { height: +h[1] } : {}]); }
    if (!has('sunlight_standard') && /日照|采光|冬至|大寒/.test(s)) calls.push(['sunlight_standard', { type: p && p.type }]);
    if (!has('check_drawings') && /图纸|目录|图号|建施|缺图/.test(s)) calls.push(['check_drawings', {}]);
    calls.push(['search_knowledge', { query: s.replace(/^[/@]\S+\s*/, '') }]);
    if (calls.length === 1) calls.unshift(['get_project', {}]);
    return calls;
  }
  function summarizeTool(name, r) {
    switch (name) {
      case 'get_project': return `项目 ${r.code || ''} ${r.name}（${r.type}，${fmt(r.area || 0)} ㎡，${r.stage}）；规划条件：${r.plan && r.plan.siteArea ? `用地 ${fmt(r.plan.siteArea)} ㎡，容积率 ≤ ${r.plan.far}，限高 ${r.plan.height} m` : '未录入'}；未闭合校审 ${r.openReview} 条。`;
      case 'calc_indicators': return `容积率 ${r.far}、建筑密度 ${r.density}%、绿地率 ${r.greenRate}%、机动车位 ${r.car}/${r.carReq}；${r.failCount ? '不满足 ' + r.failCount + ' 项：' + r.fails.join('；') : '各项指标满足规划条件'}。`;
      case 'estimate_cost': return `${r.input.type}，地上单方 ${fmt(r.unitAbove)} 元/㎡、地下 ${fmt(r.unitBelow)} 元/㎡；工程费用 ${fmt(r['engineering万元'], 1)} 万元，总投资约 **${fmt(r['total万元'], 1)} 万元**（综合单方 ${fmt(r.perSqm)} 元/㎡）。`;
      case 'check_fire_code': return `建筑分类：${r.cls}；满足 ${r.pass} 项 / 不满足 ${r.fail} 项。${r.keyRows.slice(0, 3).join('；')}${r.fail ? '。不满足项：' + r.fails.join('；') : ''}`;
      case 'sunlight_standard': return r.day ? `${r.room}：${r.day} ≥ ${r.hours} h（${r.basis}）` : r.note;
      case 'check_drawings': return `图纸 ${r.count} 张（折合 A1 ${r.a1} 张）；${r.missingDisc.length ? '缺少专业：' + r.missingDisc.join('、') : '专业齐全'}；${r.missingArch.length ? '建施缺少：' + r.missingArch.join('、') : '建施必备图纸齐全'}。`;
      case 'search_knowledge': return r.hits.length ? r.hits.map(h => `${h.ref} ${h.title}：${h.text.replace(/\s+/g, ' ').slice(0, 120)}…`).join('\n') : '知识库未检索到相关内容。';
      default: return JSON.stringify(r).slice(0, 300);
    }
  }
  const AGENT_SYS = '你是建筑设计院 AI 项目助手，可调用工具（规则引擎与项目知识库）。要求：①涉及指标、造价、防火疏散、日照、图纸时必须先调用相应工具，不得心算或臆造；②引用知识库内容时在句末标注工具返回的来源编号，如 [来源1]；③无法确定的条文写"待核"，需建设单位或主管部门确认的事项标注【待人工确认】；④简体中文、Markdown，先结论后依据，不使用 emoji。';

  /** 工具调用智能体：在线为 OpenAI function calling 循环；离线为意图规划 + 同一套工具。trace 实时回调 */
  async function runToolAgent({ settings, project, question, history = [], kb, onTrace, onDelta, fetchImpl, signal, maxSteps = 5, memory = '' }) {
    const ctx = { project, kb: kb || buildKB(project), cites: [] }; const trace = []; const push = e => { e.t = Date.now(); trace.push(e); onTrace && onTrace(e, trace); };
    const finish = (text, source, extra = {}) => { const used = ctx.cites.filter((c, i) => text.includes(`[来源${i + 1}]`)); const out = text + citeBlock(ctx.cites.length && used.length ? ctx.cites : used); push({ type: 'answer', text: '完成' }); return { text: out, trace, cites: ctx.cites, source, ...extra }; };
    if (llmOn(settings)) {
      const msgs = [{ role: 'system', content: AGENT_SYS + '\n\n' + AW.buildContext(project) + (memory ? '\n\n【对话记忆摘要】' + memory : '') }, ...history.slice(-8), { role: 'user', content: question }];
      try {
        for (let step = 0; step < maxSteps; step++) {
          push({ type: 'think', text: step === 0 ? '分析问题，判断需要调用的工具…' : `根据工具结果继续推理（第 ${step + 1} 轮）…` });
          const r = await chatTools(settings, { messages: msgs, tools: toolSpec(), tool_choice: 'auto' }, { fetchImpl, signal, agentId: 'assistant' });
          const m = r.message; if (m.reasoning_content) push({ type: 'think', text: String(m.reasoning_content).slice(0, 400) });
          if (m.tool_calls && m.tool_calls.length) {
            msgs.push({ role: 'assistant', content: m.content || '', tool_calls: m.tool_calls });
            for (const tc of m.tool_calls) { let args = {}; try { args = JSON.parse(tc.function.arguments || '{}'); } catch { }
              const def = TOOLS.find(x => x.name === tc.function.name); push({ type: 'tool', name: tc.function.name, label: def ? def.label : tc.function.name, icon: def ? def.icon : 'ri-tools-line', args });
              const res = execTool(tc.function.name, args, ctx); push({ type: 'result', name: tc.function.name, text: summarizeTool(tc.function.name, res) });
              msgs.push({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify(res) }); }
            continue;
          }
          const text = m.content || ''; onDelta && onDelta(text); return finish(text, 'llm', { model: r.model });
        }
        throw new Error('工具调用轮次超限');
      } catch (e) { push({ type: 'error', text: 'AI 接口失败，改用离线工具规划：' + (e.message || e) }); return offline(e); }
    }
    return offline();
    function offline(err) {
      push({ type: 'think', text: '离线模式：按问题意图规划工具调用（规则引擎 + 知识库检索）' });
      const parts = [];
      for (const [name, args] of planOffline(question, project)) { const def = TOOLS.find(x => x.name === name); push({ type: 'tool', name, label: def.label, icon: def.icon, args });
        const res = execTool(name, args, ctx); const sm = summarizeTool(name, res); push({ type: 'result', name, text: sm }); parts.push([def.label, sm, name]); }
      const kbPart = parts.find(x => x[2] === 'search_knowledge'); const calc = parts.filter(x => x[2] !== 'search_knowledge');
      const text = `## 回答：${String(question).slice(0, 40)}\n\n### 结论（依据规则工具计算）\n${calc.length ? calc.map(x => `- **${x[0]}**：${x[1]}`).join('\n') : '- 本问题未涉及可计算项，以下为知识库检索结果。'}\n\n### 相关依据\n${kbPart ? kbPart[1] : '—'}\n\n### 建议下一步\n- ${nextHint(project, calc.map(x => x[2]))}\n\n### 待人工确认\n- 以上为规则引擎与知识库检索结果，条文以规范原文为准【待人工确认】${err ? `\n\n> AI 接口调用失败：${err.message || err}；已使用离线工具规划。` : ''}\n\n> 【离线工具规划】未调用真实 AI 模型。`;
      onDelta && onDelta(text); return finish(text, 'mock');
    }
  }

  function nextHint(p, used) { const has = id => (p && p.runs || []).some(r => r.agent === id);
    if (!(p && p.plan && p.plan.siteArea)) return '先运行「规划条件与场地分析」录入规划设计条件';
    if (used.includes('check_fire_code')) return '打开「规范符合性校核」录入实际设计参数生成正式校核报告，并在三级校审中闭合不满足项';
    if (used.includes('estimate_cost')) return '在「工具 › 单方造价库」按当地信息价调整后，运行「投资估算 / 设计概算」';
    if (!has('indicators')) return '运行「经济技术指标核算」形成正式指标表';
    return '打开「AI 自动推进」继续推进下一阶段，关键节点由项目负责人确认签字'; }
  /* ================= 4. 助手：命令 / @提及 / 记忆 / 建议 ================= */
  const SLASH = {
    '/校核': { agent: 'code', tool: 'check_fire_code', label: '规范校核', q: '按 GB 50016 校核本项目防火分区、疏散距离和日照，列出不满足项与整改建议' },
    '/估算': { agent: 'cost', tool: 'estimate_cost', label: '投资估算', q: '按单方造价库估算本项目总投资，并说明主要造价风险' },
    '/汇报': { agent: 'report', label: '汇报提纲', q: '基于项目成果整理一份向建设单位汇报的提纲（含指标、规范结论、待决策事项）' },
    '/指标': { agent: 'indicators', tool: 'calc_indicators', label: '指标核算', q: '核算本项目容积率、建筑密度、绿地率与停车配建是否满足规划条件' },
    '/日照': { tool: 'sunlight_standard', label: '日照标准', q: '本项目适用的日照标准是什么' },
    '/图纸': { agent: 'drawings', tool: 'check_drawings', label: '图纸检查', q: '检查图纸目录是否齐全，缺哪些图' },
    '/帮助': { label: '帮助', q: '' }
  };
  function parseCommand(q, agents) {
    let s = String(q || '').trim(); const out = { raw: s, cmd: null, mentions: [], text: s };
    const m = s.match(/^\/(\S+)/); if (m && SLASH['/' + m[1]]) { out.cmd = '/' + m[1]; const rest = s.slice(m[0].length).trim(); out.text = rest || SLASH[out.cmd].q; }
    (agents || AW.AGENTS || []).forEach(a => { const re = new RegExp('@(' + a.name.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&') + '|' + a.short.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&') + ')'); if (re.test(out.text)) { out.mentions.push(a.id); out.text = out.text.replace(re, '「' + a.name + '」'); } });
    return out;
  }
  function helpText() { return '## 助手命令\n| 命令 | 作用 |\n|---|---|\n' + Object.entries(SLASH).map(([k, v]) => `| ${k} | ${v.label}${v.q ? '：' + v.q : ''} |`).join('\n') + '\n\n- 用 **@智能体名**（如 @规范校核、@估算概算）引用该智能体最新成果作为上下文；\n- 回答可点「插入到成果」追加到当前打开的成果中；\n- 助手按项目保存多轮记忆，「清空」仅清除当前项目对话。'; }
  function mentionContext(p, ids) { const L = ids.map(id => { const r = (p.runs || []).filter(x => x.agent === id).slice(-1)[0]; const a = (AW.AGENTS || []).find(x => x.id === id); return r ? `【@${a.name} 最新成果】\n${String(r.text).slice(0, 1500)}` : `【@${a.name}】尚无成果`; }); return L.join('\n\n'); }
  function suggestions(p) {
    const has = id => (p.runs || []).some(r => r.agent === id); const L = [];
    if (!(p.plan && p.plan.siteArea)) L.push('本项目还缺哪些规划条件？');
    L.push('/校核'); if (has('indicators')) L.push('容积率和绿地率是否满足规划条件？'); else L.push('/指标');
    L.push('/估算'); L.push(`${p.type || '本项目'}适用的日照标准？`);
    if ((p.records && p.records.review || []).some(x => x.status !== '已闭合')) L.push('未闭合的校审意见有哪些风险？');
    L.push('/汇报'); return [...new Set(L)].slice(0, 6);
  }
  /** 记忆：超过 N 轮时把较早的对话压缩为要点摘要（离线规则压缩，保留数值与结论） */
  function compressMemory(history, keep = 8, prev = '') {
    if (history.length <= keep) return { memory: prev, history };
    const old = history.slice(0, history.length - keep); const facts = [];
    old.forEach(m => { const s = String(m.content || '').replace(/[#*>|`-]+/g, ' ').replace(/\s+/g, ' ');
      if (m.role === 'user') facts.push('问：' + s.slice(0, 60)); else { const nums = s.match(/(容积率|绿地率|建筑密度|密度|限高|建筑高度|面积|造价|投资|单方|疏散距离|防火分区)[^，。；]{0,8}?\d[\d.,]*\s*(㎡|m|%|万元|元\/㎡|h)?|[^，。；\s]{0,10}\d[\d.,]*\s*(㎡|万元|元\/㎡|项|条)/g) || []; facts.push('答要点：' + (nums.slice(0, 4).join('；') || s.slice(0, 60))); } });
    const memory = (prev ? prev + '\n' : '') + facts.join('\n'); return { memory: memory.split('\n').slice(-24).join('\n'), history: history.slice(-keep) };
  }

  /* ================= 5. AI 自检（二次审查） ================= */
  const KNOWN_CODES = /GB\s?5\d{4}|GB\s?55\d{3}|JGJ\/?T?\s?\d+|CECA\/GC|GB\/T\s?\d+|DBJ|CJJ/;
  function selfCheck(text, agentId, p, input) {
    const issues = []; const add = (level, msg, basis) => issues.push({ level, msg, basis });
    const tx = String(text || '');
    if (/【模拟输出】|离线/.test(tx)) add('warn', '成果含离线模拟内容，专业结论需人工复核', '来源标识');
    (tx.match(/(GB|JGJ|CJJ)\s?[\w/.-]+\s?(\d+(\.\d+){1,3})/g) || []).forEach(c => { if (!KNOWN_CODES.test(c)) add('warn', `引用"${c}"不在常用规范库中，条文号待核`, '引用核查'); });
    if (/第\s?\d+\.\d+\.\d+\s?条/.test(tx) && !/待核/.test(tx) && agentId !== 'code') add('info', '含具体条文号，出图前请对照规范原文', '引用核查');
    if (p && p.area) { const m = tx.match(/总建筑面积[^0-9]{0,8}([\d,]+(?:\.\d+)?)\s*㎡/); if (m) { const v = num(m[1].replace(/,/g, '')); if (v && Math.abs(v - p.area) / p.area > 0.15 && agentId !== 'brief') add('err', `成果总建筑面积 ${fmt(v)} ㎡ 与项目 ${fmt(p.area)} ㎡ 偏差 ${(Math.abs(v - p.area) / p.area * 100).toFixed(0)}%`, '项目数据一致性'); } }
    if (p && p.plan && p.plan.height) { (tx.match(/建筑高度[^0-9]{0,6}([\d.]+)\s*m/g) || []).forEach(s => { const v = num(s.match(/([\d.]+)\s*m/)[1]); if (v > p.plan.height + 0.01) add('err', `建筑高度 ${v} m 超过规划限高 ${p.plan.height} m`, '规划条件'); }); }
    if (agentId === 'code' && input) { const c = AW.checkCompliance(input); c.rows.filter(r => !r.pass).forEach(r => add('err', `${r.item}不满足：${r.actual}，应 ${r.req}`, r.basis)); }
    if (agentId === 'indicators' && input) { const c = AW.calcIndicators(input); c.rows.filter(r => r[4] === false).forEach(r => add('err', `${r[0]} ${r[2]} 不满足（${r[3]}）`, 'GB 50352 / 规划条件')); }
    if (agentId === 'cost' && input) { const c = AW.estimateCost(input); if (c.perSqm > 15000 || c.perSqm < 1500) add('warn', `综合单方 ${fmt(c.perSqm)} 元/㎡ 超出常见区间，请核对单价库`, '经验区间'); }
    if (/待补充|待核|待定/.test(tx)) add('info', '成果中存在"待补充/待核"事项', '完整性');
    if (!/###/.test(tx) && tx.length > 200) add('info', '成果缺少分节结构', '成果格式');
    if (/(医院|学校|中小学|剧场|观众厅|幼儿园)/.test(tx + (p && p.type || '')) && !/专项|专篇|顾问/.test(tx) && agentId !== 'code') add('info', '人员密集或特殊类型建筑，建议增加消防专篇与专项审查提示', '类型风险');
    const pen = issues.reduce((s, x) => s + (x.level === 'err' ? 18 : x.level === 'warn' ? 8 : 3), 0);
    const confidence = Math.max(15, Math.min(98, 92 - pen));
    return { confidence, issues, level: confidence >= 80 ? 'high' : confidence >= 60 ? 'mid' : 'low', needHuman: issues.some(x => x.level !== 'info') };
  }
  function markPending(text, issues) { // 在成果末尾追加“待人工确认”清单（不改原文）
    const L = issues.filter(x => x.level !== 'info'); if (!L.length) return text;
    return String(text).replace(/\n+### AI 自检[\s\S]*$/, '') + '\n\n### AI 自检 · 待人工确认\n' + L.map((x, i) => `${i + 1}. 【待人工确认】${x.msg}（${x.basis}）`).join('\n');
  }
  async function reviewWithLLM(settings, text, agentId, p, input, opts = {}) {
    const base = selfCheck(text, agentId, p, input);
    if (!llmOn(settings)) return { ...base, source: 'rule' };
    try {
      const msgs = [{ role: 'system', content: '你是设计院审定人，对 AI 起草的成果做二次审查：对照现行国家规范与项目上下文，找出错误、遗漏、与项目数据矛盾、条文引用可疑之处。只输出 JSON：{"confidence":0-100,"issues":[{"level":"err|warn|info","msg":"不超过60字","basis":"规范或依据"}]}' },
        { role: 'user', content: AW.buildContext(p) + '\n\n【规则自检已发现】\n' + base.issues.map(x => '- ' + x.msg).join('\n') + '\n\n【待审成果】\n' + String(text).slice(0, 6000) }];
      const t = await AW.callLLM({ ...settings, maxTokens: 1200, temperature: 0.1 }, { messages: msgs, stream: false, agentId: 'review', fetchImpl: opts.fetchImpl });
      const s = String(t).replace(/```(json)?/g, ''); const j = JSON.parse(s.slice(s.indexOf('{'), s.lastIndexOf('}') + 1));
      const extra = (j.issues || []).filter(x => x && x.msg).map(x => ({ level: ['err', 'warn', 'info'].includes(x.level) ? x.level : 'warn', msg: String(x.msg), basis: String(x.basis || 'AI 审查'), ai: true }));
      const issues = [...base.issues, ...extra]; const confidence = Math.round(Math.min(base.confidence, num(j.confidence, base.confidence)));
      return { confidence, issues, level: confidence >= 80 ? 'high' : confidence >= 60 ? 'mid' : 'low', needHuman: issues.some(x => x.level !== 'info'), source: 'llm' };
    } catch (e) { return { ...base, source: 'rule', error: String(e.message || e) }; }
  }

  /* ================= 6. 选区内联改写 ================= */
  const INLINE = {
    polish: { label: '润色', icon: 'ri-quill-pen-line', p: '润色以下建筑设计文件片段：用语专业、规范、简洁，数值与规范编号保持不变。只输出改写结果。' },
    expand: { label: '扩写', icon: 'ri-expand-diagonal-line', p: '扩写以下片段：补充设计依据、技术措施与注意事项，保持数值不变，约扩至 2 倍。只输出改写结果。' },
    shorten: { label: '精简', icon: 'ri-contract-left-right-line', p: '精简以下片段至约一半篇幅，保留结论、数值和规范编号。只输出结果。' },
    formal: { label: '改为正式公文', icon: 'ri-government-line', p: '将以下内容改写为设计院正式函件/公文语体（"经研究…现函告如下：一、…"），只输出正文。' },
    table: { label: '生成表格', icon: 'ri-table-line', p: '将以下内容整理为 Markdown 表格（自动确定列），只输出表格。' }
  };
  const ORAL = [[/我们觉得|我觉得/g, '经分析认为'], [/大概|差不多/g, '约'], [/搞定|弄好/g, '完成'], [/马上/g, '尽快'], [/一下/g, ''], [/啥/g, '何'], [/很多/g, '较多'], [/，，+/g, '，'], [/\s+([，。；：])/g, '$1'], [/([^。；\n])$/, '$1。']];
  function inlineOffline(op, s) {
    const t = String(s || '').trim(); const sents = t.split(/(?<=[。；！？\n])/).map(x => x.trim()).filter(Boolean);
    if (op === 'polish') return ORAL.reduce((a, [re, r]) => a.replace(re, r), t);
    if (op === 'shorten') { const keep = sents.filter(x => /\d|GB|JGJ|应|不得|须|结论|建议/.test(x)); return (keep.length ? keep : sents).slice(0, Math.max(1, Math.ceil(sents.length / 2))).join(''); }
    if (op === 'expand') return t + (/。$/.test(t) ? '' : '。') + '\n\n设计依据：现行国家及地方规范、项目规划设计条件与设计任务书。技术措施：在后续深化中落实相关做法，并在图纸中明确标注。注意事项：涉及强制性条文的内容须经校对、审核、审定三级校审确认【待人工确认】。';
    if (op === 'formal') return `经研究，现就有关事项函告如下：\n\n${sents.map((x, i) => `${'一二三四五六七八九十'[i] || i + 1}、${x.replace(/^[-*\d.、\s]+/, '')}`).join('\n')}\n\n特此函告。`;
    if (op === 'table') { const rows = t.split('\n').map(x => x.replace(/^[-*\d.、\s]+/, '').trim()).filter(Boolean); const L = (rows.length > 1 ? rows : sents);
      const kv = L.every(x => /[：:]/.test(x)); return kv ? '| 项目 | 内容 |\n|---|---|\n' + L.map(x => { const [k, ...v] = x.split(/[：:]/); return `| ${k.trim()} | ${v.join('：').trim()} |`; }).join('\n') : '| 序号 | 内容 |\n|---|---|\n' + L.map((x, i) => `| ${i + 1} | ${x.replace(/\|/g, '/')} |`).join('\n'); }
    return t;
  }
  async function inlineEdit(op, text, settings, p, opts = {}) {
    const d = INLINE[op]; if (!d) throw new Error('未知操作');
    if (llmOn(settings)) { try { const t = await AW.callLLM({ ...settings, maxTokens: 1500 }, { messages: [{ role: 'system', content: AW.SYSTEM_PROMPT }, { role: 'user', content: (p ? AW.buildContext(p) + '\n\n' : '') + d.p + '\n\n【原文】\n' + text }], stream: !!opts.onDelta, onDelta: opts.onDelta, agentId: 'inline', fetchImpl: opts.fetchImpl }); if (t) return { text: String(t).trim(), source: 'llm' }; } catch (e) { return { text: inlineOffline(op, text), source: 'rule', error: String(e.message || e) }; } }
    return { text: inlineOffline(op, text), source: 'rule' };
  }

  /* ================= 8. 流水线重规划（校核不通过 → 调整参数重算） ================= */
  function replan(stepId, input, p) {
    const i = { ...input }; const ch = []; const ag = (AW.AGENTS || []).find(a => a.id === stepId); const lab = k => { const f = ag && ag.fields.find(x => x.key === k); return f ? f.label.replace(/（[^）]*）$/, '') : k; };
    const set = (k, v, why) => { if (String(i[k]) !== String(v)) { ch.push(`${lab(k)}：${i[k]} → ${v}（${why}）`); i[k] = v; } };
    if (stepId === 'indicators') { const c = AW.calcIndicators(i); const site = num(i.siteArea);
      if (c.far > num(i.farLimit)) set('aboveArea', Math.floor(site * num(i.farLimit) * 0.995), '计容面积压减至容积率上限内');
      if (c.density > num(i.densityLimit)) set('footprint', Math.floor(site * num(i.densityLimit) / 100 * 0.99), '基底面积压减至密度上限内');
      if (c.greenRate < num(i.greenLimit)) set('greenArea', Math.ceil(site * (num(i.greenLimit) + 0.5) / 100), '增补绿地至绿地率下限以上');
      if (num(i.height) > num(i.heightLimit)) set('height', +(num(i.heightLimit) - 0.1).toFixed(1), '降低层高/层数满足限高');
      const c2 = AW.calcIndicators(i); if (c2.car < c2.carReq) set('carBelow', num(i.carBelow) + (c2.carReq - c2.car), '地下车库增配车位');
      if (num(i.bikeProvided) < c2.bikeReq) set('bikeProvided', c2.bikeReq, '增配非机动车位'); }
    if (stepId === 'code') { const c = AW.checkCompliance(i);
      c.rows.filter(r => !r.pass).forEach(r => {
        if (/防火分区最大/.test(r.item)) set('compArea', +String(r.req).match(/[\d.]+/)[0], '增设防火分区/防火卷帘分隔');
        else if (/地下室防火分区/.test(r.item)) set('basementComp', +String(r.req).match(/[\d.]+/)[0], '地下室增设防火分区');
        else if (/两个安全出口之间/.test(r.item)) set('evacDist', Math.floor(+String(r.req).match(/[\d.]+/)[0]) - 1, '增设疏散楼梯，缩短疏散距离');
        else if (/袋形/.test(r.item)) set('deadEnd', Math.floor(+String(r.req).match(/[\d.]+/)[0]) - 1, '调整袋形走道长度');
        else if (/安全出口数量/.test(r.item)) set('exits', 2, '每个防火分区增设至 2 个安全出口');
        else if (/栏杆/.test(r.item)) set('railHeight', num(i.height) >= 24 ? 1.1 : 1.05, '提高临空栏杆高度');
        else if (/坡道/.test(r.item)) set('ramp', 12, '放缓坡道至 1:12');
        else if (/净高/.test(r.item)) set('clearHeight', 2.2, '调整吊顶标高');
        else if (/踏步/.test(r.item)) set('riser', 0.16, '调整踏步高度');
        else if (/消防车道/.test(r.item)) set('fireLane', '是', '总图增设环形消防车道');
        else if (/登高/.test(r.item)) set('rescueSite', '是', '增设消防车登高操作场地');
        else if (/无障碍出入口/.test(r.item)) set('accessEntry', '是', '主要出入口改为无障碍出入口');
        else if (/日照标准/.test(r.item)) set('sunHours', +String(r.req).match(/([\d.]+)\s*h/)[1], '调整布局/朝向满足日照（须日照分析复核）');
        else if (/日照间距/.test(r.item)) set('spacing', Math.ceil(+String(r.req).match(/= ([\d.]+)/)[1]), '加大与南侧建筑间距');
        else if (/耐火等级/.test(r.item)) set('fireRating', '一级', '提高耐火等级');
      }); }
    return { input: i, changes: ch };
  }
  const failCountOf = (stepId, input) => stepId === 'indicators' ? AW.calcIndicators(input).failCount : stepId === 'code' ? AW.checkCompliance(input).failCount : 0;

  return { PROVIDERS, providerOf, parseChain, candidates, callWithFallback, chatTools, chatOnce, bindUsage, setUsageHook, record, estTokens, get usage() { return USAGE; },
    tokenize, chunk, buildKB, searchKB, citeBlock, NORM_SNIPPETS, TOOLS, toolSpec, execTool, planOffline, summarizeTool, runToolAgent, AGENT_SYS,
    SLASH, parseCommand, helpText, mentionContext, suggestions, compressMemory, selfCheck, markPending, reviewWithLLM, INLINE, inlineOffline, inlineEdit, replan, failCountOf };
});
