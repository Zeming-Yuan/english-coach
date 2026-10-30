import React, { useState, useRef } from "react";
import { api } from "../lib/api.js";
import { escapeHtml } from "../lib/utils.js";

/**
 * 加词视图：AI 生成词卡 + 立即学一学。
 */
export default function AddPage({ onStartStudy }) {
  const [input, setInput] = useState("");
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const resultRef = useRef(null);

  const generate = async () => {
    const raw = input.trim();
    if (!raw) { setResult({ error: "先输入一些单词吧" }); return; }
    const words = raw.split(/[,，\s]+/).filter(Boolean).slice(0, 20);
    setLoading(true);
    setResult(null);
    try {
      const data = await api("/api/cards/generate", {
        method: "POST",
        body: JSON.stringify({ words }),
      });
      setResult({ success: true, data });
      setInput("");
    } catch (e) {
      setResult({ error: "生成失败：" + e.message, retry: true });
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="view view-center">
      <div className="add-card">
        <h2 className="page-title">加词</h2>
        <p className="add-hint">输入想学的单词，用逗号或空格分隔，AI 帮你生成学习卡片</p>
        <textarea
          className="add-input"
          name="words"
          rows={3}
          maxLength={500}
          autoFocus
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="例：apple, banana, teacher"
        />
        <button className="btn btn-primary btn-wide" onClick={generate} disabled={loading}>
          {loading ? "生成中…" : "AI 生成词卡"}
        </button>
        <div ref={resultRef} className="add-result">
          {loading && <><span className="spinner" /><span className="loading">AI 生成中，请稍候…</span></>}
          {result?.success && (
            <>
              <span className="ok">✅ 生成 {result.data.generated} 张卡：{result.data.cards.map((c) => escapeHtml(c.word)).join("、")}</span>
              {result.data.skipped > 0 && <><br /><span className="warn">{result.data.skipped} 个已存在跳过</span></>}
              <><br /><span className="warn">这些词已经进入你的词库，明天会按记忆安排复习</span></>
              <div className="learn-now-row">
                <button className="btn btn-primary btn-small" onClick={() => onStartStudy && onStartStudy(result.data.cards)}>
                  🕐 马上学一学（不等到明天）
                </button>
              </div>
            </>
          )}
          {result?.error && (
            <>
              <span className="err">{result.error}</span>
              {result.retry && (
                <div className="learn-now-row">
                  <button className="btn btn-ghost btn-small" onClick={generate}>↻ 重试</button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </section>
  );
}
