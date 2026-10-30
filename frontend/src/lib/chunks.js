/**
 * 句子意群切分渲染工具。
 * - 优先用 AI 生成的 chunks（JSON 数组）
 * - 没有则前端启发式切分：常见连接词/介词短语前断句
 */

/** 前端启发式：把句子切成意群块 */
export function splitSentence(text) {
  if (!text) return [];
  // 先按逗号/分号/破折号分割，再在连接词/介词前微调
  const parts = text
    .split(/(?<=[,;:.!?])\s+|\s+—\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  return parts;
}

/** 渲染句子：chunks 存在则分块着色，否则整句 */
export function chunkHtml(text, chunks, highlightWord) {
  if (!text) return "";
  const chunksArr = Array.isArray(chunks) && chunks.length > 0 ? chunks : splitSentence(text);
  // 目标词高亮：chunks 拼接后统一处理？——逐块处理防止跨块切割
  return chunksArr
    .map((c, i) => {
      const seg = highlightWord ? highlightWord(c) : c;
      return `<span class="chunk chunk-${i % 3}">${seg}</span>`;
    })
    .join("<span class='chunk-sep'>·</span>");
}
