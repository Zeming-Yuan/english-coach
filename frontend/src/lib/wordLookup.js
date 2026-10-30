/**
 * 点词查义流程（共享）：清洗 token → 已学判断 → 本地/查词接口 → 面板数据。
 * 故事页与翻面浮层共用同一套交互语义，视图只渲染面板样式。
 */
import { useState } from "react";

import { api } from "./api.js";
import { cleanToken } from "./utils.js";

/**
 * @param {{ learnedWords?: Array<{word: string}> }} opts 已学词（如故事目标词）
 * @returns {{ word, result, open, close, markLearned }}
 *  word: { word, phonetic, meaning, card_id? } 面板数据
 *  result: { status: "idle"|"loading"|"found"|"missing", isLearned?: boolean }
 */
export function useWordLookup({ learnedWords = [] } = {}) {
  const [word, setWord] = useState(null);
  const [result, setResult] = useState({ status: "idle" });

  const open = async (raw) => {
    const clean = cleanToken(raw);
    if (!clean || clean.length < 2) return;
    const learned = learnedWords.find((w) => (w.word || "").toLowerCase() === clean);
    if (learned) {
      setWord(learned);
      setResult({ status: "found", isLearned: true });
      return;
    }
    setWord({ word: clean });
    setResult({ status: "loading" });
    try {
      const r = await api(`/api/lookup/${encodeURIComponent(clean)}`);
      setWord({ word: clean, phonetic: r.phonetic, meaning: r.meaning, card_id: r.card_id });
      setResult({ status: r.found ? "found" : "missing", isLearned: false });
    } catch {
      setResult({ status: "missing", isLearned: false });
    }
  };

  /** 本地数据就绪后更新面板（如加入词库成功 → 标记已学） */
  const markLearned = (entry) => {
    setWord(entry);
    setResult({ status: "found", isLearned: true });
  };

  const close = () => {
    setWord(null);
    setResult({ status: "idle" });
  };

  return { word, result, open, close, markLearned };
}
