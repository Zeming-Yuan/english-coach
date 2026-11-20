import React, { useState, useRef } from "react";
import { api } from "../lib/api.js";
import { showToast } from "../App.jsx";
import { useStarterCards } from "../hooks/useStarterCards.js";

/**
 * 加词视图：AI 生成词卡 + 入门词卡 + 立即学一学。
 */
export default function AddPage({ onStartStudy, onAddStarter, onGoWords }) {
  const [input, setInput] = useState("");
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const {
    loading: starterLoading,
    error: starterError,
    addStarter: requestStarter,
  } = useStarterCards(onAddStarter);
  const resultRef = useRef(null);

  // 与首页空态共用同一个添加动作；已有词卡时不打开空学习页
  const addStarter = async () => {
    const data = await requestStarter();
    if (!data) return;
    if (data.cards.length > 0) {
      onStartStudy && onStartStudy(data.cards);
    } else {
      showToast("入门词卡已存在，已为你打开单词本");
      onGoWords && onGoWords();
    }
  };

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

  const wordCount = input.trim()
    ? input.trim().split(/[,，\s]+/).filter(Boolean).length
    : 0;

  return (
    <section className="view view-center">
      <div className="add-card">
        <div className="page-head add-page-head">
          <h2 className="page-title">加词</h2>
          <p className="add-lead">输入想学的单词由 AI 生成词卡，或先从已核对的入门词卡开始。</p>
        </div>

        <div className="add-workspace-grid">
          <section className="add-panel add-primary-panel" aria-labelledby="add-ai-heading">
            <div className="add-panel-head">
              <span className="add-panel-tag">自定义词库</span>
              <h3 id="add-ai-heading">AI 生成词卡</h3>
            </div>
            <p className="add-hint">输入想学的单词，用逗号、空格或换行分隔（单次最多 20 个），自动生成释义、音标与例句。</p>
            <textarea
              className="add-input"
              name="words"
              rows={4}
              maxLength={500}
              autoFocus
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="例：apple, banana, teacher"
            />
            <div className="add-panel-footer">
              <span className="add-count-hint">
                {wordCount > 0 ? `已输入 ${Math.min(wordCount, 20)} / 20 个词` : "支持单词与常见短语"}
              </span>
              <button className="btn btn-primary" onClick={generate} disabled={loading}>
                {loading ? "生成中…" : "AI 生成词卡"}
              </button>
            </div>
            <div ref={resultRef} className="add-result">
              {loading && <><span className="spinner" /><span className="loading">AI 生成中，请稍候…</span></>}
              {result?.success && (
                <>
                  <span className="ok">✅ 生成 {result.data.generated} 张卡：{result.data.cards.map((c) => c.word).join("、")}</span>
                  {result.data.skipped > 0 && <><br /><span className="warn">{result.data.skipped} 个已存在跳过</span></>}
                  <><br /><span className="warn">这些词已经进入你的词库，明天会按记忆安排复习</span></>
                  <div className="learn-now-row">
                    <button className="btn btn-primary btn-small" onClick={() => onStartStudy && onStartStudy(result.data.cards)}>
                      马上学一学（不等到明天）
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
          </section>

          <aside className="add-panel add-starter-panel" aria-labelledby="add-starter-heading">
            <div className="add-panel-head">
              <span className="add-panel-tag">零配置起步</span>
              <h3 id="add-starter-heading">10 张入门词卡</h3>
            </div>
            <p className="add-hint">无需 AI：加入 10 张已核对释义、音标和例句的入门词卡，添加后可直接开始第一轮学习。</p>
            <ul className="add-starter-points">
              <li>内置核对释义、国际音标与双语例句</li>
              <li>同名自定义词卡不会被覆盖</li>
              <li>无需配置 AI 服务即可体验完整复习流</li>
            </ul>
            <button className="btn btn-ghost add-starter-btn" onClick={addStarter} disabled={starterLoading}>
              {starterLoading ? "正在添加…" : "体验入门词卡"}
            </button>
            {starterError && (
              <p role="alert" className="err">添加失败：{starterError}，请重试</p>
            )}
          </aside>
        </div>
      </div>
    </section>
  );
}
