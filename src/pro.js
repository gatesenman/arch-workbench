/* v2.6 工具：任务书导入（docx/txt/pdf 文本）、成果版本对比、全局成果检索、成果包打包 */
(function (root, factory) { const m = factory(); if (typeof module === 'object' && module.exports) module.exports = m; else root.AW_PRO = m; })(typeof self !== 'undefined' ? self : globalThis, function () {
  const isNode = typeof process !== 'undefined' && process.versions && process.versions.node && typeof window === 'undefined';
  async function inflateRaw(u8) {
    if (isNode) return new Uint8Array(require('zlib').inflateRawSync(Buffer.from(u8)));
    const ds = new DecompressionStream('deflate-raw'); return new Uint8Array(await new Response(new Blob([u8]).stream().pipeThrough(ds)).arrayBuffer());
  }
  async function inflateZ(u8) {
    if (isNode) return new Uint8Array(require('zlib').inflateSync(Buffer.from(u8)));
    const ds = new DecompressionStream('deflate'); return new Uint8Array(await new Response(new Blob([u8]).stream().pipeThrough(ds)).arrayBuffer());
  }
  const dec = u8 => new TextDecoder('utf-8').decode(u8);
  /* 读 zip 中央目录，取出指定文件 */
  async function unzipEntry(u8, name) {
    const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength); let e = u8.length - 22;
    while (e >= 0 && dv.getUint32(e, true) !== 0x06054b50) e--; if (e < 0) throw new Error('不是有效的 zip/docx 文件');
    const cnt = dv.getUint16(e + 10, true); let off = dv.getUint32(e + 16, true);
    for (let k = 0; k < cnt; k++) {
      const method = dv.getUint16(off + 10, true), csize = dv.getUint32(off + 20, true), nl = dv.getUint16(off + 28, true), xl = dv.getUint16(off + 30, true), cl = dv.getUint16(off + 32, true), lo = dv.getUint32(off + 42, true);
      const n = dec(u8.subarray(off + 46, off + 46 + nl));
      if (n === name) { const lnl = dv.getUint16(lo + 26, true), lxl = dv.getUint16(lo + 28, true); const data = u8.subarray(lo + 30 + lnl + lxl, lo + 30 + lnl + lxl + csize); return method === 0 ? data : await inflateRaw(data); }
      off += 46 + nl + xl + cl;
    } return null;
  }
  async function docxText(u8) {
    const x = await unzipEntry(u8, 'word/document.xml'); if (!x) throw new Error('docx 中未找到正文');
    return dec(x).replace(/<w:tab\/>/g, '\t').replace(/<\/w:p>/g, '\n').replace(/<w:br\/>/g, '\n').replace(/<[^>]+>/g, '')
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&').replace(/\n{3,}/g, '\n\n').trim();
  }
  /* PDF 文本：尽力提取（FlateDecode 流中的 Tj/TJ 文本；扫描件需 OCR） */
  async function pdfText(u8) {
    const raw = new TextDecoder('latin1').decode(u8); const out = [];
    const re = /stream\r?\n/g; let m;
    while ((m = re.exec(raw))) {
      const start = m.index + m[0].length, end = raw.indexOf('endstream', start); if (end < 0) break;
      const head = raw.slice(Math.max(0, m.index - 300), m.index); let e2 = end; while (e2 > start && (u8[e2 - 1] === 10 || u8[e2 - 1] === 13)) e2--; let body = u8.subarray(start, e2);
      if (/FlateDecode/.test(head)) { try { body = await inflateZ(body); } catch { continue; } }
      const t = new TextDecoder('latin1').decode(body);
      const parts = []; t.replace(/\[((?:\\.|[^\]])*)\]\s*TJ|\(((?:\\.|[^)])*)\)\s*Tj|(T\*|ET)/g, (_, arr, s, br) => {
        if (br) parts.push('\n'); else if (s != null) parts.push(unesc(s)); else arr.replace(/\(((?:\\.|[^)])*)\)/g, (_, q) => parts.push(unesc(q))); return ''; });
      const txt = parts.join(''); if (txt.trim()) out.push(txt);
      re.lastIndex = end;
    }
    let s = out.join('\n');
    if (/[\u00c0-\u00ff]{4,}/.test(s)) { try { const b = Uint8Array.from(s, c => c.charCodeAt(0) & 255); const u = new TextDecoder('utf-8', { fatal: true }).decode(b); s = u; } catch {} }
    return s.replace(/\n{3,}/g, '\n\n').trim();
  }
  function unesc(s) { return s.replace(/\\([nrtbf()\\]|\d{1,3})/g, (_, c) => ({ n: '\n', r: '', t: '\t', b: '', f: '', '(': '(', ')': ')', '\\': '\\' }[c] ?? String.fromCharCode(parseInt(c, 8)))); }
  function sniffText(u8) { // txt：UTF-8 优先，失败回退 GB18030
    try { return new TextDecoder('utf-8', { fatal: true }).decode(u8).replace(/^\ufeff/, ''); } catch { try { return new TextDecoder('gb18030').decode(u8); } catch { return dec(u8); } } }
  async function extractText(name, u8) {
    const ext = String(name).toLowerCase().split('.').pop();
    if (ext === 'docx') return { text: await docxText(u8), kind: 'docx' };
    if (ext === 'pdf') { const t = await pdfText(u8); return { text: t, kind: 'pdf', warn: t.length < 20 ? 'PDF 未提取到文字（可能为扫描件），请复制粘贴原文或先做 OCR' : '' }; }
    if (ext === 'doc') throw new Error('暂不支持旧版 .doc，请另存为 .docx');
    return { text: sniffText(u8), kind: 'txt' };
  }
  /* 行级 diff（LCS） */
  function diffLines(a, b) {
    const A = String(a || '').split('\n'), B = String(b || '').split('\n'); const n = A.length, m = B.length;
    if (n * m > 4e6) return [...A.map(t => ({ op: '-', t })), ...B.map(t => ({ op: '+', t }))];
    const L = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = A[i] === B[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
    const out = []; let i = 0, j = 0;
    while (i < n && j < m) { if (A[i] === B[j]) { out.push({ op: '=', t: A[i] }); i++; j++; } else if (L[i + 1][j] >= L[i][j + 1]) out.push({ op: '-', t: A[i++] }); else out.push({ op: '+', t: B[j++] }); }
    while (i < n) out.push({ op: '-', t: A[i++] }); while (j < m) out.push({ op: '+', t: B[j++] });
    return out;
  }
  const diffStat = d => ({ add: d.filter(x => x.op === '+').length, del: d.filter(x => x.op === '-').length });
  /* 全局成果检索 */
  function searchOutputs(projects, q, names = {}, limit = 30) {
    q = String(q || '').trim().toLowerCase(); if (q.length < 2) return [];
    const hits = [];
    for (const p of projects) for (const r of (p.runs || [])) {
      const t = String(r.text || ''); const k = t.toLowerCase().indexOf(q); if (k < 0) continue;
      const a = Math.max(0, k - 18); const snip = (a ? '…' : '') + t.slice(a, k + q.length + 30).replace(/[#*|>\n]+/g, ' ').trim();
      hits.push({ project: p.id, pname: p.name, code: p.code, run: r.id, agent: r.agent, name: names[r.agent] || r.title || r.agent, time: r.time, snip, count: t.toLowerCase().split(q).length - 1 });
    }
    return hits.sort((x, y) => y.count - x.count || String(y.time).localeCompare(String(x.time))).slice(0, limit);
  }
  function versionsOf(p, agent) { return (p.runs || []).filter(r => r.agent === agent).slice().reverse(); }
  /* 项目文档包：每个智能体最新成果一份 docx + 目录说明 */
  function buildPackage(p, names, DOCX, date) {
    const latest = {}; for (const r of (p.runs || [])) latest[r.agent] = r;
    const files = []; const idx = [`# ${p.code || ''} ${p.name} 设计成果文件包`, '', `生成日期：${date}　阶段：${p.stage || ''}`, '', '| 序号 | 文件 | 来源 | 生成时间 |', '|---|---|---|---|'];
    Object.values(latest).forEach((r, k) => {
      const title = names[r.agent] || r.title || r.agent; const fn = `${String(k + 1).padStart(2, '0')}-${title}.docx`.replace(/[\\/:*?"<>|]/g, '_');
      const note = r.source === 'mock' ? '> 【模拟输出】本内容由离线引擎生成，仅供参考。\n\n' : '';
      files.push([fn, DOCX.build(note + r.text, { title, project: p.name, code: p.code, stage: p.stage, date })]);
      idx.push(`| ${k + 1} | ${fn} | ${r.source} | ${r.time || ''} |`);
    });
    const recs = p.records || {}; const rc = Object.entries(recs).filter(([, v]) => Array.isArray(v) && v.length);
    if (rc.length) { idx.push('', '## 项目记录', ...rc.map(([k, v]) => `- ${k}：${v.length} 条`)); }
    files.unshift(['00-文件目录.md', idx.join('\n')]);
    return { bytes: DOCX.zip(files), count: files.length - 1 };
  }
  return { extractText, docxText, pdfText, unzipEntry, diffLines, diffStat, searchOutputs, versionsOf, buildPackage };
});
