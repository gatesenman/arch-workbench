/* AI 主导引擎：AI 自动填写 / 草拟记录 / 调用规则工具校验 / 全流程自动推进 / 对话助手
 * 设计原则：AI 负责起草与推进，规则引擎作为"校验工具"被 AI 调用并在成果中引用；人工在检查点确认、修改、签字。 */
(function (root, factory) { const m = factory(root.AW || (typeof require !== 'undefined' ? require('./agents.js') : null)); if (typeof module === 'object' && module.exports) module.exports = m; else root.PILOT = m; })(typeof self !== 'undefined' ? self : globalThis, function (AW) {
  const A = id => AW.AGENTS.find(a => a.id === id);
  const llmOn = s => !!(s && s.mode === 'llm' && s.apiKey);
  const num = v => (v === '' || v == null || !isFinite(+v)) ? null : +v;
  const r1 = v => Math.round(v * 10) / 10;

  /* ---------- 流水线定义（方案 → 施工图 → 图审 → 施工配合 → 竣工） ---------- */
  const PIPELINE = [
    { id: 'brief', name: '任务书分析', stage: '前期策划', key: false },
    { id: 'site', name: '规划条件与场地分析', stage: '前期策划', key: true },
    { id: 'concept', name: '概念方案与体量试算', stage: '方案设计', key: false },
    { id: 'indicators', name: '经济技术指标核算', stage: '方案设计', key: true, tool: 'calcIndicators' },
    { id: 'cost', name: '投资估算', stage: '方案设计', key: false, tool: 'estimateCost' },
    { id: 'code', name: '规范符合性校核', stage: '初步设计', key: true, tool: 'checkCompliance' },
    { id: 'review', name: '三级校审（AI 预审）', stage: '施工图设计', key: true, records: ['review'], tool: 'recordNo' },
    { id: 'drawings', name: '图纸目录编制', stage: '施工图设计', key: false, records: ['drawings'], tool: 'drawingCheck' },
    { id: 'plancheck', name: '施工图审查意见回复', stage: '施工图审查', key: true },
    { id: 'construction', name: '施工配合（变更 / 现场服务）', stage: '施工配合', key: false, records: ['change', 'service'], tool: 'recordNo' },
    { id: 'completion', name: '竣工验收', stage: '竣工验收', key: true }
  ];

  /* ---------- 前序成果摘要（喂给后续阶段） ---------- */
  function digest(p, uptoId) {
    if (!p) return '';
    const order = PIPELINE.map(s => s.id); const lim = uptoId ? order.indexOf(uptoId) : order.length;
    const latest = {}; (p.runs || []).forEach(r => { latest[r.agent] = r; });
    const L = order.slice(0, lim < 0 ? order.length : lim).map(id => latest[id]).filter(Boolean)
      .map(r => `◆ ${A(r.agent) ? A(r.agent).name : r.agent}${r.approved ? `（已由 ${r.approved.by} 确认）` : '（未确认）'}：${String(r.text).replace(/\s+/g, ' ').slice(0, 500)}`);
    return L.length ? '【前序阶段成果摘要】\n' + L.join('\n') : '';
  }
  function ctx(p, uptoId) { return AW.buildContext(p) + (digest(p, uptoId) ? '\n\n' + digest(p, uptoId) : ''); }

  function parseJSON(t) { const s = String(t || '').replace(/```(json)?/g, ''); const i = s.indexOf('{'), j = s.lastIndexOf('}'); if (i < 0 || j < i) throw new Error('模型未返回 JSON'); return JSON.parse(s.slice(i, j + 1)); }
  async function callJSON(settings, messages, opts = {}) {
    const t = await AW.callLLM({ ...settings, maxTokens: opts.maxTokens || 2500, temperature: 0.2 }, { messages, stream: opts.stream !== false && settings.stream !== false, onDelta: opts.onDelta, signal: opts.signal, fetchImpl: opts.fetchImpl });
    return parseJSON(t);
  }

  /* ---------- 规则型启发式填写（离线 / AI 失败时） ---------- */
  function heuristicFill(agent, p) {
    const v = {}; const pl = (p && p.plan) || {}; const area = +(p && p.area) || 0;
    const site = pl.siteArea || (area ? Math.round(area / 1.2 / 100) * 100 : null);
    const far = pl.far || 1.2, den = pl.density || 30, grn = pl.green || 35, hl = pl.height || 24;
    const above = area ? Math.round(Math.min(area * 0.84, site * far * 0.98)) : null, below = area && above ? Math.max(0, area - above) : null;
    const put = (k, x) => { if (x != null && agent.fields.some(f => f.key === k)) v[k] = x; };
    put('siteArea', site); put('far', far); put('density', den); put('green', grn); put('height', hl);
    put('farLimit', far); put('densityLimit', den); put('greenLimit', grn); put('heightLimit', hl);
    put('gfa', above); put('aboveArea', above); put('belowArea', below);
    if (site) { put('footprint', Math.round(site * den * 0.9 / 100)); put('greenArea', Math.round(site * (grn + 1.5) / 100)); }
    put('height', agent.id === 'site' ? hl : r1(Math.min(hl - 0.1, 23.9)));
    if (p && p.type) put('type', p.type); if (p && p.location) put('location', p.location);
    const fill = {}; Object.entries(v).forEach(([k, x]) => { const f = agent.fields.find(f => f.key === k); if (f.type === 'select' && !f.options.includes(x)) return; fill[k] = String(x); });
    return fill;
  }

  /* ---------- AI 自动填写表单 ---------- */
  async function aiFill(agent, p, settings, opts = {}) {
    const base = heuristicFill(agent, p);
    if (!llmOn(settings)) return { values: base, source: 'rule', reason: '离线模式：依据项目规划条件与面积按规则推算' };
    const spec = agent.fields.map(f => `- ${f.key}（${f.label}${f.type === 'select' ? '，只能取：' + f.options.join('/') : f.type === 'number' ? '，数值' : ''}）当前：${String(opts.current ? opts.current[f.key] : '').slice(0, 80)}`).join('\n');
    const msgs = [{ role: 'system', content: AW.SYSTEM_PROMPT + '\n你现在作为"AI 项目主导"，负责根据项目上下文和前序阶段成果，为下一项工作起草输入参数。只输出 JSON。' },
      { role: 'user', content: `${ctx(p, agent.id)}\n\n【任务】为"${agent.name}"填写输入参数。数值须与规划条件、前序成果一致（例如总建筑面积、计容面积、限高）。文本类字段请写成可直接使用的专业内容（中文）。${opts.feedback ? '\n【人工退回意见】' + opts.feedback : ''}\n【字段】\n${spec}\n\n返回 JSON：{"values":{字段键:值,...},"reason":"不超过 80 字的填写依据"}` }];
    try {
      const j = await callJSON(settings, msgs, opts); const out = { ...base };
      Object.entries(j.values || {}).forEach(([k, x]) => { const f = agent.fields.find(f => f.key === k); if (!f || x == null) return;
        if (f.type === 'number') { if (num(x) != null) out[k] = String(num(x)); } else if (f.type === 'select') { if (f.options.includes(String(x))) out[k] = String(x); } else out[k] = String(x); });
      return { values: out, source: 'llm', reason: j.reason || '' };
    } catch (e) { return { values: base, source: 'rule', reason: '规则推算（AI 填写失败：' + (e.message || e) + '）', error: String(e.message || e) }; }
  }

  /* ---------- 记录类：AI 草拟（校审意见 / 图纸目录 / 变更核定 / 现场服务） ---------- */
  const MOCK_REC = {
    review: () => [{ level: '校对', discipline: '建筑', sheet: '建施-03', category: '强制性条文', opinion: '首层门厅疏散门开启方向应朝向疏散方向，请复核。', reply: '' }, { level: '审核', discipline: '建筑', sheet: '建施-12', category: '一般性条文', opinion: '楼梯间节点详图栏杆高度标注缺失，补充 1.10 m。', reply: '' }, { level: '审定', discipline: '结构', sheet: '结施-02', category: '建议', opinion: '风雨操场大跨屋盖建议补充舒适度验算说明。', reply: '' }],
    drawings: () => [['建筑', '建筑设计总说明'], ['建筑', '总平面图'], ['建筑', '一层平面图'], ['建筑', '二层平面图'], ['建筑', '屋顶平面图'], ['建筑', '立面图'], ['建筑', '剖面图'], ['建筑', '楼梯详图'], ['结构', '结构设计总说明'], ['给排水', '给排水设计说明'], ['暖通', '暖通设计说明'], ['电气', '电气设计说明']].map(([d, t]) => ({ discipline: d, title: t })),
    change: () => [{ form: '技术核定单', discipline: '建筑', sheet: '建施-05', content: '因结构梁高调整，三层走廊吊顶标高由 2.900 m 调整为 2.800 m，净高仍满足要求。', reason: '施工单位建议', costImpact: '无', amount: '0' }],
    service: () => [{ type: '设计交底', issue: '施工单位对屋面防水构造做法存疑，现场解释并以图纸会审纪要明确。', handle: '已在会审纪要中明确', status: '已闭合' }]
  };
  async function aiRecords(kind, p, settings, opts = {}) {
    const ag = AW.AGENTS.find(a => a.kind === kind); const cols = ag.columns.filter(c => !c.auto && !c.readonly);
    let rows, source = 'rule', reason = '离线模式：按项目类型套用典型模板', error;
    if (llmOn(settings)) {
      const spec = cols.map(c => `${c.key}（${c.label}${c.options ? '：' + c.options.join('/') : ''}）`).join('；');
      const want = { review: '6~10 条三级校审意见（覆盖校对/审核/审定，含至少 1 条强制性条文），针对本项目具体图纸', drawings: '一套施工图图纸目录（建筑约 15~25 张，并含结构/给排水/暖通/电气说明及主要图纸），图名按国内惯例', change: '施工阶段 2~4 份设计变更单/技术核定单，内容具体、写明原因与造价影响', service: '3~5 次现场服务记录（设计交底、图纸会审、现场巡查、隐蔽验收配合等）' }[kind];
      try { const j = await callJSON(settings, [{ role: 'system', content: AW.SYSTEM_PROMPT + '\n只输出 JSON。' }, { role: 'user', content: `${ctx(p)}\n\n【任务】根据项目上下文与前序成果，草拟${want}。不要编号（编号由系统规则自动生成）。\n字段：${spec}\n返回 JSON：{"records":[{...}],"reason":"不超过 80 字"}` }], { ...opts, maxTokens: 4000 });
        rows = (j.records || []).filter(x => x && typeof x === 'object'); if (!rows.length) throw new Error('模型未返回记录'); source = 'llm'; reason = j.reason || '';
      } catch (e) { error = String(e.message || e); reason = '模板草拟（AI 失败：' + error + '）'; }
    }
    rows = rows || MOCK_REC[kind]();
    const list = (p.records[kind] ||= []); const made = [];
    rows.forEach(x => { const v = {}; ag.columns.forEach(c => { let val = x[c.key]; if (c.options && !c.options.includes(val)) val = c.default != null && c.options.includes(c.default) ? c.default : c.options[0]; v[c.key] = val == null ? (c.type === 'date' ? new Date().toISOString().slice(0, 10) : c.default ?? '') : String(val); });
      if (x.status && ag.columns.find(c => c.key === 'status').options.includes(x.status)) v.status = x.status;
      v.id = Math.random().toString(36).slice(2, 10); v.ai = true; v.no = kind === 'drawings' ? AW.drawingNo(v.discipline, list) : AW.recordNo(kind, v, list); if (kind === 'drawings') v.version = '第1版'; list.push(v); made.push(v); });
    return { records: made, source, reason, error, verify: verifyRecords(kind, list) };
  }
  /* 规则工具：校验并生成可引用的结论 */
  function verifyRecords(kind, list) {
    if (kind === 'drawings') { const k = AW.drawingCheck(list); return `规则工具 drawingCheck：共 ${k.count} 张，折合 A1 ${k.a1.toFixed(2)} 张；${k.missingDisc.length ? '缺少专业 ' + k.missingDisc.join('、') : '专业齐全'}；${k.missingArch.length ? '建施缺少 ' + k.missingArch.join('、') : '建施必备图纸齐全'}`; }
    if (kind === 'review') { const s = list.filter(x => x.category === '强制性条文' && x.status !== '已闭合').length; return `规则工具 校审闭合检查：意见 ${list.length} 条，未闭合 ${list.filter(x => x.status !== '已闭合').length} 条，其中强制性条文 ${s} 条${s ? '——未闭合前不得出图' : ''}`; }
    return `规则工具 recordNo：已按"${kind === 'change' ? 'SJBG/JSHD-专业-流水号' : 'XCFW-年月-流水号'}"规则编号，共 ${list.length} 份，未闭合 ${list.filter(x => x.status && !/已闭合|已签发|已实施/.test(x.status)).length} 份`;
  }

  /* ---------- 执行流水线中的一步 ---------- */
  async function runStep(step, p, settings, hooks = {}) {
    const t0 = Date.now(); const res = { step: step.id, fills: null, text: '', source: 'mock', notes: [] };
    if (step.records) {
      const parts = [];
      for (const kind of step.records) { hooks.onPhase && hooks.onPhase(`AI 草拟${{ review: '校审意见', drawings: '图纸目录', change: '变更/核定单', service: '现场服务记录' }[kind]}…`);
        const r = await aiRecords(kind, p, settings, hooks); const ag = AW.AGENTS.find(a => a.kind === kind);
        parts.push(ag.summary(p.records[kind], p) + `\n\n> AI 草拟 ${r.records.length} 条（${r.source === 'llm' ? 'AI 生成' : '模板'}）：${r.reason}\n> ${r.verify}`); res.source = r.source === 'llm' ? 'llm' : (res.source === 'llm' ? 'llm' : 'mock'); if (r.error) res.error = r.error; res.created = (res.created || 0) + r.records.length; }
      res.text = parts.join('\n\n---\n\n');
    } else {
      const ag = A(step.id); hooks.onPhase && hooks.onPhase('AI 根据前序成果填写输入…');
      const f = await aiFill(ag, p, settings, { ...hooks, onDelta: null, stream: false }); res.fills = f; let input = { ...defaultsOf(ag), ...f.values, ...(hooks.override || {}) };
      const AI = (typeof self !== 'undefined' && self.AW_AI) || (typeof require !== 'undefined' ? require('./ai.js') : null);
      if (AI && (step.id === 'indicators' || step.id === 'code') && !(settings && settings.replan === false)) {
        const log = []; let fc = AI.failCountOf(step.id, input);
        for (let round = 1; fc > 0 && round <= 3; round++) { hooks.onPhase && hooks.onPhase(`规则工具校核不通过 ${fc} 项，AI 重规划第 ${round} 轮…`);
          const rp = AI.replan(step.id, input, p); if (!rp.changes.length) break; const nf = AI.failCountOf(step.id, rp.input);
          log.push({ round, before: fc, after: nf, changes: rp.changes }); input = rp.input; fc = nf; }
        if (log.length) { res.replan = log; hooks.onReplan && hooks.onReplan(log); }
      }
      hooks.onPhase && hooks.onPhase(ag.deterministic ? '调用规则工具计算，AI 撰写说明…' : 'AI 生成成果…');
      const r = await AW.runAgent(ag, input, p, { ...settings, aiNotes: true }, hooks.fetchImpl, { stream: settings && settings.stream !== false, onDelta: hooks.onDelta, signal: hooks.signal });
      res.input = input; res.text = r.text + (ag.deterministic ? `\n\n> 规则工具 ${step.tool} 已执行，上表数据由本地规则引擎计算，AI 说明引用了该结果。` : '')
      if (res.replan) res.text += '\n\n### AI 重规划记录（校核不通过 → 调整设计参数 → 重新校核）\n| 轮次 | 调整前不满足 | 调整后不满足 | 调整内容 |\n|---|---|---|---|\n' + res.replan.map(x => `| 第 ${x.round} 轮 | ${x.before} 项 | ${x.after} 项 | ${x.changes.join('；')} |`).join('\n') + '\n\n> 以上调整为 AI 重规划建议，须由项目负责人确认并落实到图纸【待人工确认】'; res.source = r.source; if (r.error || f.error) res.error = r.error || f.error;
      if (ag.savesPlan) p.plan = { siteArea: +input.siteArea, far: +input.far, density: +input.density, green: +input.green, height: +input.height };
    }
    const i = PIPELINE.indexOf(step); const nx = PIPELINE[i + 1];
    if (!/下一步/.test(res.text.slice(-600))) res.text += `\n\n### 下一步建议\n- ${nx ? `进入"${nx.name}"（${nx.stage}），${nx.key ? '该步为关键节点，需项目负责人确认签字' : 'AI 将自动起草'}` : '全流程完成：整理归档，提交竣工验收资料'}`;
    res.elapsed = r1((Date.now() - t0) / 1000); return res;
  }
  function defaultsOf(a) { return Object.fromEntries(a.fields.map(f => [f.key, f.default ?? (f.options ? f.options[0] : '')])); }

  /* ---------- 对话助手 ---------- */
  function chatMessages(p, history, q) { return [{ role: 'system', content: AW.SYSTEM_PROMPT + '\n你是本工作台的 AI 项目助手，回答简明，可建议下一步操作（例如运行哪个智能体、需人工确认的事项）。' }, { role: 'user', content: ctx(p) + '\n（以上为当前项目上下文）' }, { role: 'assistant', content: '已了解项目上下文。' }, ...history.slice(-10), { role: 'user', content: q }]; }
  function mockChat(p, q) { const pl = p.plan || {}; const st = (p.pipeline && p.pipeline.steps || []).find(s => s.status !== 'approved');
    return `【模拟回复】当前为离线模式，未调用真实 AI 模型。\n\n- 项目：${p.name}（${p.stage}）\n- 规划条件：${pl.siteArea ? `用地 ${pl.siteArea} ㎡，容积率 ≤ ${pl.far}，限高 ${pl.height} m` : '尚未录入'}\n- 建议下一步：${st ? `在"AI 自动推进"中处理"${(PIPELINE.find(x => x.id === st.id) || {}).name}"` : '打开"AI 自动推进"启动全流程'}\n\n您的问题：${q}`; }

  return { PIPELINE, digest, ctx, parseJSON, heuristicFill, aiFill, aiRecords, verifyRecords, runStep, chatMessages, mockChat, defaultsOf };
});
