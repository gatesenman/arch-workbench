/* 最小 OOXML .docx 导出（院标页眉 + Markdown 粗转 Word XML） */
(function (root, factory) { const m = factory(); if (typeof module === 'object' && module.exports) module.exports = m; else root.AW_DOCX = m; })(typeof self !== 'undefined' ? self : globalThis, function () {
  const esc = s => String(s ?? '').replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  function crc32(buf) { let c = ~0; for (let i = 0; i < buf.length; i++) { c ^= buf[i]; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)); } return ~c >>> 0; }
  function u16(n) { return new Uint8Array([n & 255, (n >>> 8) & 255]); }
  function u32(n) { return new Uint8Array([n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255]); }
  function cat(arrs) { const n = arrs.reduce((s, a) => s + a.length, 0); const o = new Uint8Array(n); let p = 0; for (const a of arrs) { o.set(a, p); p += a.length; } return o; }
  function str(s) { return new TextEncoder().encode(s); }
  /* store-only zip (method 0) — Word / LibreOffice 均接受 */
  function zip(files) {
    const locals = [], centrals = []; let offset = 0;
    for (const [name, data] of files) {
      const n = str(name), d = typeof data === 'string' ? str(data) : data, crc = crc32(d);
      const local = cat([u32(0x04034b50), u16(20), u16(0), u16(0), u16(0), u16(0), u32(crc), u32(d.length), u32(d.length), u16(n.length), u16(0), n, d]);
      const central = cat([u32(0x02014b50), u16(20), u16(20), u16(0), u16(0), u16(0), u16(0), u32(crc), u32(d.length), u32(d.length), u16(n.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset), n]);
      locals.push(local); centrals.push(central); offset += local.length;
    }
    const body = cat(locals), central = cat(centrals);
    const end = cat([u32(0x06054b50), u16(0), u16(0), u16(files.length), u16(files.length), u32(central.length), u32(body.length), u16(0)]);
    return cat([body, central, end]);
  }
  function p(text, style = 'Normal') {
    const runs = [];
    String(text).split(/(\*\*[^*]+\*\*)/g).forEach(part => {
      if (!part) return;
      if (/^\*\*[^*]+\*\*$/.test(part)) runs.push(`<w:r><w:rPr><w:b/><w:rFonts w:ascii="Times New Roman" w:eastAsia="宋体"/><w:sz w:val="24"/></w:rPr><w:t xml:space="preserve">${esc(part.slice(2, -2))}</w:t></w:r>`);
      else runs.push(`<w:r><w:rPr><w:rFonts w:ascii="Times New Roman" w:eastAsia="宋体"/><w:sz w:val="24"/></w:rPr><w:t xml:space="preserve">${esc(part)}</w:t></w:r>`);
    });
    return `<w:p><w:pPr><w:pStyle w:val="${style}"/><w:spacing w:after="120" w:line="360" w:lineRule="auto"/></w:pPr>${runs.join('') || '<w:r><w:t></w:t></w:r>'}</w:p>`;
  }
  function mdToBody(md, meta = {}) {
    const lines = String(md || '').replace(/\r/g, '').split('\n');
    const out = [];
    out.push(p('甲级建筑设计研究院', 'Title'));
    out.push(p(meta.title || '设计文件', 'Heading1'));
    out.push(p(`工程名称：${meta.project || '—'}　　工程编号：${meta.code || '—'}　　阶段：${meta.stage || '—'}`, 'Normal'));
    out.push(p(`编制：建筑师专属工作台　　日期：${meta.date || ''}`, 'Normal'));
    out.push(p(''));
    let inTable = false, rows = [];
    const flushTable = () => {
      if (!rows.length) return;
      let xml = '<w:tbl><w:tblPr><w:tblW w:w="5000" w:type="pct"/><w:tblBorders><w:top w:val="single" w:sz="4" w:color="999999"/><w:left w:val="single" w:sz="4" w:color="999999"/><w:bottom w:val="single" w:sz="4" w:color="999999"/><w:right w:val="single" w:sz="4" w:color="999999"/><w:insideH w:val="single" w:sz="4" w:color="CCCCCC"/><w:insideV w:val="single" w:sz="4" w:color="CCCCCC"/></w:tblBorders></w:tblPr>';
      rows.forEach((row, ri) => {
        xml += '<w:tr>' + row.map(c => `<w:tc><w:tcPr><w:shd w:val="clear" w:fill="${ri === 0 ? 'E8F0FE' : 'FFFFFF'}"/></w:tcPr>${p(c.trim())}</w:tc>`).join('') + '</w:tr>';
      });
      xml += '</w:tbl>'; out.push(xml); rows = []; inTable = false;
    };
    for (const line of lines) {
      if (/^\s*\|/.test(line)) {
        if (/^\s*\|?\s*:?-{3,}/.test(line.replace(/\|/g, '|'))) continue;
        rows.push(line.split('|').slice(1, -1)); inTable = true; continue;
      } else if (inTable) flushTable();
      if (/^###\s+/.test(line)) out.push(p(line.replace(/^###\s+/, ''), 'Heading3'));
      else if (/^##\s+/.test(line)) out.push(p(line.replace(/^##\s+/, ''), 'Heading2'));
      else if (/^#\s+/.test(line)) out.push(p(line.replace(/^#\s+/, ''), 'Heading1'));
      else if (/^>\s*/.test(line)) out.push(p(line.replace(/^>\s*/, ''), 'Quote'));
      else if (/^[-*]\s+/.test(line)) out.push(p('• ' + line.replace(/^[-*]\s+/, ''), 'Normal'));
      else if (/^\d+\.\s+/.test(line)) out.push(p(line, 'Normal'));
      else out.push(p(line, 'Normal'));
    }
    flushTable();
    return out.join('');
  }
  function build(md, meta = {}) {
    const body = mdToBody(md, meta);
    const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<w:body>${body}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1584"/></w:sectPr></w:body></w:document>`;
    const types = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
</Types>`;
    const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;
    const docRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;
    const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:style w:type="paragraph" w:styleId="Normal" w:default="1"><w:name w:val="Normal"/><w:rPr><w:rFonts w:ascii="Times New Roman" w:eastAsia="宋体"/><w:sz w:val="24"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:rPr><w:b/><w:sz w:val="36"/><w:color w:val="2F6BF0"/></w:rPr><w:pPr><w:jc w:val="center"/></w:pPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:rPr><w:b/><w:sz w:val="32"/><w:color w:val="1D2129"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:rPr><w:b/><w:sz w:val="28"/><w:color w:val="2F6BF0"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading3"><w:name w:val="heading 3"/><w:basedOn w:val="Normal"/><w:rPr><w:b/><w:sz w:val="26"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Quote"><w:name w:val="Quote"/><w:basedOn w:val="Normal"/><w:pPr><w:ind w:left="420"/></w:pPr><w:rPr><w:i/><w:color w:val="666666"/></w:rPr></w:style>
</w:styles>`;
    return zip([
      ['[Content_Types].xml', types],
      ['_rels/.rels', rels],
      ['word/document.xml', document],
      ['word/_rels/document.xml.rels', docRels],
      ['word/styles.xml', styles]
    ]);
  }
  function downloadDocx(filename, md, meta) {
    const bytes = build(md, meta);
    const blob = new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = filename.endsWith('.docx') ? filename : filename + '.docx'; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }
  return { build, downloadDocx, mdToBody, zip };
});
