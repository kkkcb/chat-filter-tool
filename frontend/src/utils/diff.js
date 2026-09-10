/**
 * 轻量文本 diff：行级 LCS 对齐 + 行内字符级高亮。
 * 返回 [{type:'same'|'del'|'add', old?, new?, oldHtml?, newHtml?}]
 * oldHtml/newHtml 仅在行被修改（成对 del+add）时提供（字符级高亮）。
 */

function lcsMatrix(a, b) {
  const n = a.length, m = b.length
  const dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
    }
  }
  return dp
}

function diffSeq(a, b) {
  const dp = lcsMatrix(a, b)
  const out = [] // {type, aIdx?, bIdx?}
  let i = 0, j = 0
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { out.push({ type: 'same', aIdx: i, bIdx: j }); i++; j++ }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { out.push({ type: 'del', aIdx: i }); i++ }
    else { out.push({ type: 'add', bIdx: j }); j++ }
  }
  while (i < a.length) { out.push({ type: 'del', aIdx: i }); i++ }
  while (j < b.length) { out.push({ type: 'add', bIdx: j }); j++ }
  return out
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** 字符级高亮单个修改行：公共字符正常、旧行独有 <del> 红、新行独有 <ins> 绿 */
function inlineHtml(text, chars, side) {
  let html = ''
  let buf = ''
  const flush = (tag) => {
    if (buf) html += tag ? `<${tag}>${esc(buf)}</${tag}>` : esc(buf)
    buf = ''
  }
  for (const c of chars) {
    if (c.type === 'same') { flush(null); buf += c.ch }
    else if ((side === 'old' && c.type === 'del') || (side === 'new' && c.type === 'add')) { flush(null); buf += c.ch }
    else { flush(null) /* 对侧字符跳过 */ }
  }
  flush(null)
  // 上面按跳过分片会断开——换成直接过滤重写
  html = ''
  let run = '', runTag = null
  const push = (ch, tag) => {
    if (tag !== runTag) {
      if (run) html += runTag ? `<${runTag}>${esc(run)}</${runTag}>` : esc(run)
      run = ''; runTag = tag
    }
    run += ch
  }
  for (const c of chars) {
    if (c.type === 'same') push(c.ch, null)
    else if (side === 'old' && c.type === 'del') push(c.ch, 'del')
    else if (side === 'new' && c.type === 'add') push(c.ch, 'ins')
  }
  if (run) html += runTag ? `<${runTag}>${esc(run)}</${runTag}>` : esc(run)
  return html
}

export function diffTexts(oldText, newText) {
  const oldLines = String(oldText || '').split('\n')
  const newLines = String(newText || '').split('\n')
  const seq = diffSeq(oldLines, newLines)
  // 把连续的 del 块与 add 块配对（等长部分做行内 diff）
  const result = []
  let k = 0
  while (k < seq.length) {
    if (seq[k].type !== 'del') { result.push({ type: seq[k].type, old: oldLines[seq[k].aIdx], new: newLines[seq[k].bIdx] }); k++; continue }
    // 收集连续 del
    const dels = []
    while (k < seq.length && seq[k].type === 'del') { dels.push(seq[k].aIdx); k++ }
    const adds = []
    while (k < seq.length && seq[k].type === 'add') { adds.push(seq[k].bIdx); k++ }
    const pairs = Math.min(dels.length, adds.length)
    for (let p = 0; p < pairs; p++) {
      const o = oldLines[dels[p]], nw = newLines[adds[p]]
      const chars = diffSeq(Array.from(o), Array.from(nw)).map(c => ({
        type: c.type,
        ch: c.type === 'same' ? o[c.aIdx] : (c.type === 'del' ? o[c.aIdx] : nw[c.bIdx]),
      }))
      result.push({ type: 'mod', old: o, new: nw, oldHtml: inlineHtml(o, chars, 'old'), newHtml: inlineHtml(nw, chars, 'new') })
    }
    for (let p = pairs; p < dels.length; p++) result.push({ type: 'del', old: oldLines[dels[p]] })
    for (let p = pairs; p < adds.length; p++) result.push({ type: 'add', new: newLines[adds[p]] })
  }
  return result
}
