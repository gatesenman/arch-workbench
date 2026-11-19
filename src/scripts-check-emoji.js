// 扫描 src（不含 vendor）中的 emoji / 符号图标字符
const fs = require('fs'), path = require('path');
const re = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{2300}-\u{23FF}\u{FE0F}\u{1F1E6}-\u{1F1FF}]/u;
const hits = [];
for (const f of fs.readdirSync('src')) { const p = path.join('src', f); if (fs.statSync(p).isFile()) fs.readFileSync(p, 'utf8').split('\n').forEach((l, i) => { const m = l.match(re); if (m) hits.push(`${p}:${i + 1} ${m[0]} U+${m[0].codePointAt(0).toString(16)}`); }); }
module.exports = hits; if (require.main === module) { console.log(hits.length ? hits.join('\n') : 'NO EMOJI'); process.exit(hits.length ? 1 : 0); }
