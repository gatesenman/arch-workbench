/* 建筑师专属工作台 - 智能体定义与业务规则（浏览器 / Node 通用）
 * 规则与数据为方案阶段辅助用示意实现，正式成果以现行国家、地方规范及主管部门要求为准。 */
(function (root) {
  const num = (v, d = 0) => { const n = parseFloat(v); return isFinite(n) ? n : d; };
  const fmt = (n, d = 0) => Number(n).toLocaleString('zh-CN', { minimumFractionDigits: d, maximumFractionDigits: d });
  const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  const pname = p => (p && p.name) || '本工程';

  const STAGES = ['方案设计', '初步设计', '施工图设计', '施工配合', '竣工'];
  const BUILD_TYPES = ['住宅', '办公', '商业', '酒店', '中小学校', '医院', '文化场馆', '工业厂房'];
  const CLIMATES = ['Ⅰ 严寒地区', 'Ⅱ 寒冷地区', 'Ⅲ 夏热冬冷地区', 'Ⅳ 夏热冬暖地区', 'Ⅴ 温和地区'];
  /* 地上建安单方基准（元/㎡，示意，二线城市标准型） */
  const COST_BASE = { '住宅': 3300, '办公': 4300, '商业': 4800, '酒店': 6500, '中小学校': 3900, '医院': 6800, '文化场馆': 7200, '工业厂房': 2500 };
  let UNDERGROUND_BASE = 5200;
  const REGION_FACTOR = { '一线城市': 1.25, '新一线城市': 1.1, '二线城市': 1.0, '三四线城市': 0.88 };
  const GRADE_FACTOR = { '经济型': 0.85, '标准型': 1.0, '品质型': 1.25, '高端型': 1.6 };

  /* ---------------- 日照（GB 50180-2018 表 4.0.9，住宅） ---------------- */
  function sunlightStandard(climate, citySize) {
    const c = String(climate || '').charAt(0); const big = citySize !== '中小城市';
    if ('ⅠⅡⅢ'.includes(c)) return big ? { day: '大寒日', hours: 2 } : { day: '大寒日', hours: 3 };
    if (c === 'Ⅳ') return big ? { day: '大寒日', hours: 3 } : { day: '冬至日', hours: 1 };
    return { day: '冬至日', hours: 1 };
  }

  /* ---------------- 规划条件 / 场地 ---------------- */
  function siteCapacity(i) {
    const W = num(i.siteWidth), D = num(i.siteDepth), site = num(i.siteArea) || W * D;
    const bw = Math.max(W - num(i.setbackE) - num(i.setbackW), 0), bd = Math.max(D - num(i.setbackN) - num(i.setbackS), 0);
    const buildable = bw * bd;
    const maxGfa = site * num(i.far);
    const maxFootprint = Math.min(site * num(i.density) / 100, buildable);
    const minGreen = site * num(i.green) / 100;
    return { site, bw, bd, buildable, maxGfa, maxFootprint, minGreen, sun: sunlightStandard(i.climate, i.citySize), spacing: num(i.sunCoef) * num(i.height) };
  }

  /* ---------------- 体量试算 ---------------- */
  function massingOptions(i) {
    const site = num(i.siteArea), gfa = Math.min(num(i.gfa), site * num(i.far)), fh = num(i.floorHeight, 4.2);
    const maxFloors = Math.max(Math.floor((num(i.height) - 0.6) / fh), 1); // 扣除室内外高差约 0.6m（示意）
    const lim = num(i.density) / 100;
    return [['点式塔楼', 0.22], ['板式条楼', 0.32], ['围合院落', Math.min(lim, 0.42)]].map(([name, r]) => {
      const fp = Math.round(site * Math.min(r, lim)); const floors = Math.ceil(gfa / Math.max(fp, 1));
      return { name, footprint: fp, floors, density: fp / site * 100, far: gfa / site, height: +(floors * fh + 0.6).toFixed(1), ok: floors <= maxFloors };
    }).concat([{ maxFloors, gfa }]);
  }

  /* ---------------- 经济技术指标核算 ---------------- */
  function calcIndicators(i) {
    const site = num(i.siteArea), above = num(i.aboveArea), below = num(i.belowArea), foot = num(i.footprint), green = num(i.greenArea);
    const far = site ? above / site : 0, density = site ? foot / site * 100 : 0, greenRate = site ? green / site * 100 : 0;
    const carReq = Math.ceil(above / 100 * num(i.carRate)), bikeReq = Math.ceil(above / 100 * num(i.bikeRate));
    const car = num(i.carAbove) + num(i.carBelow);
    const rows = [
      ['规划总用地面积', '㎡', fmt(site, 2), '-', '-'],
      ['总建筑面积', '㎡', fmt(above + below, 2), '-', '-'],
      ['　其中：地上建筑面积（计容）', '㎡', fmt(above, 2), '-', '-'],
      ['　　　　地下建筑面积（不计容）', '㎡', fmt(below, 2), '-', '-'],
      ['容积率', '-', far.toFixed(2), '≤ ' + num(i.farLimit), far <= num(i.farLimit)],
      ['建筑基底面积', '㎡', fmt(foot, 2), '-', '-'],
      ['建筑密度', '%', density.toFixed(2), '≤ ' + num(i.densityLimit), density <= num(i.densityLimit)],
      ['绿地面积', '㎡', fmt(green, 2), '-', '-'],
      ['绿地率', '%', greenRate.toFixed(2), '≥ ' + num(i.greenLimit), greenRate >= num(i.greenLimit)],
      ['建筑高度', 'm', num(i.height).toFixed(2), '≤ ' + num(i.heightLimit), num(i.height) <= num(i.heightLimit)],
      ['建筑层数', '层', `地上 ${num(i.floorsAbove)} / 地下 ${num(i.floorsBelow)}`, '-', '-'],
      ['机动车停车位', '辆', `${car}（地上 ${num(i.carAbove)}，地下 ${num(i.carBelow)}）`, '≥ ' + carReq, car >= carReq],
      ['非机动车停车位', '辆', String(num(i.bikeProvided)), '≥ ' + bikeReq, num(i.bikeProvided) >= bikeReq],
      ['平均层数（地上面积/基底）', '层', foot ? (above / foot).toFixed(2) : '-', '-', '-'],
      ['空地率（1-密度）', '%', site ? ((site - foot) / site * 100).toFixed(2) : '-', '-', '-'],
      ['地下建筑面积占比', '%', (above + below) ? (below / (above + below) * 100).toFixed(2) : '-', '-', '-'],
      ['百平方米停车位', '辆/100㎡', above ? (car / above * 100).toFixed(2) : '-', '≥ ' + num(i.carRate), '-']
    ];
    return { far, density, greenRate, carReq, bikeReq, car, rows, failCount: rows.filter(r => r[4] === false).length };
  }


  /* ---------------- GB 50016-2014(2018) 分类型防火分区 / 疏散距离 ---------------- */
  const TYPE_EVAC = { // 表 5.5.17：[单多层·两出口间, 单多层·袋形, 高层·两出口间, 高层·袋形]
    '托儿所幼儿园': [25, 20, null, null], '医院': [35, 20, 24, 12], '中小学校': [35, 22, 30, 15], '酒店': [40, 22, 30, 15],
    '文化场馆': [40, 22, 30, 15], '商业': [40, 22, 40, 20], '办公': [40, 22, 40, 20], '住宅': [40, 22, 40, 20], '工业厂房': [null, null, null, null] };
  const NOTE_EVAC = { '医院': '高层病房部分取 24/12 m，其他部分取 30/15 m', '酒店': '高层旅馆、展览建筑', '文化场馆': '高层展览建筑按 30/15 m', '中小学校': '教学建筑', '托儿所幼儿园': '托儿所、幼儿园、老年人照料设施' };
  function evacLimit(type, high, sprinkler) {
    const t = TYPE_EVAC[type] || TYPE_EVAC['办公']; const k = sprinkler === '是' ? 1.25 : 1;
    let between = high ? t[2] : t[0], dead = high ? t[3] : t[1];
    if (between == null) { between = 40; dead = 22; }
    return { between: +(between * k).toFixed(2), dead: +(dead * k).toFixed(2), base: [between, dead], note: NOTE_EVAC[type] || '其他建筑', basis: type === '住宅' ? 'GB 50016 5.5.29' : 'GB 50016 表 5.5.17' };
  }
  function compartmentLimit(o) { // GB 50016 5.3.1 / 5.3.4
    const sp = o.sprinkler === '是';
    if (o.underground) return { limit: sp ? 1000 : 500, basis: 'GB 50016 5.3.1（地下或半地下）', note: '地下设备用房不应大于 1000 ㎡' };
    if ((o.type === '商业' || o.type === '文化场馆') && sp && o.hall === '是') {
      if (o.high) return { limit: 4000, basis: 'GB 50016 5.3.4', note: '高层建筑内营业厅、展览厅（设自动灭火、火灾报警、不燃难燃装修）' };
      return { limit: o.singleOrFirst === '是' ? 10000 : 5000, basis: 'GB 50016 5.3.4', note: '单多层营业厅、展览厅' + (o.singleOrFirst === '是' ? '（设于单层建筑或首层）' : '') };
    }
    const base = o.high ? 1500 : 2500;
    return { limit: base * (sp ? 2 : 1), basis: 'GB 50016 5.3.1', note: (o.high ? '高层民用建筑' : '单、多层民用建筑') + (sp ? '，设自动灭火系统增加 1.0 倍' : '') };
  }
  /* 分类型日照（GB 50180 / GB 50099 / GB 51039 / GB 50867 / JGJ 39） */
  function sunlightByType(type, climate, citySize) {
    if (type === '住宅') { const s = sunlightStandard(climate, citySize); return { ...s, basis: 'GB 50180-2018 4.0.9（每套至少一个居住空间）', room: '住宅' }; }
    if (type === '中小学校') return { day: '冬至日', hours: 2, basis: 'GB 50099-2011 4.3.3', room: '普通教室' };
    if (type === '医院') return { day: '冬至日', hours: 2, basis: 'GB 51039-2014 / 地方规定', room: '半数以上病房' };
    if (type === '托儿所幼儿园') return { day: '冬至日', hours: 3, basis: 'JGJ 39-2016 3.2.8', room: '生活用房' };
    return null;
  }
  /* GB 50352-2019 附录 A 常用指标派生 */
  function derivedIndicators(i) {
    const site = num(i.siteArea), above = num(i.aboveArea), below = num(i.belowArea), foot = num(i.footprint), fl = Math.max(num(i.floorsAbove), 1);
    return { total: above + below, avgFloors: foot ? above / foot : 0, openSpace: site ? (site - foot) / site * 100 : 0, belowRatio: (above + below) ? below / (above + below) * 100 : 0, carPer100: above ? (num(i.carAbove) + num(i.carBelow)) / above * 100 : 0, fl };
  }
  /* 可编辑单方造价库 */
  const PRICE_DEFAULTS = { ...COST_BASE, '地下室': 5200 };
  function setPrices(pr) { if (!pr) return; Object.keys(COST_BASE).forEach(k => { if (isFinite(+pr[k]) && +pr[k] > 0) COST_BASE[k] = +pr[k]; }); if (isFinite(+pr['地下室']) && +pr['地下室'] > 0) UNDERGROUND_BASE = +pr['地下室']; }
  function resetPrices() { setPrices(PRICE_DEFAULTS); }


  /* ---------------- 项目化专业提示（离线引擎，结合项目数据） ---------------- */
  const TYPE_KNOW = {
    '中小学校': { codes: 'GB 50099-2011《中小学校设计规范》、GB 55031、GB 50016、GB 50763', pts: ['普通教室冬至日满窗日照 ≥ 2 h，两排教室长边相对时间距 ≥ 25 m，教室长边与运动场地间距 ≥ 25 m（GB 50099 4.3.3 / 4.3.7）', '教学用房临空窗台高度 ≥ 0.90 m，上人屋面/外廊栏杆高度 ≥ 1.10 m', '教学用建筑疏散走道宽度按每百人 0.70 m（一、二层）至 1.00 m 递增计算', '普通教室净高：小学 ≥ 3.00 m，初中 ≥ 3.05 m，高中 ≥ 3.10 m（GB 50099 7.2.1）', '主要教学用房不应设在地下室、半地下室'], unit: '班', kpi: a => `按生均建筑面积约 ${a ? fmt(a / 2400, 1) : '—'} ㎡/生（以 48 班 2400 人估）` },
    '医院': { codes: 'GB 51039-2014《综合医院建筑设计规范》、GB 50016、GB 50849', pts: ['门急诊、医技、住院三区分区明确，洁污、医患、人车分流', '半数以上病房冬至日日照 ≥ 2 h', '高层病房楼疏散距离按 24/12 m 控制，避难间每层设置', '手术部、ICU 按洁净用房标准设计，层高宜 ≥ 4.5 m'], unit: '床', kpi: a => `按床均建筑面积 ${a ? fmt(a / 110, 0) : '—'}（以 110 ㎡/床反推床位数）` },
    '文化场馆': { codes: 'JGJ/T 41《文化馆建筑设计规范》、JGJ 38《图书馆建筑设计规范》、JGJ 57《剧场建筑设计规范》、GB 50016', pts: ['观众厅、多功能厅属人员密集场所，安全出口 ≥ 2 个且疏散门不应设门槛', '展厅防火分区在设自动灭火及报警后，单多层可按 5000 ㎡（首层 10000 ㎡）', '图书馆书库楼面荷载与防火分区需单独核定（JGJ 38）', '剧场舞台与观众厅间设防火幕或防火分隔'], unit: '座', kpi: a => `总建筑面积 ${fmt(a)} ㎡` },
    '办公': { codes: 'JGJ/T 67-2019《办公建筑设计标准》、GB 50016、GB 55031', pts: ['办公室净高 ≥ 2.70 m（JGJ/T 67 4.1.11）', '5 层及以上办公应设电梯，超高层设避难层', '标准层得房率宜 ≥ 75%，核心筒宜集中布置'], unit: '人', kpi: a => `按人均 10 ㎡ 约可容纳 ${fmt(a / 10)} 人` },
    '商业': { codes: 'JGJ 48-2014《商店建筑设计规范》、GB 50016', pts: ['营业厅疏散人数按面积折算系数计算（GB 50016 5.5.21）', '营业厅防火分区可按 5.3.4 放宽，需同时设自动灭火、火灾报警', '大型商店设货物装卸区与顾客流线分离'], unit: '㎡', kpi: a => `总建筑面积 ${fmt(a)} ㎡` },
    '酒店': { codes: 'JGJ 62-2014《旅馆建筑设计规范》、GB 50016', pts: ['客房净面积与卫生间配置按星级标准', '高层旅馆疏散距离按 30/15 m', '后勤流线与客人流线严格分离'], unit: '间', kpi: a => `按 80 ㎡/间约 ${fmt(a / 80)} 间客房` },
    '住宅': { codes: 'GB 55038-2025《住宅项目规范》、GB 50096、GB 50180、GB 50016', pts: ['每套住宅至少一个居住空间满足日照标准', '起居室、卧室净高 ≥ 2.50 m（局部 ≥ 2.10 m）', '住宅单元安全出口与疏散楼梯按建筑高度分档设置'], unit: '户', kpi: a => `按 110 ㎡/户约 ${fmt(a / 110)} 户` },
    '工业厂房': { codes: 'GB 50016 第 3 章、GB 50187《工业企业总平面设计规范》', pts: ['按生产火灾危险性分类确定耐火等级与防火分区', '厂房疏散距离按火灾危险性类别与层数查表 3.7.4', '大跨屋面需复核排烟与采光'], unit: '㎡', kpi: a => `总建筑面积 ${fmt(a)} ㎡` }
  };
  const AGENT_FOCUS = {
    brief: k => ['逐条核对任务书面积与规划条件的闭合关系', ...k.pts.slice(0, 2)],
    site: k => [k.pts[0], '交通出入口距主干道交叉口 ≥ 70 m（GB 50352 4.2.4）'],
    concept: k => [k.pts[0], k.pts[1] || ''],
    render: () => ['效果图视角宜与规划审批要求的主要城市界面一致', '材质与色彩需与城市风貌导则衔接'],
    report: k => ['汇报材料应前置指标表与规范符合性结论', '突出 ' + k.codes.split('、')[0] + ' 关键条文的回应'],
    indicators: () => ['计容面积口径以当地规划技术管理规定为准', '地下室顶板覆土 ≥ 1.5 m 方可计入绿地（多地规定）'],
    cost: () => ['单方指标可在「工具 › 单方造价库」按当地信息价调整', '初设概算超估算 10% 需重新报批'],
    permit: () => ['申报前核对工程建设项目审批管理系统办事指南版本'],
    code: k => k.pts.slice(0, 3),
    plancheck: () => ['回复须逐条对应审查意见编号，并注明修改图号'],
    completion: () => ['竣工图需加盖竣工图章并与变更、核定单一致']
  };
  function projectInsight(agent, p) {
    if (!p) return '';
    const k = TYPE_KNOW[p.type] || TYPE_KNOW['办公']; const pl = p.plan || {}; const a = num(p.area);
    const r = p.records || {}; const open = ['review', 'change', 'service'].reduce((s, x) => s + (r[x] || []).filter(y => !/闭合|已签发/.test(y.status || '')).length, 0);
    const focus = (AGENT_FOCUS[agent.id] || (x => x.pts.slice(0, 2)))(k).filter(Boolean);
    const cap = pl.siteArea && pl.far ? `用地 ${fmt(pl.siteArea)} ㎡ × 容积率 ${pl.far} → 计容上限 ${fmt(pl.siteArea * pl.far)} ㎡` + (a ? `；当前总建筑面积 ${fmt(a)} ㎡` : '') : '尚未录入规划条件，建议先运行「规划条件与场地分析」';
    return `\n\n### 结合本项目的专业提示\n| 项 | 内容 |\n|---|---|\n| 项目 | ${p.code || ''} ${pname(p)}（${p.type || '—'}，${p.stage || '—'}） |\n| 适用规范 | ${k.codes} |\n| 开发容量 | ${cap} |\n| 规模估测 | ${k.kpi(a)} |\n| 未闭合事项 | ${open} 项 |\n\n` + focus.map(x => '- ' + x).join('\n');
  }
  function enrichMock(agent, text, p) { if (!p || /结合本项目的专业提示/.test(text)) return text; return text + projectInsight(agent, p); }

  /* ---------------- 规范符合性校核 ---------------- */
  function fireClass(use, h, important) {
    if (use === '住宅') return h > 54 ? '一类高层住宅' : h > 27 ? '二类高层住宅' : '单、多层住宅';
    return (h > 50 || (h > 24 && important === '是')) ? '一类高层公共建筑' : h > 24 ? '二类高层公共建筑' : '单、多层公共建筑';
  }
  function checkCompliance(i) {
    const h = num(i.height), cls = fireClass(i.use, h, i.important), high = cls.includes('高层');
    const rows = []; const add = (cat, item, actual, req, pass, basis) => rows.push({ cat, item, actual, req, pass, basis });
    add('防火', '建筑分类', cls, '-', true, 'GB 50016-2014(2018年版) 5.1.1');
    const needRating = cls.startsWith('一类') || i.basement === '是' ? '一级' : high ? '不低于二级' : '不低于二级（视层数）';
    add('防火', '耐火等级', i.fireRating, needRating, needRating === '一级' ? i.fireRating === '一级' : true, 'GB 50016 5.1.3');
    const btype = i.use === '住宅' ? '住宅' : (i.btype || '办公');
    const cl = compartmentLimit({ type: btype, high, sprinkler: i.sprinkler, hall: i.hall, singleOrFirst: i.singleOrFirst });
    add('防火', '防火分区最大允许建筑面积', num(i.compArea) + ' ㎡', '≤ ' + cl.limit + ' ㎡（' + cl.note + '）', num(i.compArea) <= cl.limit, cl.basis);
    if (i.basement === '是' && i.basementComp != null && i.basementComp !== '') { const bl = compartmentLimit({ underground: true, sprinkler: i.sprinkler });
      add('防火', '地下室防火分区面积', num(i.basementComp) + ' ㎡', '≤ ' + bl.limit + ' ㎡', num(i.basementComp) <= bl.limit, bl.basis); }
    add('疏散', '每个防火分区安全出口数量', num(i.exits) + ' 个', '≥ 2 个', num(i.exits) >= 2, 'GB 50016 5.5.8 / 5.5.25');
    const ev = evacLimit(btype, high, i.sprinkler);
    add('疏散', '两个安全出口之间的疏散门至最近安全出口距离（' + btype + '）', num(i.evacDist) + ' m', '≤ ' + ev.between + ' m（' + ev.note + '，基准 ' + ev.base[0] + ' m' + (i.sprinkler === '是' ? '，全设喷淋 +25%' : '') + '）', num(i.evacDist) <= ev.between, ev.basis);
    if (i.deadEnd != null && i.deadEnd !== '') add('疏散', '袋形走道两侧或尽端的疏散门至最近安全出口距离', num(i.deadEnd) + ' m', '≤ ' + ev.dead + ' m', num(i.deadEnd) <= ev.dead, ev.basis);
    if (high) {
      add('消防救援', '消防车道', i.fireLane === '是' ? '已设环形消防车道 / 沿两个长边设置' : '未满足', '高层建筑应设环形消防车道或沿两个长边设置', i.fireLane === '是', 'GB 50016 7.1.2');
      add('消防救援', '消防车登高操作场地', i.rescueSite === '是' ? '已设置' : '未设置', '高层建筑应至少沿一个长边或周边长度 1/4 且不小于一个长边长度设置', i.rescueSite === '是', 'GB 50016 7.2.1');
    }
    const railReq = h >= 24 ? 1.10 : 1.05;
    add('通用', '临空栏杆高度', num(i.railHeight).toFixed(2) + ' m', '≥ ' + railReq.toFixed(2) + ' m（临空高度' + (h >= 24 ? '≥' : '<') + '24m）', num(i.railHeight) >= railReq, 'GB 55031-2022 / GB 50352-2019 6.7.3');
    add('通用', '有人员正常活动空间最低处净高', num(i.clearHeight).toFixed(2) + ' m', '≥ 2.00 m', num(i.clearHeight) >= 2.0, 'GB 50352-2019 6.3.2');
    add('通用', '公共楼梯踏步高度', num(i.riser).toFixed(3) + ' m', '≤ 0.175 m（踏步宽 ≥ 0.26 m）', num(i.riser) <= 0.175, 'GB 50352-2019 6.8.10');
    add('无障碍', '轮椅坡道坡度', '1:' + num(i.ramp), '不应大于 1:12', num(i.ramp) >= 12, 'GB 55019-2021 2.3 / GB 50763-2012 3.4.4');
    add('无障碍', '无障碍出入口', i.accessEntry === '是' ? '已设置' : '未设置', '公共建筑主要出入口应为无障碍出入口', i.accessEntry === '是', 'GB 55019-2021 2.4 / GB 50763-2012 3.3');
    const sl = sunlightByType(i.use === '住宅' ? '住宅' : i.btype, i.climate, i.citySize);
    if (sl) add('日照', sl.room + '日照标准', `${sl.day} ${num(i.sunHours)} h`, `${sl.day} ≥ ${sl.hours} h`, num(i.sunHours) >= sl.hours, sl.basis);
    const spReq = num(i.sunCoef) * num(i.southHeight);
    add('日照', '日照间距', num(i.spacing) + ' m', `≥ ${num(i.sunCoef)} × ${num(i.southHeight)} = ${spReq.toFixed(1)} m`, num(i.spacing) >= spReq, '地方城市规划管理技术规定（间距系数）');
    return { cls, high, btype, rows, passCount: rows.filter(r => r.pass).length, failCount: rows.filter(r => !r.pass).length };
  }

  /* ---------------- 投资估算 / 设计概算（工程费用构成） ---------------- */
  const EST_SPLIT = [['建筑工程费', 0.62], ['安装工程费', 0.25], ['设备及工器具购置费', 0.08], ['室外配套工程费', 0.05]];
  const BUDGET_SPLIT = [['土建工程（含结构）', 0.45], ['装饰装修工程', 0.15], ['幕墙工程', 0.02], ['给排水工程', 0.04], ['消防工程', 0.04], ['暖通空调工程', 0.09], ['电气工程', 0.08], ['智能化工程', 0.04], ['电梯工程', 0.04], ['室外总图工程', 0.05]];
  const OTHER_FEES = [['建设单位管理费', 0.012], ['前期工作咨询费', 0.004], ['工程勘察费', 0.006], ['工程设计费', 0.028], ['施工图审查费', 0.0015], ['工程监理费', 0.016], ['招标代理服务费', 0.003], ['造价咨询费', 0.004], ['环境影响评价等专项评估费', 0.0015]];
  function estimateCost(i) {
    const rf = REGION_FACTOR[i.region] || 1, gf = GRADE_FACTOR[i.grade] || 1;
    const above = num(i.aboveArea), below = num(i.belowArea), area = above + below;
    const ua = (COST_BASE[i.type] || 3500) * rf * gf, ub = UNDERGROUND_BASE * rf * gf;
    const eng = ua * above + ub * below;
    const split = i.stage === '设计概算' ? BUDGET_SPLIT : EST_SPLIT;
    const engItems = split.map(([n, r]) => ({ name: n, ratio: r, amount: eng * r }));
    const otherItems = OTHER_FEES.map(([n, r]) => ({ name: n, ratio: r, amount: eng * r }));
    otherItems.push({ name: '城市基础设施配套费', ratio: null, amount: num(i.infraFee) * area });
    const other = otherItems.reduce((s, x) => s + x.amount, 0);
    const rate = num(i.contRate, i.stage === '设计概算' ? 5 : 8) / 100;
    const contingency = (eng + other) * rate;
    const total = eng + other + contingency;
    return { ua, ub, eng, engItems, otherItems, other, rate, contingency, total, perSqm: total / Math.max(area, 1), engPerSqm: eng / Math.max(area, 1) };
  }

  /* ---------------- 图纸目录 ---------------- */
  const DISCIPLINES = { '建筑': '建施', '结构': '结施', '给排水': '水施', '暖通': '暖施', '电气': '电施' };
  const SHEET_A1 = { 'A0': 2, 'A1': 1, 'A1+1/4': 1.25, 'A1+1/2': 1.5, 'A2': 0.5, 'A3': 0.25 };
  function drawingNo(discipline, list) {
    const pre = DISCIPLINES[discipline] || '图';
    const used = list.filter(d => d.discipline === discipline).map(d => parseInt(String(d.no).split('-')[1]) || 0);
    return `${pre}-${String((used.length ? Math.max(...used) : 0) + 1).padStart(2, '0')}`;
  }
  const REQUIRED_ARCH = [['设计说明', /说明/], ['总平面图', /总平面/], ['平面图', /(?<!总)平面图/], ['立面图', /立面/], ['剖面图', /剖面/], ['详图', /详图|大样/]];
  function drawingCheck(list) {
    const live = list.filter(d => d.status !== '已作废');
    const missingDisc = Object.keys(DISCIPLINES).filter(k => !live.some(d => d.discipline === k));
    const archTitles = live.filter(d => d.discipline === '建筑').map(d => d.title);
    const missingArch = REQUIRED_ARCH.filter(([, re]) => !archTitles.some(t => re.test(t))).map(([n]) => n);
    const a1 = live.reduce((s, d) => s + (SHEET_A1[d.size] || 1), 0);
    return { missingDisc, missingArch, a1, count: live.length };
  }

  /* ---------------- 施工图审查意见回复 ---------------- */
  const PLANCHECK_RULES = [
    [/疏散|安全出口|疏散距离/, 'GB 50016-2014(2018年版) 5.5'], [/防火分区|防火墙|防火门/, 'GB 50016 5.3 / 6.5'], [/消防车道|登高/, 'GB 50016 7.1 / 7.2'],
    [/无障碍|坡道|轮椅/, 'GB 55019-2021 / GB 50763-2012'], [/栏杆|护栏|临空/, 'GB 55031-2022 / GB 50352-2019 6.7'], [/楼梯|踏步|梯段/, 'GB 50352-2019 6.8'],
    [/节能|保温|窗墙比|热工/, 'GB 55015-2021 建筑节能与可再生能源利用通用规范'], [/日照/, 'GB 50180-2018 4.0.9'], [/防水|屋面/, 'GB 55030-2022 建筑与市政工程防水通用规范'],
    [/人防/, 'GB 50038-2005 人民防空地下室设计规范'], [/净高|层高/, 'GB 50352-2019 6.3'], [/幕墙|玻璃/, 'JGJ 102-2003 / 《建筑安全玻璃管理规定》']
  ];
  function planCheckReply(text, startNo) {
    const items = String(text).split(/\n+/).map(s => s.replace(/^\s*(\d+[.、．)]|[（(]\d+[)）])\s*/, '').trim()).filter(Boolean);
    return items.map((t, k) => {
      const r = PLANCHECK_RULES.find(([re]) => re.test(t)); const sheet = `建施-${String((startNo || 3) + k).padStart(2, '0')}`;
      const forced = /强条|强制性/.test(t);
      return { no: k + 1, opinion: t, basis: r ? r[1] : '相关现行规范', type: forced ? '强制性条文' : '一般性条文', reply: r ? `已按审查意见修改，满足 ${r[1]} 要求，详见 ${sheet}。` : `已核实并按意见修改完善，详见 ${sheet}。`, sheet };
    });
  }

  /* ---------------- 报建资料清单 ---------------- */
  function permitList(i) {
    const base = {
      '建设工程规划许可证': [['建设工程规划许可证申请表', '建设单位'], ['建设项目用地预审与选址意见书 / 不动产权证书（土地）', '建设单位'], ['建设用地规划许可证及规划设计条件（含用地红线图）', '建设单位'], ['经审定的建设工程设计方案总平面图', '设计单位'], ['建筑单体平、立、剖面图（方案深度）', '设计单位'], ['经济技术指标表（容积率、建筑密度、绿地率、停车位等）', '设计单位'], ['日照分析报告（如涉及住宅、学校、医院等日照敏感建筑）', '设计单位/第三方'], ['1:500 / 1:1000 现状地形图（电子版）', '建设单位'], ['建设单位法人授权委托书及经办人身份证明', '建设单位']],
      '建设工程设计方案审查': [['设计方案审查申请表', '建设单位'], ['规划设计条件及用地红线图', '建设单位'], ['设计方案文本（总平面、单体、效果图、设计说明）', '设计单位'], ['经济技术指标表', '设计单位'], ['交通影响评价（如需）', '第三方'], ['方案电子报批文件（按当地数据标准）', '设计单位']],
      '施工图审查送审': [['施工图审查委托书 / 合同', '建设单位'], ['全套施工图（建施、结施、水施、暖施、电施）及计算书', '设计单位'], ['岩土工程勘察报告（详勘）及审查合格书', '勘察单位'], ['建设工程规划许可证及附图', '建设单位'], ['设计单位资质证书、注册执业人员证书及签章', '设计单位'], ['节能计算书及节能审查表', '设计单位'], ['消防设计专篇', '设计单位']],
      '施工许可证（设计配合）': [['施工图设计文件审查合格书', '图审机构'], ['建设工程规划许可证', '建设单位'], ['中标通知书及施工、监理合同', '建设单位'], ['设计单位工程项目负责人质量终身责任承诺书', '设计单位'], ['安全措施及质量监督手续', '建设单位/施工单位']]
    }[i.matter] || [];
    const extra = [];
    if (i.civilDefense === '是') extra.push(['人防工程设计文件及人防审批（易地建设费或人防设计审查意见）', '设计单位/建设单位']);
    if (i.green === '是') extra.push(['绿色建筑设计专篇及自评估报告', '设计单位']);
    if (i.sponge === '是') extra.push(['海绵城市设计专篇及指标计算书', '设计单位']);
    if (i.prefab === '是') extra.push(['装配式建筑设计专篇及装配率计算书', '设计单位']);
    return base.concat(extra);
  }

  /* ---------------- 编号规则 ---------------- */
  const REVIEW_LEVELS = ['校对', '审核', '审定'];
  function recordNo(kind, rec, list) {
    const pad = n => String(n).padStart(3, '0');
    if (kind === 'change') {
      const isBG = rec.form === '设计变更单'; const pre = isBG ? `SJBG-${DISCIPLINES[rec.discipline] ? DISCIPLINES[rec.discipline][0] : '建'}` : 'JSHD';
      return `${pre}-${pad(list.filter(x => x.form === rec.form && (!isBG || x.discipline === rec.discipline)).length + 1)}`;
    }
    if (kind === 'service') return `XCFW-${pad(list.length + 1)}`;
    if (kind === 'review') return `JS-${pad(list.length + 1)}`;
    return pad(list.length + 1);
  }

  /* ---------------- Markdown → HTML（先转义） ---------------- */
  function md(src) {
    const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const inline = s => esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\[(OK|NG|!)\]/g, (m, k) => k === 'OK' ? '<i class="ri-checkbox-circle-fill ok"></i>' : k === 'NG' ? '<i class="ri-close-circle-fill ng"></i>' : '<i class="ri-error-warning-fill wn"></i>');
    const lines = String(src).split('\n'); let out = '', i = 0;
    while (i < lines.length) {
      const l = lines[i];
      if (l.startsWith('```')) { const b = []; i++; while (i < lines.length && !lines[i].startsWith('```')) b.push(lines[i++]); i++; out += `<pre>${esc(b.join('\n'))}</pre>`; continue; }
      if (/^\|/.test(l)) { let rows = []; while (i < lines.length && /^\|/.test(lines[i])) rows.push(lines[i++]); rows = rows.filter(r => !/^\|[\s|:-]+\|$/.test(r));
        out += '<table>' + rows.map((r, k) => '<tr>' + r.replace(/^\||\|$/g, '').split('|').map(c => k ? `<td>${inline(c.trim())}</td>` : `<th>${inline(c.trim())}</th>`).join('') + '</tr>').join('') + '</table>'; continue; }
      const h = l.match(/^(#{1,4})\s+(.*)/); if (h) { out += `<h${h[1].length + 1}>${inline(h[2])}</h${h[1].length + 1}>`; i++; continue; }
      if (/^\s*([-*]|\d+\.)\s/.test(l)) { const ord = /^\s*\d+\./.test(l); const it = []; while (i < lines.length && /^\s*([-*]|\d+\.)\s/.test(lines[i])) it.push(lines[i++].replace(/^\s*([-*]|\d+\.)\s/, '')); out += (ord ? '<ol>' : '<ul>') + it.map(x => `<li>${inline(x)}</li>`).join('') + (ord ? '</ol>' : '</ul>'); continue; }
      if (l.startsWith('> ')) { out += `<blockquote>${inline(l.slice(2))}</blockquote>`; i++; continue; }
      if (l.trim()) out += `<p>${inline(l)}</p>`; i++;
    }
    return out;
  }
  const yes = b => b ? '[OK] 满足' : '[NG] 不满足';

  /* ---------------- 字段工厂 ---------------- */
  const F = {
    n: (key, label, d, extra) => ({ key, label, type: 'number', default: d, ...extra }),
    t: (key, label, d, extra) => ({ key, label, type: 'text', default: d, ...extra }),
    a: (key, label, d, extra) => ({ key, label, type: 'textarea', default: d, ...extra }),
    s: (key, label, options, d, extra) => ({ key, label, type: 'select', options, default: d ?? options[0], ...extra }),
    yn: (key, label, d = '是') => ({ key, label, type: 'select', options: ['是', '否'], default: d })
  };

  /* ================= 智能体 ================= */
  const AGENTS = [
    /* ---------- 方案设计 ---------- */
    { id: 'brief', name: '设计任务书分析', short: '任务书', icon: 'ri-file-paper-2-line', stage: '方案设计',
      desc: '解析建设单位《设计任务书》，提取设计范围、功能面积配置、技术要求与进度节点，形成待澄清问题清单。',
      fields: [F.a('brief', '设计任务书原文 / 建设单位需求', '一、项目概况：本项目为滨江社区文化中心，总建筑面积约 12000㎡（其中地下约 3000㎡），用地面积 8000㎡。\n二、功能要求：图书馆 2500㎡、400 座多功能剧场、展厅 800㎡、社区活动用房 1500㎡、地下车库及设备用房。\n三、技术要求：绿色建筑二星级，装配率不低于 50%。\n四、投资控制：工程总投资控制在 1.2 亿元以内。\n五、进度要求：2026 年 12 月完成方案报批，2027 年 3 月完成施工图审查。'),
        F.s('scope', '设计范围', ['建筑方案至施工图全过程', '仅方案设计', '初步设计及施工图设计']), F.s('focus', '分析侧重', ['全面分析', '功能面积配置', '投资与进度', '设计风险'])],
      prompt: (i, p) => `你是中国建筑设计院的项目负责人。请分析以下《设计任务书》，按"任务书要点、设计范围与深度（依据《建筑工程设计文件编制深度规定》2016版）、功能面积配置表、技术要求、投资与进度节点、设计风险、需建设单位澄清事项"输出。工程：${pname(p)}；设计范围：${i.scope}；侧重：${i.focus}。\n任务书：\n${i.brief}`,
      mock: (i, p) => {
        const t = String(i.brief || ''); const area = (t.match(/总建筑面积[约为]*\s*([\d,.]+)\s*㎡/) || [])[1] || (p && p.area) || '未明确'; const site = (t.match(/用地面积[约为]*\s*([\d,.]+)\s*㎡/) || [])[1] || '未明确';
        const inv = (t.match(/([\d.]+)\s*亿元/) || [])[1]; const funcs = [...t.matchAll(/([\u4e00-\u9fa5]{2,8}?)\s*([\d,]+)\s*㎡/g)].filter(m => !/总建筑面积|用地面积|地下约/.test(m[1]));
        const sumF = funcs.reduce((s, m) => s + num(m[2].replace(/,/g, '')), 0);
        return `## 设计任务书分析报告\n\n**工程名称：** ${pname(p)}　**设计范围：** ${i.scope}　**分析侧重：** ${i.focus}\n\n### 一、任务书要点\n| 项目 | 内容 |\n|---|---|\n| 总建筑面积 | ${area} ㎡ |\n| 规划用地面积 | ${site} ㎡ |\n| 投资控制 | ${inv ? inv + ' 亿元' : '未明确'} |\n| 绿色建筑 | ${(t.match(/绿色建筑[^，。,\n]*/) || ['未明确'])[0]} |\n| 装配式 | ${(t.match(/装配率[^，。,\n]*/) || ['未明确'])[0]} |\n\n### 二、设计阶段与成果深度\n| 设计阶段 | 主要成果 | 深度依据 |\n|---|---|---|\n| 方案设计 | 方案文本、总平面、单体平立剖、经济技术指标、效果图、投资估算 | 《建筑工程设计文件编制深度规定》（2016年版）第2章 |\n| 初步设计 | 设计说明书、各专业图纸、主要设备材料表、设计概算 | 同上 第3章 |\n| 施工图设计 | 全专业施工图、计算书、节能/消防专篇，送施工图审查 | 同上 第4章 |\n| 施工配合 | 设计交底、图纸会审、设计变更、现场服务 | 设计合同约定 |\n\n### 三、功能面积配置表\n| 功能 | 任务书面积（㎡） | 占地上面积比 | 设计提示 |\n|---|---|---|---|\n` +
          (funcs.length ? funcs.map(m => `| ${m[1]} | ${m[2]} | ${area !== '未明确' ? (num(m[2].replace(/,/g, '')) / num(area.replace(/,/g, '')) * 100).toFixed(1) + '%' : '-'} | 需核实使用方及运营模式 |`).join('\n') : '| 未识别到明确面积 | - | - | 请补充功能面积 |') +
          `\n| 公共交通及辅助（推算） | ${area !== '未明确' ? fmt(Math.max(num(area.replace(/,/g, '')) - sumF, 0)) : '-'} | - | 含门厅、交通核、卫生间、设备用房 |\n\n### 四、设计风险\n- [!] 任务书功能面积合计与总建筑面积需闭合核算，避免报批面积超限；\n- [!] ${/剧场|观众厅/.test(t) ? '剧场类空间涉及声学、舞台工艺及人员密集场所疏散，建议尽早引入专项顾问；' : '需尽早明确各功能使用方需求，降低后期变更；'}\n- [!] ${inv ? `投资 ${inv} 亿元对应单方约 ${area !== '未明确' ? fmt(num(inv) * 1e8 / num(area.replace(/,/g, ''))) : '-'} 元/㎡，需在方案阶段做投资估算复核；` : '投资控制目标未明确；'}\n- [!] 进度节点需与规划报批、施工图审查周期匹配。\n\n### 五、需建设单位澄清事项\n1. 请提供规划设计条件通知书及用地红线图（坐标）、1:500 地形图；\n2. 各功能用房的使用方、运营模式及详细房间需求表；\n3. 绿色建筑星级、装配式、海绵城市、人防等专项要求的批文依据；\n4. 地下室是否兼作人防工程，人防面积指标；\n5. 设计合同对效果图、模型、BIM 的成果要求。`; } },

    { id: 'site', name: '规划条件与场地分析', short: '规划条件', icon: 'ri-road-map-line', stage: '方案设计', savesPlan: true,
      desc: '录入规划设计条件（用地红线、退线、容积率、密度、绿地率、限高、日照），计算可建范围与开发容量；结果写入项目规划条件。',
      fields: [F.t('location', '项目地点', '上海市浦东新区某地块'), F.s('climate', '建筑气候区划', CLIMATES, 'Ⅲ 夏热冬冷地区'), F.s('citySize', '城市规模', ['大城市', '中小城市']),
        F.s('landUse', '用地性质', ['A2 文化设施用地', 'R2 二类居住用地', 'B1 商业用地', 'B2 商务用地', 'A33 中小学用地', 'M1 一类工业用地']),
        F.n('siteArea', '规划用地面积（㎡）', 8000), F.n('siteWidth', '用地面宽 东西向（m）', 100), F.n('siteDepth', '用地进深 南北向（m）', 80),
        F.n('far', '容积率上限', 1.5), F.n('density', '建筑密度上限（%）', 40), F.n('green', '绿地率下限（%）', 35), F.n('height', '建筑限高（m）', 24),
        F.n('setbackN', '北侧退道路红线（m）', 10), F.n('setbackS', '南侧退用地红线（m）', 8), F.n('setbackE', '东侧退用地红线（m）', 6), F.n('setbackW', '西侧退道路红线（m）', 8),
        F.n('sunCoef', '日照间距系数（地方规定）', 1.2), F.a('surround', '周边环境', '北侧为城市主干道（红线宽 40m），南侧为滨河绿带，东侧为既有多层住宅小区，西侧为城市次干道。')],
      prompt: (i, p) => `作为建筑师，根据以下规划设计条件做场地分析与开发容量测算（可建范围、计容面积上限、基底面积上限、绿地面积下限、日照与退线影响、交通出入口、SWOT 与设计策略），工程：${pname(p)}。条件：${JSON.stringify(i)}`,
      mock: (i, p) => {
        const c = siteCapacity(i);
        return `## 规划条件与场地分析\n\n**工程名称：** ${pname(p)}　**地点：** ${i.location}　**用地性质：** ${i.landUse}　**气候区：** ${i.climate}\n\n### 一、规划设计条件\n| 指标 | 规划要求 |\n|---|---|\n| 规划用地面积 | ${fmt(c.site, 2)} ㎡ |\n| 容积率 | ≤ ${i.far} |\n| 建筑密度 | ≤ ${i.density}% |\n| 绿地率 | ≥ ${i.green}% |\n| 建筑限高 | ≤ ${i.height} m |\n| 建筑退线 | 北 ${i.setbackN} m / 南 ${i.setbackS} m / 东 ${i.setbackE} m / 西 ${i.setbackW} m |\n| 日照要求 | ${String(i.landUse).startsWith('R') ? `住宅 ${c.sun.day} ≥ ${c.sun.hours} h（GB 50180-2018）` : '不得降低周边日照敏感建筑现状日照标准'} |\n\n### 二、开发容量测算\n| 项目 | 计算 | 结果 |\n|---|---|---|\n| 退线后可建范围 | (${i.siteWidth}-${i.setbackE}-${i.setbackW}) × (${i.siteDepth}-${i.setbackN}-${i.setbackS}) | **${fmt(c.buildable)} ㎡**（${c.bw}m × ${c.bd}m） |\n| 计容建筑面积上限 | ${fmt(c.site)} × ${i.far} | **${fmt(c.maxGfa)} ㎡** |\n| 建筑基底面积上限 | min(用地×密度, 可建范围) | **${fmt(c.maxFootprint)} ㎡** |\n| 绿地面积下限 | ${fmt(c.site)} × ${i.green}% | **${fmt(c.minGreen)} ㎡** |\n| 本建筑北侧日照影响间距 | ${i.sunCoef} × ${i.height} m | **${c.spacing.toFixed(1)} m** |\n\n### 三、场地分析\n- 周边环境：${i.surround}\n- 交通：机动车出入口宜设于次要道路，距大中城市主干道交叉口道路红线交点不小于 70 m（GB 50352-2019 4.2.4）；\n- 景观：${/河|绿|公园/.test(i.surround) ? '滨水 / 绿带为核心景观资源，主要公共空间宜朝向景观面' : '景观资源有限，宜组织内部庭院'}；\n- 噪声：主干道一侧宜布置辅助用房或采取隔声措施；\n- 日照：${/住宅/.test(i.surround) ? '[!] 东侧既有住宅为日照敏感建筑，方案阶段需做日照分析，确保不降低其日照标准' : '周边无明显日照敏感建筑'}。\n\n### 四、SWOT\n| 优势 S | 劣势 W |\n|---|---|\n| 区位与景观资源 | 退线后可建范围 ${c.bw}m × ${c.bd}m，体量布置受限 |\n| **机会 O** | **威胁 T** |\n| 片区城市更新与公共服务需求 | 日照、限高约束及报批不确定性 |\n\n### 五、设计策略\n1. 体量沿主干道连续界面、向南侧景观跌落；\n2. 在可建范围内控制基底不超过 ${fmt(c.maxFootprint)} ㎡，集中绿地布置于南侧滨河界面；\n3. 主出入口结合城市次干道设置，地下车库出入口远离交叉口。`; } },

    { id: 'concept', name: '概念方案与体量试算', short: '体量试算', icon: 'ri-lightbulb-flash-line', stage: '方案设计',
      desc: '在规划条件约束下比选点式、板式、围合式体量，试算层数、基底、密度、高度，输出方案比选表。',
      fields: [F.n('siteArea', '规划用地面积（㎡）', 8000, { plan: 'siteArea' }), F.n('far', '容积率上限', 1.5, { plan: 'far' }), F.n('density', '建筑密度上限（%）', 40, { plan: 'density' }), F.n('height', '建筑限高（m）', 24, { plan: 'height' }),
        F.n('gfa', '拟建计容建筑面积（㎡）', 9000), F.n('floorHeight', '标准层层高（m）', 4.5), F.t('theme', '设计意向', '城市客厅、滨水台地、开放共享')],
      prompt: (i, p) => `在以下规划条件下为 ${pname(p)} 提出点式、板式、围合式三个体量方案并比选（层数、基底面积、建筑密度、高度、空间特点、优缺点），设计意向：${i.theme}。条件：${JSON.stringify(i)}`,
      mock: (i, p) => {
        const o = massingOptions(i); const m = o.pop(); const best = o.filter(x => x.ok).sort((a, b) => a.floors - b.floors)[0];
        const notes = { '点式塔楼': '用地释放充分，景观视野好；交通核集中，标准层效率高', '板式条楼': '南北朝向好，自然通风采光佳；对北侧及周边日照影响需复核', '围合院落': '形成内向庭院与城市客厅，公共性强；转角处采光需处理' };
        return `## 概念方案与体量试算\n\n**工程名称：** ${pname(p)}　**设计意向：** ${i.theme}\n\n计容面积取 min(拟建 ${fmt(i.gfa)}, 上限 ${fmt(num(i.siteArea) * num(i.far))}) = **${fmt(m.gfa)} ㎡**；限高 ${i.height} m、层高 ${i.floorHeight} m，最多 **${m.maxFloors} 层**。\n\n| 方案 | 基底面积（㎡） | 层数 | 建筑密度 | 容积率 | 估算高度（m） | 是否满足限高 |\n|---|---|---|---|---|---|---|\n` +
          o.map((x, k) => `| 方案${'ABC'[k]}·${x.name} | ${fmt(x.footprint)} | ${x.floors} | ${x.density.toFixed(1)}% | ${x.far.toFixed(2)} | ${x.height} | ${yes(x.ok)} |`).join('\n') +
          `\n\n### 方案说明\n` + o.map((x, k) => `- **方案${'ABC'[k]}·${x.name}**：${notes[x.name]}。`).join('\n') +
          `\n\n### 比选建议\n${best ? `推荐 **${best.name}** 作为主线深化（满足限高且层数最少，${best.floors} 层），下一步进行日照分析、消防扑救面及流线验证。` : '[!] 三个方案均突破限高，需降低计容面积或与规划部门沟通。'}`; } },

    { id: 'render', name: '效果图提示词生成', short: '效果图', icon: 'ri-image-ai-line', stage: '方案设计',
      desc: '将方案描述转换为 Midjourney / Stable Diffusion 的中英文正负提示词及参数，用于方案文本效果图意向。',
      fields: [F.a('subject', '建筑描述', '四层社区文化中心，退台式体量，穿孔铝板与木格栅立面，首层通透玻璃，南侧滨河景观台阶'),
        F.s('view', '视角', ['人视角', '鸟瞰', '室内', '夜景人视', '细部特写']), F.s('style', '表现风格', ['写实摄影', '方案投标表现', '水彩手绘', '白模']),
        F.s('time', '时间/天气', ['黄昏暖光', '晴朗正午', '阴天柔光', '雨后夜景', '清晨薄雾']), F.s('tool', '目标工具', ['Midjourney', 'Stable Diffusion', '通用'])],
      prompt: i => `把以下建筑描述转为高质量 AI 效果图提示词（英文正向、中文说明、负面提示词、参数建议）：${i.subject}；视角 ${i.view}；风格 ${i.style}；时间 ${i.time}；工具 ${i.tool}`,
      mock: (i, p) => {
        const v = { '人视角': 'eye-level street view, 35mm lens, two-point perspective', '鸟瞰': 'aerial view, drone shot, 45 degree', '室内': 'interior view, wide angle 24mm', '夜景人视': 'night eye-level view, glowing interior lights', '细部特写': 'close-up facade detail, 85mm' }[i.view];
        const s = { '写实摄影': 'photorealistic architectural photography, ultra detailed, 8k', '方案投标表现': 'architectural competition rendering, atmospheric, people, trees', '水彩手绘': 'watercolor architectural sketch, loose brush strokes', '白模': 'white physical model, minimalist, studio lighting' }[i.style];
        const t = { '黄昏暖光': 'golden hour, warm sunset light', '晴朗正午': 'clear sky, midday sun, crisp shadows', '阴天柔光': 'overcast soft light', '雨后夜景': 'wet ground reflections, night after rain', '清晨薄雾': 'early morning mist' }[i.time];
        return `## 效果图提示词（${i.tool}）\n\n**工程名称：** ${pname(p)}\n\n### 正向提示词\n\`\`\`\ncontemporary community cultural center in China, terraced massing, perforated aluminum panels and timber louvers, transparent glass ground floor, riverside landscape steps, ${v}, ${t}, ${s}${i.tool === 'Midjourney' ? ' --ar 16:9 --style raw --v 6' : ''}\n\`\`\`\n\n### 中文说明\n${i.subject}；${i.view}；${i.time}；${i.style}。\n\n### 负面提示词\n\`\`\`\nblurry, distorted perspective, extra floors, deformed people, watermark, text, lowres\n\`\`\`\n${i.tool === 'Stable Diffusion' ? '\n### 参数建议\n- 采样器 DPM++ 2M Karras，步数 30，CFG 6.5；\n- 建议以 SketchUp / Rhino 白模线稿配合 ControlNet（MLSD / Canny）锁定形体。\n' : ''}\n> 效果图仅作方案意向表达，报批文本中的效果图须与总平面及立面一致。`; } },

    { id: 'report', name: '方案汇报与沟通', short: '汇报沟通', icon: 'ri-chat-4-line', stage: '方案设计',
      desc: '生成方案汇报提纲、会议纪要、工作联系函、方案设计说明，用于与建设单位及主管部门沟通。',
      fields: [F.s('kind', '文件类型', ['方案汇报提纲', '会议纪要', '工作联系函', '方案设计说明']), F.t('audience', '对象', '建设单位 王总、区规划资源局'),
        F.a('points', '要点（每行一条）', '方案A（围合院落）已深化完成\n投资估算约 1.15 亿元，控制在目标内\n请建设单位确认剧场座位数及地下停车位数量\n下周三前提交方案报批文本'),
        F.s('tone', '语气', ['正式', '简洁'])],
      prompt: (i, p) => `以设计院项目负责人身份撰写${i.kind}，对象：${i.audience}，语气：${i.tone}，工程：${pname(p)}（${p && p.code || ''}）。要点：\n${i.points}`,
      mock: (i, p) => {
        const pts = i.points.split(/\n+/).map(s => s.trim()).filter(Boolean); const code = (p && p.code) || '—';
        if (i.kind === '会议纪要') return `## ${pname(p)} 设计协调会会议纪要\n\n| 工程编号 | ${code} | 会议日期 | ${today()} |\n|---|---|---|---|\n| 参会单位 | ${i.audience}、设计单位 | 记录人 | ${(p && p.leader) || '项目负责人'} |\n\n### 会议议定事项\n` + pts.map((x, k) => `${k + 1}. ${x}；`).join('\n') + `\n\n### 待办事项\n| 序号 | 事项 | 责任单位 | 完成时限 |\n|---|---|---|---|\n` + pts.filter(x => /确认|提交|提供/.test(x)).map((x, k) => `| ${k + 1} | ${x} | ${/确认|提供/.test(x) ? '建设单位' : '设计单位'} | 待定 |`).join('\n') + `\n\n> 如对本纪要有异议，请于收到后 3 个工作日内书面反馈，逾期视为确认。`;
        if (i.kind === '工作联系函') return `## 工作联系函\n\n**编号：** ${code}-LXH-${String(Date.now()).slice(-3)}　**日期：** ${today()}\n\n**致：** ${i.audience}\n\n**事由：** 关于${pname(p)}设计相关事项\n\n${i.tone === '正式' ? '贵单位：\n\n' : ''}现就本工程设计有关事项函告如下：\n\n` + pts.map((x, k) => `${k + 1}. ${x}；`).join('\n') + `\n\n请予以确认并回复为盼。\n\n设计单位（盖章）：\n\n项目负责人（签字）：${(p && p.leader) || ''}`;
        if (i.kind === '方案设计说明') return `## 方案设计说明\n\n### 一、工程概况\n${pname(p)}，位于${(p && p.location) || '—'}，建筑类型为${(p && p.type) || '—'}，总建筑面积约 ${(p && p.area) || '—'} ㎡。\n\n### 二、设计依据\n- 建设单位设计任务书及规划设计条件；\n- 《民用建筑设计统一标准》GB 50352-2019；\n- 《民用建筑通用规范》GB 55031-2022；\n- 《建筑设计防火规范》GB 50016-2014（2018年版）；\n- 《建筑与市政工程无障碍通用规范》GB 55019-2021。\n\n### 三、设计构思\n` + pts.map(x => `- ${x}`).join('\n') + `\n\n### 四、总平面、交通、消防、无障碍、节能设计（略，详见各专篇）`;
        return `## ${pname(p)} 方案设计汇报提纲\n\n**汇报对象：** ${i.audience}　**汇报日期：** ${today()}\n\n1. 项目概况与规划设计条件\n2. 设计任务书解读与功能配置\n3. 场地分析与总体布局\n4. 方案介绍（平、立、剖面及效果图）\n5. 本阶段进展\n` + pts.map(x => `   - ${x}`).join('\n') + `\n6. 经济技术指标与投资估算\n7. 需决策事项\n8. 下一步工作计划（初步设计、报建）`; } },

    /* ---------- 初步设计 ---------- */
    { id: 'indicators', name: '经济技术指标核算', short: '指标核算', icon: 'ri-calculator-line', stage: '初步设计', deterministic: true,
      desc: '按总平面经济技术指标表格式核算总建筑面积、计容面积、容积率、建筑密度、绿地率、停车位，并与规划条件逐项比对。',
      fields: [F.n('siteArea', '规划用地面积（㎡）', 8000, { plan: 'siteArea' }), F.n('aboveArea', '地上建筑面积·计容（㎡）', 9000), F.n('belowArea', '地下建筑面积（㎡）', 3000),
        F.n('footprint', '建筑基底面积（㎡）', 3000), F.n('greenArea', '绿地面积（㎡）', 2900), F.n('height', '建筑高度（m）', 23.4), F.n('floorsAbove', '地上层数', 5), F.n('floorsBelow', '地下层数', 1),
        F.n('farLimit', '容积率上限', 1.5, { plan: 'far' }), F.n('densityLimit', '建筑密度上限（%）', 40, { plan: 'density' }), F.n('greenLimit', '绿地率下限（%）', 35, { plan: 'green' }), F.n('heightLimit', '建筑限高（m）', 24, { plan: 'height' }),
        F.n('carRate', '机动车配建指标（辆/100㎡）', 0.8), F.n('carAbove', '地上机动车位', 8), F.n('carBelow', '地下机动车位', 70), F.n('bikeRate', '非机动车配建指标（辆/100㎡）', 2), F.n('bikeProvided', '非机动车位', 190)],
      prompt: i => `核算以下经济技术指标并与规划条件比对：${JSON.stringify(i)}`,
      mock: (i, p) => { const c = calcIndicators(i);
        return `## 主要经济技术指标表\n\n**工程名称：** ${pname(p)}\n\n| 指标名称 | 单位 | 设计值 | 规划要求 | 结论 |\n|---|---|---|---|---|\n` + c.rows.map(r => `| ${r[0]} | ${r[1]} | ${r[2]} | ${r[3]} | ${r[4] === '-' ? '-' : yes(r[4])} |`).join('\n') +
          `\n\n${c.failCount ? `[NG] 共 **${c.failCount}** 项指标不满足规划条件，请调整方案后重新核算。` : '[OK] 各项指标均满足规划设计条件。'}\n\n> 计容规则（阳台、架空层、设备层、地下室等）以当地《建筑工程面积计算和竣工复核技术规程》及规划管理规定为准；面积计算依据 GB/T 50353-2013。`; } },

    { id: 'cost', name: '投资估算 / 设计概算', short: '估算概算', icon: 'ri-money-cny-circle-line', stage: '初步设计', deterministic: true,
      desc: '按建筑面积单方指标及工程费用构成（工程费用 + 工程建设其他费用 + 预备费）编制投资估算或设计概算。',
      fields: [F.s('stage', '编制类型', ['投资估算', '设计概算']), F.s('type', '建筑类型', BUILD_TYPES, '文化场馆', { proj: 'type' }), F.n('aboveArea', '地上建筑面积（㎡）', 9000), F.n('belowArea', '地下建筑面积（㎡）', 3000),
        F.s('region', '地区', Object.keys(REGION_FACTOR), '二线城市'), F.s('grade', '建设标准', Object.keys(GRADE_FACTOR), '标准型'), F.n('infraFee', '城市基础设施配套费（元/㎡）', 0), F.n('contRate', '基本预备费费率（%）', 8)],
      prompt: i => `编制${i.stage}，说明费用构成及主要风险：${JSON.stringify(i)}`,
      mock: (i, p) => { const c = estimateCost(i); const w = x => fmt(x / 1e4, 2);
        return `## ${i.stage}表\n\n**工程名称：** ${pname(p)}　**建筑类型：** ${i.type}　**地区：** ${i.region}　**建设标准：** ${i.grade}\n\n总建筑面积 ${fmt(num(i.aboveArea) + num(i.belowArea))} ㎡（地上 ${fmt(i.aboveArea)} ㎡，单方 ${fmt(c.ua)} 元/㎡；地下 ${fmt(i.belowArea)} ㎡，单方 ${fmt(c.ub)} 元/㎡）\n\n| 序号 | 工程或费用名称 | 计算基础 / 费率 | 金额（万元） |\n|---|---|---|---|\n| 一 | **工程费用** | 建筑面积 × 单方指标 | **${w(c.eng)}** |\n` +
          c.engItems.map((x, k) => `| ${k + 1} | ${x.name} | ${(x.ratio * 100).toFixed(0)}% | ${w(x.amount)} |`).join('\n') +
          `\n| 二 | **工程建设其他费用** | - | **${w(c.other)}** |\n` + c.otherItems.map((x, k) => `| ${k + 1} | ${x.name} | ${x.ratio == null ? num(i.infraFee) + ' 元/㎡' : '工程费用 × ' + (x.ratio * 100).toFixed(2) + '%'} | ${w(x.amount)} |`).join('\n') +
          `\n| 三 | **预备费（基本预备费）** | (一+二) × ${(c.rate * 100).toFixed(1)}% | **${w(c.contingency)}** |\n| | **建设项目总投资（不含建设期利息）** | 一+二+三 | **${w(c.total)}** |\n\n综合单方造价 **${fmt(c.perSqm)} 元/㎡**（工程费用单方 ${fmt(c.engPerSqm)} 元/㎡）。\n\n> 单方指标为内置示意数据；正式${i.stage}应依据当地计价依据、造价信息价及《建设项目投资估算编审规程》CECA/GC 1 / 《建设项目设计概算编审规程》CECA/GC 2 编制。`; } },

    { id: 'permit', name: '报建资料清单', short: '报建', icon: 'ri-government-line', stage: '初步设计',
      desc: '按报建事项（工规证、方案审查、施工图审查送审、施工许可）生成申报材料清单，标注提供单位与专项要求。',
      fields: [F.s('matter', '申报事项', ['建设工程规划许可证', '建设工程设计方案审查', '施工图审查送审', '施工许可证（设计配合）']),
        F.yn('civilDefense', '是否涉及人防工程'), F.yn('green', '是否要求绿色建筑星级'), F.yn('sponge', '是否涉及海绵城市', '否'), F.yn('prefab', '是否要求装配式建筑')],
      prompt: (i, p) => `列出${i.matter}的申报材料清单（材料名称、提供单位、备注），工程：${pname(p)}，人防：${i.civilDefense}，绿建：${i.green}，海绵：${i.sponge}，装配式：${i.prefab}`,
      mock: (i, p) => { const l = permitList(i);
        return `## ${i.matter}申报材料清单\n\n**工程名称：** ${pname(p)}　**工程编号：** ${(p && p.code) || '—'}　**编制日期：** ${today()}\n\n| 序号 | 材料名称 | 提供单位 | 份数/格式 | 是否齐备 |\n|---|---|---|---|---|\n` +
          l.map((x, k) => `| ${k + 1} | ${x[0]} | ${x[1]} | 纸质 1 份 + 电子版 | □ |`).join('\n') + `\n\n共 **${l.length}** 项材料。\n\n> 各地已推行"多规合一"及工程建设项目审批管理系统网上申报，具体材料、格式及份数以当地审批部门公布的办事指南为准。`; } },

    /* ---------- 施工图设计 ---------- */
    { id: 'code', name: '规范符合性校核', short: '规范校核', icon: 'ri-scales-3-line', stage: '施工图设计', deterministic: true,
      desc: '依据 GB 50016、GB 50352、GB 55031、GB 55019 / GB 50763、GB 50180 及日照间距，对防火分类、防火分区、疏散、栏杆、净高、无障碍、日照进行校核。',
      fields: [F.s('use', '建筑使用性质', ['公共建筑', '住宅'], '公共建筑'), F.s('btype', '建筑类型（定疏散距离）', [...BUILD_TYPES, '托儿所幼儿园'], '文化场馆', { proj: 'type' }), F.yn('hall', '防火分区为营业厅/展览厅', '否'), F.yn('singleOrFirst', '位于单层建筑或首层', '否'), F.n('height', '建筑高度（m）', 23.4, { plan: 'height' }), F.yn('important', '是否属一类高层其他条件（医疗/重要公建/单层>1000㎡商业展览等）', '否'), F.yn('basement', '是否设地下室'),
        F.s('fireRating', '耐火等级', ['一级', '二级', '三级'], '一级'), F.yn('sprinkler', '是否全设自动喷水灭火系统'), F.n('compArea', '最大防火分区面积（㎡）', 4200), F.n('exits', '防火分区最少安全出口数', 2), F.n('evacDist', '最远疏散距离（m）', 38), F.n('deadEnd', '袋形走道疏散距离（m）', 18), F.n('basementComp', '地下室最大防火分区（㎡）', 900),
        F.yn('fireLane', '消防车道（环形/沿两长边）'), F.yn('rescueSite', '消防车登高操作场地'), F.n('railHeight', '临空栏杆高度（m）', 1.10), F.n('clearHeight', '人员活动最低处净高（m）', 2.2), F.n('riser', '公共楼梯踏步高（m）', 0.16),
        F.n('ramp', '轮椅坡道坡度 1:N 的 N', 12), F.yn('accessEntry', '主要出入口为无障碍出入口'), F.s('climate', '建筑气候区划', CLIMATES, 'Ⅲ 夏热冬冷地区'), F.s('citySize', '城市规模', ['大城市', '中小城市']),
        F.n('sunHours', '住宅日照时数（h）', 2), F.n('southHeight', '南侧遮挡建筑高度（m）', 18), F.n('spacing', '与南侧建筑间距（m）', 25), F.n('sunCoef', '日照间距系数', 1.2)],
      prompt: i => `依据现行国家规范校核以下设计参数，逐条给出条文依据及整改建议：${JSON.stringify(i)}`,
      mock: (i, p) => { const c = checkCompliance(i);
        return `## 规范符合性校核报告\n\n**工程名称：** ${pname(p)}　**建筑分类：** ${c.cls}　**校核结果：** 满足 ${c.passCount} 项 / 不满足 ${c.failCount} 项\n\n| 类别 | 校核项 | 设计值 | 规范要求 | 结论 | 条文依据 |\n|---|---|---|---|---|---|\n` +
          c.rows.map(r => `| ${r.cat} | ${r.item} | ${r.actual} | ${r.req} | ${yes(r.pass)} | ${r.basis} |`).join('\n') +
          (c.failCount ? '\n\n### 整改建议\n' + c.rows.filter(r => !r.pass).map((r, k) => `${k + 1}. **${r.item}**：设计值 ${r.actual}，应满足"${r.req}"（${r.basis}），请修改相关图纸并在校审记录中闭合。`).join('\n') : '\n\n[OK] 校核项均满足要求。') +
          `\n\n> 本校核为设计自查辅助，规则已简化，不替代施工图审查；涉及强制性条文以规范原文为准。`; } },

    { id: 'review', name: '三级校审', short: '三级校审', icon: 'ri-shield-check-line', stage: '施工图设计', tool: 'records', kind: 'review',
      desc: '按设计院质量管理体系执行校对、审核、审定三级校审，登记校审意见、设计人回复与闭合状态，输出校审记录单。',
      columns: [{ key: 'no', label: '编号', auto: true }, { key: 'level', label: '校审级别', type: 'select', options: REVIEW_LEVELS }, { key: 'discipline', label: '专业', type: 'select', options: Object.keys(DISCIPLINES) },
        { key: 'sheet', label: '图号', type: 'text', default: '建施-03' }, { key: 'opinion', label: '校审意见', type: 'textarea', default: '首层东侧疏散楼梯至最近安全出口距离未标注，请补充并复核疏散距离。' },
        { key: 'category', label: '意见类别', type: 'select', options: ['强制性条文', '一般性条文', '建议'] }, { key: 'reviewer', label: '校审人', type: 'text', default: '张工' },
        { key: 'reply', label: '设计人回复', type: 'text', default: '' }, { key: 'status', label: '状态', type: 'select', options: ['待回复', '已修改', '已闭合'], inline: true }],
      summary: (list, p) => { const by = l => list.filter(x => x.level === l); const open = list.filter(x => x.status !== '已闭合'); const forced = open.filter(x => x.category === '强制性条文');
        return `## 设计文件校审记录单\n\n**工程名称：** ${pname(p)}　**工程编号：** ${(p && p.code) || '—'}　**设计阶段：** ${(p && p.stage) || '施工图设计'}\n\n| 校审级别 | 意见条数 | 未闭合 |\n|---|---|---|\n` + REVIEW_LEVELS.map(l => `| ${l} | ${by(l).length} | ${by(l).filter(x => x.status !== '已闭合').length} |`).join('\n') +
          `\n\n${forced.length ? `[NG] 存在 **${forced.length}** 条未闭合的强制性条文意见，**不得出图**。` : open.length ? `[!] 尚有 ${open.length} 条意见未闭合。` : '[OK] 全部校审意见已闭合，可签署出图。'}\n\n| 编号 | 级别 | 专业 | 图号 | 校审意见 | 类别 | 校审人 | 设计人回复 | 状态 |\n|---|---|---|---|---|---|---|---|---|\n` +
          list.map(x => `| ${x.no} | ${x.level} | ${x.discipline} | ${x.sheet} | ${x.opinion} | ${x.category} | ${x.reviewer} | ${x.reply || '—'} | ${x.status} |`).join('\n') +
          `\n\n| 设计 | 校对 | 审核 | 审定 |\n|---|---|---|---|\n| ${(p && p.leader) || ''} | | | |`; } },

    { id: 'drawings', name: '图纸目录与图号管理', short: '图纸目录', icon: 'ri-file-list-3-line', stage: '施工图设计', tool: 'records', kind: 'drawings',
      desc: '按建施 / 结施 / 水施 / 暖施 / 电施编排图号，登记图幅、比例、版次与出图状态，检查必备图纸，统计折合 A1 张数，导出图纸目录。',
      columns: [{ key: 'no', label: '图号', auto: true }, { key: 'discipline', label: '专业', type: 'select', options: Object.keys(DISCIPLINES) }, { key: 'title', label: '图纸名称', type: 'text', default: '二层平面图' },
        { key: 'size', label: '图幅', type: 'select', options: Object.keys(SHEET_A1), default: 'A1' }, { key: 'scale', label: '比例', type: 'select', options: ['1:100', '1:50', '1:20', '1:500', '1:200', '-'] },
        { key: 'version', label: '版次', type: 'text', default: '第1版', readonly: true }, { key: 'date', label: '出图日期', type: 'date' }, { key: 'status', label: '状态', type: 'select', options: ['设计中', '校审中', '已出图', '已作废'], inline: true }],
      revise: true,
      summary: (list, p) => { const c = drawingCheck(list); const sorted = Object.keys(DISCIPLINES).flatMap(d => list.filter(x => x.discipline === d && x.status !== '已作废').sort((a, b) => a.no.localeCompare(b.no)));
        return `## 图纸目录\n\n**工程名称：** ${pname(p)}　**工程编号：** ${(p && p.code) || '—'}　**设计阶段：** 施工图设计\n\n| 序号 | 图号 | 图纸名称 | 图幅 | 比例 | 版次 | 出图日期 | 备注 |\n|---|---|---|---|---|---|---|---|\n` +
          sorted.map((x, k) => `| ${k + 1} | ${x.no} | ${x.title} | ${x.size} | ${x.scale} | ${x.version} | ${x.date || ''} | ${x.status} |`).join('\n') +
          `\n\n共 **${c.count}** 张，折合 A1 图 **${c.a1.toFixed(2)}** 张。\n\n### 完整性检查\n- 专业：${c.missingDisc.length ? '[!] 缺少 ' + c.missingDisc.map(d => DISCIPLINES[d]).join('、') : '[OK] 五专业齐全'}\n- 建施必备图纸：${c.missingArch.length ? '[!] 缺少 ' + c.missingArch.join('、') : '[OK] 齐全'}`; } },

    { id: 'plancheck', name: '施工图审查意见回复', short: '图审回复', icon: 'ri-file-shield-2-line', stage: '施工图设计',
      desc: '粘贴施工图审查机构出具的审查意见，逐条匹配规范条文，生成审查意见回复单（含修改图号），用于复审送审。',
      fields: [F.s('discipline', '专业', Object.keys(DISCIPLINES)), F.t('agency', '审查机构', '某市建设工程施工图审查中心'), F.t('round', '审查轮次', '第一次审查'),
        F.a('opinions', '审查意见（每行一条）', '1. 首层东侧房间疏散门至最近安全出口距离超过规范限值。（强制性条文）\n2. 屋顶平台临空处栏杆高度标注为 1.05m，不满足要求。\n3. 主入口无障碍坡道坡度未注明。\n4. 外墙保温材料燃烧性能等级未注明，节能计算书窗墙比与图纸不一致。\n5. 地下室防水等级及设防做法未明确。')],
      prompt: (i, p) => `作为设计单位${i.discipline}专业负责人，对${i.agency}${i.round}意见逐条回复（意见、条文类别、规范依据、回复内容、修改图号）。工程：${pname(p)}。\n${i.opinions}`,
      mock: (i, p) => { const r = planCheckReply(i.opinions);
        return `## 施工图审查意见回复单\n\n| 工程名称 | ${pname(p)} | 工程编号 | ${(p && p.code) || '—'} |\n|---|---|---|---|\n| 审查机构 | ${i.agency} | 审查轮次 | ${i.round} |\n| 专业 | ${i.discipline} | 回复日期 | ${today()} |\n\n| 序号 | 审查意见 | 条文类别 | 规范依据 | 设计回复 | 修改图号 |\n|---|---|---|---|---|---|\n` +
          r.map(x => `| ${x.no} | ${x.opinion} | ${x.type} | ${x.basis} | ${x.reply} | ${x.sheet} |`).join('\n') +
          `\n\n共 ${r.length} 条，其中强制性条文 ${r.filter(x => x.type === '强制性条文').length} 条。修改后图纸加盖"修改"标识并按版次更新图纸目录。\n\n| 设计人 | 专业负责人 | 项目负责人 | 设计单位（盖章） |\n|---|---|---|---|\n| | | ${(p && p.leader) || ''} | |`; } },

    /* ---------- 施工配合 ---------- */
    { id: 'change', name: '设计变更单 / 技术核定单', short: '变更核定', icon: 'ri-file-edit-line', stage: '施工配合', tool: 'records', kind: 'change',
      desc: '编制设计变更通知单（设计单位发出）与技术核定单（施工单位提出、设计确认），自动编号，记录涉及图号、原因与造价影响，生成标准单据。',
      columns: [{ key: 'no', label: '编号', auto: true }, { key: 'form', label: '单据类型', type: 'select', options: ['设计变更单', '技术核定单'] }, { key: 'discipline', label: '专业', type: 'select', options: Object.keys(DISCIPLINES) },
        { key: 'sheet', label: '涉及图号', type: 'text', default: '建施-05' }, { key: 'reason', label: '变更原因', type: 'select', options: ['建设单位要求', '设计优化完善', '现场条件变化', '施工图审查意见', '施工单位建议', '材料设备替换'] },
        { key: 'content', label: '变更 / 核定内容', type: 'textarea', default: '二层 3~5/C~D 轴卫生间隔墙由 200 厚加气混凝土砌块改为 100 厚轻钢龙骨石膏板隔墙，做法详见建施-12 节点 3。' },
        { key: 'costImpact', label: '造价影响', type: 'select', options: ['无', '增加', '减少'] }, { key: 'amount', label: '估算金额（万元）', type: 'number', default: 0 },
        { key: 'date', label: '日期', type: 'date' }, { key: 'status', label: '状态', type: 'select', options: ['编制中', '已签发', '已实施'], inline: true }],
      doc: (x, p) => `## ${x.form === '设计变更单' ? '设计变更通知单' : '技术核定单'}\n\n| 工程名称 | ${pname(p)} | 编号 | ${x.no} |\n|---|---|---|---|\n| 建设单位 | ${(p && p.client) || ''} | 专业 | ${x.discipline} |\n| 涉及图号 | ${x.sheet} | 日期 | ${x.date || today()} |\n| ${x.form === '设计变更单' ? '变更原因' : '提出原因'} | ${x.reason} | 造价影响 | ${x.costImpact}${x.costImpact !== '无' ? '（约 ' + x.amount + ' 万元）' : ''} |\n\n### ${x.form === '设计变更单' ? '变更内容' : '核定内容'}\n${x.content}\n\n${x.form === '技术核定单' ? '### 设计单位意见\n□ 同意　□ 不同意　□ 按以下意见修改：\n\n' : ''}| 设计人 | 专业负责人 | 项目负责人 | 设计单位（章） |\n|---|---|---|---|\n| | | ${(p && p.leader) || ''} | |\n| **建设单位** | **监理单位** | **施工单位** | |\n| | | | |\n\n> 本单为施工图的组成部分，与原图具有同等效力；涉及结构安全、消防、节能等内容的重大变更须报原施工图审查机构审查。`,
      summary: (list, p) => `## 设计变更 / 技术核定汇总表\n\n**工程名称：** ${pname(p)}\n\n| 编号 | 类型 | 专业 | 涉及图号 | 原因 | 造价影响 | 金额（万元） | 状态 |\n|---|---|---|---|---|---|---|---|\n` + list.map(x => `| ${x.no} | ${x.form} | ${x.discipline} | ${x.sheet} | ${x.reason} | ${x.costImpact} | ${x.costImpact === '减少' ? '-' : ''}${x.amount} | ${x.status} |`).join('\n') + `\n\n设计变更 ${list.filter(x => x.form === '设计变更单').length} 份，技术核定 ${list.filter(x => x.form === '技术核定单').length} 份；造价影响合计 **${list.reduce((s, x) => s + (x.costImpact === '增加' ? 1 : x.costImpact === '减少' ? -1 : 0) * num(x.amount), 0).toFixed(2)} 万元**。` },

    { id: 'service', name: '现场服务记录', short: '现场服务', icon: 'ri-hammer-line', stage: '施工配合', tool: 'records', kind: 'service',
      desc: '记录设计交底、图纸会审、现场巡查、隐蔽验收配合等现场服务，登记问题与处理意见，生成现场服务记录表及周报。',
      columns: [{ key: 'no', label: '编号', auto: true }, { key: 'date', label: '日期', type: 'date' }, { key: 'type', label: '服务类型', type: 'select', options: ['设计交底', '图纸会审', '现场巡查', '隐蔽工程验收配合', '分部工程验收', '专题协调会'] },
        { key: 'location', label: '部位', type: 'text', default: '地下室底板 / 3~8 轴' }, { key: 'attendees', label: '参加单位及人员', type: 'text', default: '建设单位李工、监理单位赵工、施工单位陈工、设计单位' },
        { key: 'issue', label: '现场问题', type: 'textarea', default: '后浇带两侧止水钢板搭接长度不足，局部未满焊。' }, { key: 'advice', label: '处理意见', type: 'textarea', default: '按结施-02 说明要求整改，止水钢板搭接不小于 50mm 且双面满焊，整改后报监理验收。' },
        { key: 'needChange', label: '是否需出变更', type: 'select', options: ['否', '是'] }, { key: 'status', label: '状态', type: 'select', options: ['待整改', '整改中', '已闭合'], inline: true }],
      doc: (x, p) => `## 设计单位现场服务记录表\n\n| 工程名称 | ${pname(p)} | 编号 | ${x.no} |\n|---|---|---|---|\n| 日期 | ${x.date || today()} | 服务类型 | ${x.type} |\n| 部位 | ${x.location} | 是否需出变更 | ${x.needChange} |\n| 参加单位及人员 | ${x.attendees} | | |\n\n### 现场问题\n${x.issue}\n\n### 处理意见\n${x.advice}\n\n| 设计代表（签字） | 建设单位 | 监理单位 | 施工单位 |\n|---|---|---|---|\n| | | | |`,
      summary: (list, p) => `## 现场服务周报\n\n**工程名称：** ${pname(p)}　**统计日期：** ${today()}\n\n- 现场服务 ${list.length} 次，问题闭合 ${list.filter(x => x.status === '已闭合').length} 项，未闭合 ${list.filter(x => x.status !== '已闭合').length} 项；需出变更 ${list.filter(x => x.needChange === '是').length} 项。\n\n| 编号 | 日期 | 类型 | 部位 | 问题 | 处理意见 | 状态 |\n|---|---|---|---|---|---|---|\n` + list.map(x => `| ${x.no} | ${x.date} | ${x.type} | ${x.location} | ${x.issue} | ${x.advice} | ${x.status} |`).join('\n') },

    /* ---------- 竣工 ---------- */
    { id: 'completion', name: '竣工验收（设计单位）', short: '竣工验收', icon: 'ri-award-line', stage: '竣工', usesProject: true,
      desc: '汇总本项目图纸、校审、变更与现场服务记录，检查未闭合事项，生成《设计单位工程质量检查报告》及竣工验收配合清单。',
      fields: [F.t('acceptDate', '竣工验收日期', ''), F.t('structure', '结构形式', '钢筋混凝土框架结构'), F.t('fireCategory', '耐火等级 / 建筑分类', '一级 / 单、多层公共建筑'),
        F.yn('fireAccept', '已完成消防验收配合'), F.yn('energyAccept', '已完成节能分部验收配合'), F.yn('planVerify', '已完成规划条件核实配合', '否'), F.yn('archive', '已移交竣工图编制所需资料', '否')],
      prompt: (i, p) => `撰写设计单位工程质量检查报告（竣工验收用），工程：${pname(p)}，信息：${JSON.stringify(i)}`,
      mock: (i, p, ctx) => { const r = (p && p.records) || {}; const ch = r.change || [], sv = r.service || [], rv = r.review || [], dw = r.drawings || [];
        const openCh = ch.filter(x => x.status !== '已实施'), openSv = sv.filter(x => x.status !== '已闭合'), openRv = rv.filter(x => x.status !== '已闭合');
        const items = [['消防验收配合', i.fireAccept], ['建筑节能分部工程验收配合', i.energyAccept], ['规划条件核实（规划验收）配合', i.planVerify], ['竣工图编制资料移交', i.archive]];
        const ready = !openCh.length && !openSv.length && !openRv.length && items.every(x => x[1] === '是');
        return `## 设计单位工程质量检查报告\n\n（用于工程竣工验收）\n\n| 工程名称 | ${pname(p)} | 工程编号 | ${(p && p.code) || '—'} |\n|---|---|---|---|\n| 建设单位 | ${(p && p.client) || ''} | 建设地点 | ${(p && p.location) || ''} |\n| 建筑面积 | ${(p && p.area) || ''} ㎡ | 结构形式 | ${i.structure} |\n| 耐火等级/分类 | ${i.fireCategory} | 验收日期 | ${i.acceptDate || today()} |\n\n### 一、设计文件情况\n本工程施工图共 ${dw.filter(x => x.status !== '已作废').length} 张（折合 A1 ${drawingCheck(dw).a1.toFixed(2)} 张），已通过施工图设计文件审查；三级校审意见 ${rv.length} 条，未闭合 ${openRv.length} 条。\n\n### 二、设计变更情况\n共签发设计变更单 ${ch.filter(x => x.form === '设计变更单').length} 份、技术核定单 ${ch.filter(x => x.form === '技术核定单').length} 份，未实施 ${openCh.length} 份。\n` + (ch.length ? ch.map(x => `- ${x.no}（${x.discipline}，${x.sheet}）：${x.status}`).join('\n') : '- 无') +
          `\n\n### 三、现场服务情况\n设计单位共参加现场服务 ${sv.length} 次，未闭合问题 ${openSv.length} 项。\n\n### 四、竣工验收配合事项\n| 事项 | 完成情况 |\n|---|---|\n` + items.map(x => `| ${x[0]} | ${x[1] === '是' ? '[OK] 已完成' : '[!] 未完成'} |`).join('\n') +
          `\n\n### 五、检查结论\n${ready ? '经检查，本工程施工符合设计文件及设计变更要求，设计单位**同意**参加竣工验收。' : `[!] 尚有未闭合事项（变更 ${openCh.length}、现场问题 ${openSv.length}、校审意见 ${openRv.length}、配合事项 ${items.filter(x => x[1] !== '是').length}），**闭合后**方可签署本报告。`}\n\n| 项目负责人 | 各专业负责人 | 设计单位（盖章） |\n|---|---|---|\n| ${(p && p.leader) || ''} | | |`; } }
  ];

  /* ================= 大模型接入 ================= */
  const SYSTEM_PROMPT = [
    '你在本工作台中担任 AI 项目主导：主动起草成果、引用规则工具（本地计算）结果、指出需人工确认签字的事项。成果末尾给出“### 下一步建议”（2~4 条）。',
    '你是中国甲级建筑设计院的资深建筑专业负责人（一级注册建筑师），服务于设计院建筑师日常工作。',
    '工作语境：设计阶段按"方案设计—初步设计—施工图设计—施工配合—竣工验收"划分；成果深度遵循《建筑工程设计文件编制深度规定》（2016年版）；院内执行校对、审核、审定三级校审；施工图须经施工图审查机构审查。',
    '常用规范（引用时写全编号与年代号，条文号不确定时只写规范名称并注明"条文号待核"，严禁编造条文号或条文内容）：GB 55031-2022《民用建筑通用规范》、GB 50352-2019《民用建筑设计统一标准》、GB 50016-2014(2018年版)《建筑设计防火规范》、GB 55037-2022《建筑防火通用规范》、GB 55019-2021《建筑与市政工程无障碍通用规范》、GB 50763-2012《无障碍设计规范》、GB 50180-2018《城市居住区规划设计标准》、GB 55015-2021《建筑节能与可再生能源利用通用规范》、GB 55030-2022《建筑与市政工程防水通用规范》、GB 50099-2011《中小学校设计规范》、GB 50096-2011《住宅设计规范》、GB 50368-2005《住宅建筑规范》、GB/T 50353-2013《建筑工程建筑面积计算规范》、GB/T 50378-2019《绿色建筑评价标准》；地方规定（如《成都市规划管理技术规定》）需提示以当地最新版本为准。',
    '输出要求：简体中文、Markdown；以"## 标题"开头；使用"### 一、二、三"分节；关键数据用 Markdown 表格；数值带单位（㎡、m、%、万元）；结论明确，可操作；需由建设单位/主管部门确认的事项单列；不输出与任务无关的寒暄；不使用 emoji。',
    '必须使用下文提供的【项目上下文】中的数据（工程名称、编号、规划条件、指标、记录），不得与之矛盾；缺失信息应列为"待补充"，不得臆造。'
  ].join('\n');
  function buildContext(p) {
    if (!p) return '【项目上下文】无';
    const r = p.records || {}, pl = p.plan || {};
    const L = [`【项目上下文】`, `工程名称：${p.name}；工程编号：${p.code || '—'}；建设单位：${p.client || '—'}；建设地点：${p.location || '—'}；建筑类型：${p.type || '—'}；总建筑面积：${p.area || '—'} ㎡；当前设计阶段：${p.stage || '—'}；项目负责人：${p.leader || '—'}`];
    if (pl.siteArea) L.push(`规划设计条件：规划用地面积 ${pl.siteArea} ㎡，容积率 ≤ ${pl.far}，建筑密度 ≤ ${pl.density}%，绿地率 ≥ ${pl.green}%，建筑限高 ≤ ${pl.height} m`); else L.push('规划设计条件：未录入（待补充）');
    const ind = (p.runs || []).filter(x => x.agent === 'indicators').slice(-1)[0];
    if (ind) { const c = calcIndicators(ind.input); L.push(`最近一次经济技术指标核算：地上计容 ${ind.input.aboveArea} ㎡，地下 ${ind.input.belowArea} ㎡，容积率 ${c.far.toFixed(2)}，建筑密度 ${c.density.toFixed(2)}%，绿地率 ${c.greenRate.toFixed(2)}%，建筑高度 ${ind.input.height} m，机动车位 ${c.car}/${c.carReq}（提供/应配），不满足项 ${c.failCount} 项`); }
    const dw = r.drawings || [], rv = r.review || [], ch = r.change || [], sv = r.service || [];
    if (dw.length) { const d = drawingCheck(dw); L.push(`图纸目录：${d.count} 张（折合 A1 ${d.a1.toFixed(2)} 张）${d.missingDisc.length ? '，缺少专业 ' + d.missingDisc.join('、') : ''}`); }
    if (rv.length) L.push(`三级校审意见：${rv.length} 条，未闭合 ${rv.filter(x => x.status !== '已闭合').length} 条（强条未闭合 ${rv.filter(x => x.category === '强制性条文' && x.status !== '已闭合').length} 条）`);
    if (ch.length) L.push(`设计变更/技术核定：${ch.map(x => `${x.no}（${x.form}，${x.discipline}，${x.sheet}，${x.status}）`).join('；')}`);
    if (sv.length) L.push(`现场服务：${sv.length} 次，未闭合 ${sv.filter(x => x.status !== '已闭合').length} 项`);
    const sg = (p.records && p.records.signoff) || []; if (sg.length) L.push(`人工确认签字：${sg.map(x => `${x.name}（${x.by}）`).join('、')}`);
    return L.join('\n');
  }
  /* 各智能体的专业输出格式要求 */
  const FORMAT = {
    brief: '按以下章节输出：### 一、任务书要点（表格：项目/内容）；### 二、设计范围与各阶段成果深度（表格：阶段/主要成果/深度依据）；### 三、功能面积配置表（表格：功能/任务书面积/建议面积/占比/设计提示，并闭合核算总面积）；### 四、技术要求与专项（绿建、装配式、海绵、人防、节能）；### 五、投资与进度节点（含单方指标测算）；### 六、设计风险；### 七、需建设单位澄清事项（编号列表）。',
    site: '按以下章节输出：### 一、规划设计条件表；### 二、开发容量测算（表格，列出计算式：退线后可建范围、计容面积上限、基底面积上限、绿地面积下限、日照间距）；### 三、场地分析（区位交通、出入口与道路交叉口距离要求、景观、噪声、日照影响）；### 四、SWOT（表格）；### 五、总图布局策略。',
    concept: '按以下章节输出：### 一、约束条件与可建层数（列出计算）；### 二、三个体量方案比选表（方案/布局/基底面积/层数/建筑密度/容积率/高度/是否满足限高/优缺点）；### 三、推荐方案与理由；### 四、下一步验证工作（日照、消防扑救面、流线）。',
    render: '输出：### 正向提示词（英文，代码块）；### 中文画面说明；### 负面提示词（代码块）；### 参数建议（按目标工具）；### 注意事项（效果图须与报批总平面、立面一致）。',
    report: '按所选文件类型的设计院通行格式输出：会议纪要须含表头（工程编号、日期、参会单位、记录人）、议定事项、待办事项表（序号/事项/责任单位/完成时限）及异议反馈条款；工作联系函须含编号、致送单位、事由、正文、落款（设计单位盖章、项目负责人签字）；汇报提纲按汇报顺序分级；方案设计说明按"工程概况、设计依据、总平面、建筑设计、消防、无障碍、节能、绿建"组织。',
    permit: '输出：### 一、申报材料清单（表格：序号/材料名称/提供单位/份数与格式/备注）；### 二、设计单位需重点准备的成果与深度要求；### 三、常见退件原因及规避建议；### 四、提示：以当地工程建设项目审批管理系统办事指南为准。',
    plancheck: '输出施工图审查意见回复单：表头（工程名称、编号、审查机构、轮次、专业、日期）；表格（序号/审查意见/条文类别（强制性条文/一般性条文）/规范依据/设计回复/修改图号）；回复须具体说明修改措施与数值；末尾签字栏（设计人/专业负责人/项目负责人/设计单位盖章）。',
    completion: '输出《设计单位工程质量检查报告》（竣工验收用）：表头工程信息表；### 一、设计文件情况；### 二、施工图审查情况；### 三、设计变更情况（逐条列出上下文中的变更）；### 四、现场服务情况；### 五、竣工验收配合事项（表格）；### 六、检查结论（存在未闭合事项时明确不具备签署条件）；签字盖章栏。',
    indicators: '', cost: '', code: ''
  };
  const NOTE_PROMPT = {
    indicators: '以下是本地规则计算得到的经济技术指标核算结果。请作为项目负责人给出"### AI 说明与建议"：①逐项解读不满足项的原因与调整方向（给出可量化的调整建议，如需减少的计容面积或需增加的绿地面积）；②提示计容规则、地下室出地面高度、架空层等地方计容口径风险；③停车配建提示以当地配建标准为准。不超过 300 字，不要重复整张表。',
    cost: '以下是本地规则计算得到的投资估算/设计概算结果。请给出"### AI 说明与建议"：①单方造价合理性判断（与同类项目区间比较，说明依据为经验区间）；②主要造价风险与优化方向（结构选型、幕墙比例、机电标准、地下室）；③编制依据提示（当地计价依据、CECA/GC 1/2）。不超过 300 字。',
    code: '以下是本地规则计算得到的规范符合性校核结果。请给出"### AI 说明与建议"：①对不满足项逐条给出具体整改措施（如增设安全出口、增设防火分区、调整栏杆高度）；②提示本次简化校核未覆盖但该类建筑应重点复核的条文（如中小学校、住宅的专项规范），条文号不确定时注明"待核"；③强调以施工图审查为准。不超过 350 字。',
    concept: '以下是本地体量试算结果，请给出"### AI 说明与建议"（不超过 250 字）：结合设计意向对推荐方案的空间组织、日照与消防扑救面提出建议。'
  };
  const PROMPT_OVR = {};
  function setPromptOverrides(m) { for (const k in PROMPT_OVR) delete PROMPT_OVR[k]; Object.assign(PROMPT_OVR, m || {}); }
  function promptOf(id) { const o = PROMPT_OVR[id] || {}; return { system: o.system || SYSTEM_PROMPT, format: o.format != null && o.format !== '' ? o.format : (FORMAT[id] || ''), custom: !!(o.system || o.format) }; }
  function buildMessages(agent, input, project, mode = 'full', calcText = '') {
    const ctx = buildContext(project); const PO = promptOf(agent.id); const SYSTEM_PROMPT = PO.system; const FORMAT = { [agent.id]: PO.format };
    if (mode === 'note') return [{ role: 'system', content: SYSTEM_PROMPT }, { role: 'user', content: `${ctx}\n\n【本地计算结果】\n${calcText}\n\n${NOTE_PROMPT[agent.id] || '请给出"### AI 说明与建议"，不超过 300 字。'}` }];
    return [{ role: 'system', content: SYSTEM_PROMPT }, { role: 'user', content: `${ctx}\n\n【任务】${agent.name}\n${agent.prompt(input, project)}\n\n【输入参数】\n${agent.fields.map(f => `- ${f.label}：${input[f.key]}`).join('\n')}\n\n【输出格式】${FORMAT[agent.id] || '专业、结构化输出。'}` }];
  }

  /** 解析 SSE 文本块，返回 {deltas:[], done, rest} */
  function parseSSE(buf) {
    const out = []; let done = false; const parts = buf.split('\n'); const rest = parts.pop();
    for (const line of parts) { const l = line.trim(); if (!l || l.startsWith(':')) continue; if (!l.startsWith('data:')) continue; const d = l.slice(5).trim();
      if (d === '[DONE]') { done = true; continue; } try { const j = JSON.parse(d); if (j.error) { out.push({ error: j.error.message || String(j.error) }); continue; } const ch = j.choices && j.choices[0]; if (!ch) continue; const dl = ch.delta || {}; out.push({ content: dl.content || '', reasoning: dl.reasoning_content || '', finish: ch.finish_reason }); } catch { /* 忽略不完整 */ } }
    return { deltas: out, done, rest };
  }
  const chatUrl = ep => { const e = String(ep).replace(/\/+$/, ''); return /\/chat\/completions$/.test(e) ? e : e + '/chat/completions'; };

  /** LLM 调用（OpenAI 兼容）。opts: {messages|prompt, stream, onDelta(text, info), signal, fetchImpl}
   *  未配置返回 null；失败抛错（含超时）。timeout 为首字超时（秒），总时长上限为 timeout×5。 */
  async function callLLM(settings, promptOrOpts, fetchImpl) {
    const o = typeof promptOrOpts === 'string' ? { prompt: promptOrOpts } : (promptOrOpts || {});
    if (!settings || !settings.apiKey || !settings.endpoint) return null;
    const f = o.fetchImpl || fetchImpl || (typeof fetch !== 'undefined' ? fetch : null);
    const messages = o.messages || [{ role: 'system', content: SYSTEM_PROMPT }, { role: 'user', content: o.prompt }];
    const stream = !!o.stream && settings.stream !== false;
    const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const first = (settings.timeout || 90) * 1000; let reason = '';
    const abort = r => { reason = r; ctrl && ctrl.abort(); };
    if (o.signal) o.signal.addEventListener('abort', () => abort('已取消'));
    let timer = setTimeout(() => abort(`等待模型响应超时（${settings.timeout || 90} 秒）`), first);
    const hard = setTimeout(() => abort('生成总时长超时'), first * 5);
    try {
      const body = { model: settings.model || 'deepseek-chat', temperature: num(settings.temperature, 0.3), stream, messages };
      if (settings.maxTokens) body.max_tokens = +settings.maxTokens;
      let r;
      try { r = await f(chatUrl(settings.endpoint), { method: 'POST', signal: ctrl && ctrl.signal, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + settings.apiKey, Accept: stream ? 'text/event-stream' : 'application/json' }, body: JSON.stringify(body) }); }
      catch (e) { throw new Error(reason || ('网络错误：' + (e.message || e))); }
      if (!r.ok) { let msg = ''; try { const j = await r.json(); msg = (j.error && (j.error.message || j.error)) || ''; } catch { } throw new Error(`HTTP ${r.status}${msg ? '：' + msg : ''}${r.status === 401 ? '（API Key 无效）' : r.status === 402 ? '（余额不足）' : r.status === 429 ? '（请求过于频繁）' : r.status === 503 ? '（模型服务繁忙，请稍后重试）' : ''}`); }
      const ct = (r.headers && r.headers.get && r.headers.get('content-type')) || '';
      if (stream && r.body && r.body.getReader && !/application\/json/.test(ct)) {
        const reader = r.body.getReader(); const dec = new TextDecoder(); let buf = '', text = '', gotFirst = false;
        try {
          for (;;) { const { value, done } = await reader.read(); if (done) break; buf += dec.decode(value, { stream: true }); const p = parseSSE(buf); buf = p.rest;
            for (const d of p.deltas) { if (d.error) throw new Error('模型返回错误：' + d.error); if ((d.content || d.reasoning) && !gotFirst) { gotFirst = true; clearTimeout(timer); timer = null; }
              if (d.content) { text += d.content; o.onDelta && o.onDelta(text, { phase: 'content' }); } else if (d.reasoning) o.onDelta && o.onDelta(text, { phase: 'reasoning' }); }
            if (p.done) break; }
        } catch (e) { if (/^模型返回错误/.test(e.message)) throw e; if (text && !reason) return text; throw new Error(reason || ('流式读取中断：' + (e.message || e))); }
        if (!text) throw new Error(reason || '模型未返回内容');
        return text;
      }
      let j; try { j = await r.json(); } catch (e) { throw new Error(reason || '响应解析失败'); }
      const t = j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content; if (!t) throw new Error('模型未返回内容');
      o.onDelta && o.onDelta(t, { phase: 'content' }); return t;
    } finally { timer && clearTimeout(timer); clearTimeout(hard); }
  }
  async function listModels(settings, fetchImpl) {
    const f = fetchImpl || fetch; const base = String(settings.endpoint).replace(/\/+$/, '').replace(/\/chat\/completions$/, '');
    const r = await f(base + '/models', { headers: { Authorization: 'Bearer ' + settings.apiKey } }); if (!r.ok) throw new Error('HTTP ' + r.status);
    const j = await r.json(); return (j.data || []).map(x => x.id);
  }
  /** 运行智能体：生成式走 LLM（失败回退模拟）；规则型本地计算，可选追加 AI 说明与建议 */
  async function runAgent(agent, input, project, settings, fetchImpl, hooks = {}) {
    const useLLM = settings && settings.mode === 'llm' && settings.apiKey;
    const opt = m => ({ agentId: agent.id, messages: m, stream: hooks.stream, onDelta: hooks.onDelta, signal: hooks.signal, fetchImpl });
    if (useLLM && agent.deterministic && settings.localCalc !== false) {
      const calc = enrichMock(agent, agent.mock(input, project), project);
      if (settings.aiNotes === false) return { text: calc, source: 'calc' };
      hooks.onDelta && hooks.onDelta(calc, { phase: 'calc' });
      try { const note = await api.callLLM(settings, { ...opt(buildMessages(agent, input, project, 'note', calc)), onDelta: hooks.onDelta && ((t, i) => hooks.onDelta(calc + '\n\n' + t, i)) });
        return { text: calc + '\n\n' + note.replace(/^#{1,2}\s/m, '### '), source: 'calc+llm' }; }
      catch (e) { return { text: calc + `\n\n> AI 说明与建议生成失败：${e.message || e}`, source: 'calc', error: String(e.message || e) }; }
    }
    if (useLLM) {
      try { const t = await api.callLLM(settings, opt(buildMessages(agent, input, project)), fetchImpl); if (t) return { text: t, source: 'llm' }; }
      catch (e) { return { text: enrichMock(agent, agent.mock(input, project), project), source: 'mock', error: String(e.message || e) }; }
    }
    return { text: enrichMock(agent, agent.mock(input, project), project), source: agent.deterministic ? 'calc' : 'mock' };
  }

  /* 表单分组（界面分组展示用） */
  const GROUPS = {
    brief: [['任务书原文', 'ri-file-text-line', ['brief']], ['分析设置', 'ri-equalizer-line', ['scope', 'focus']]],
    site: [['项目与区位', 'ri-map-pin-line', ['location', 'climate', 'citySize', 'landUse']], ['用地与规划指标', 'ri-ruler-2-line', ['siteArea', 'siteWidth', 'siteDepth', 'far', 'density', 'green', 'height']], ['退线与日照', 'ri-sun-line', ['setbackN', 'setbackS', 'setbackE', 'setbackW', 'sunCoef']], ['周边环境', 'ri-community-line', ['surround']]],
    concept: [['规划约束', 'ri-road-map-line', ['siteArea', 'far', 'density', 'height']], ['设计参数', 'ri-shape-line', ['gfa', 'floorHeight', 'theme']]],
    render: [['建筑描述', 'ri-building-line', ['subject']], ['画面设置', 'ri-camera-lens-line', ['view', 'style', 'time', 'tool']]],
    report: [['文件设置', 'ri-file-settings-line', ['kind', 'audience', 'tone']], ['要点', 'ri-list-check-2', ['points']]],
    indicators: [['用地与面积', 'ri-ruler-2-line', ['siteArea', 'aboveArea', 'belowArea', 'footprint', 'greenArea']], ['高度与层数', 'ri-building-2-line', ['height', 'floorsAbove', 'floorsBelow']], ['规划条件', 'ri-road-map-line', ['farLimit', 'densityLimit', 'greenLimit', 'heightLimit']], ['停车配建', 'ri-parking-box-line', ['carRate', 'carAbove', 'carBelow', 'bikeRate', 'bikeProvided']]],
    cost: [['编制依据', 'ri-file-settings-line', ['stage', 'type', 'region', 'grade']], ['建筑面积', 'ri-ruler-2-line', ['aboveArea', 'belowArea']], ['费用参数', 'ri-percent-line', ['infraFee', 'contRate']]],
    permit: [['申报事项', 'ri-government-line', ['matter']], ['专项要求', 'ri-checkbox-multiple-line', ['civilDefense', 'green', 'sponge', 'prefab']]],
    code: [['建筑分类', 'ri-building-2-line', ['use', 'height', 'important', 'basement', 'fireRating']], ['防火与疏散 · GB 50016', 'ri-fire-line', ['btype', 'sprinkler', 'hall', 'singleOrFirst', 'compArea', 'basementComp', 'exits', 'evacDist', 'deadEnd', 'fireLane', 'rescueSite']], ['通用与无障碍 · GB 55031 / GB 50352 / GB 55019', 'ri-wheelchair-line', ['railHeight', 'clearHeight', 'riser', 'ramp', 'accessEntry']], ['日照 · GB 50180', 'ri-sun-line', ['climate', 'citySize', 'sunHours', 'southHeight', 'spacing', 'sunCoef']]],
    plancheck: [['审查信息', 'ri-file-shield-2-line', ['discipline', 'agency', 'round']], ['审查意见', 'ri-chat-check-line', ['opinions']]],
    completion: [['工程信息', 'ri-building-2-line', ['acceptDate', 'structure', 'fireCategory']], ['验收配合事项', 'ri-checkbox-multiple-line', ['fireAccept', 'energyAccept', 'planVerify', 'archive']]]
  };
  function fieldGroups(a) {
    const g = GROUPS[a.id] || [['参数', 'ri-equalizer-line', a.fields.map(f => f.key)]]; const used = new Set();
    const out = g.map(([title, icon, keys]) => ({ title, icon, fields: keys.map(k => { used.add(k); return a.fields.find(f => f.key === k); }).filter(Boolean) }));
    const rest = a.fields.filter(f => !used.has(f.key)); if (rest.length) out.push({ title: '其他', icon: 'ri-more-line', fields: rest });
    return out;
  }

  const api = { setPromptOverrides, promptOf, FORMAT, fieldGroups, SYSTEM_PROMPT, buildContext, buildMessages, parseSSE, listModels, chatUrl, AGENTS, STAGES, BUILD_TYPES, CLIMATES, COST_BASE, REGION_FACTOR, GRADE_FACTOR, DISCIPLINES, SHEET_A1, REVIEW_LEVELS,
    sunlightStandard, siteCapacity, massingOptions, calcIndicators, fireClass, evacLimit, compartmentLimit, sunlightByType, derivedIndicators, setPrices, resetPrices, PRICE_DEFAULTS, projectInsight, enrichMock, checkCompliance, estimateCost, drawingNo, drawingCheck, planCheckReply, permitList, recordNo, md, callLLM, runAgent };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.AW = api;
})(this);
