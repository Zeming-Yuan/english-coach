import React, { useState, useRef } from "react";
import { api } from "../lib/api.js";
import { parseAddWords } from "../lib/addWords.js";
import { showToast } from "../App.jsx";
import { useStarterCards } from "../hooks/useStarterCards.js";

const MAX_BATCH_SIZE = 20;

/**
 * 加词视图：AI 生成词卡 + 入门词卡 + 立即学一学。
 */
export default function AddPage({ onStartStudy, onAddStarter, onGoWords }) {
  const [input, setInput] = useState("");
  const [mode, setMode] = useState("batch");
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const {
    loading: starterLoading,
    error: starterError,
    addStarter: requestStarter,
  } = useStarterCards(onAddStarter);
  const generationInFlight = useRef(false);
  const parsed = parseAddWords(input, mode);
  const words = parsed.slice(0, MAX_BATCH_SIZE);

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
    if (generationInFlight.current || words.length === 0) return;
    generationInFlight.current = true;
    setLoading(true);
    setResult(null);
    try {
      const data = await api("/api/cards/generate", {
        method: "POST",
        body: JSON.stringify({ words }),
      });
      setResult({ data });
      if (!data.failed_words?.length) setInput("");
    } catch (error) {
      setResult({
        data: error.data,
        error: "生成失败：" + error.message,
        unconfirmed: Array.isArray(error.data?.failed_words) ? [] : words,
      });
    } finally {
      generationInFlight.current = false;
      setLoading(false);
    }
  };

  return (
    <section className="view view-center">
      <div className="add-card">
        <div className="page-head add-page-head">
          <h2 className="page-title">加词</h2>
          <p className="add-lead">为单词或短语生成词卡，也可以先学内置入门词卡。</p>
        </div>

        <div className="add-workspace-grid">
          <section className="add-panel add-primary-panel" aria-labelledby="add-ai-heading">
            <div className="add-panel-head">
              <span className="add-panel-tag">自定义词库</span>
              <h3 id="add-ai-heading">AI 生成词卡</h3>
            </div>
            <label className="add-mode">
              输入方式
              <select value={mode} disabled={loading} onChange={event => {
                setMode(event.target.value);
                setResult(null);
              }}>
                <option value="batch">多个单词</option>
                <option value="phrase">整条短语</option>
              </select>
            </label>
            <p className="add-hint">
              {mode === "phrase"
                ? "输入完整短语，内部空格会保留。"
                : "用逗号、空格或换行分隔，单次最多 20 项。"}
            </p>
            <label className="sr-only" htmlFor="add-words-input">要添加的英文单词</label>
            <textarea
              id="add-words-input"
              className="add-input"
              name="words"
              rows={4}
              maxLength={500}
              autoFocus
              value={input}
              disabled={loading}
              onChange={event => {
                setInput(event.target.value);
                setResult(null);
              }}
              placeholder={mode === "phrase" ? "例：apple juice" : "例：apple, banana, teacher"}
            />
            {words.length > 0 && (
              <div className="add-preview">
                <p>将添加的条目（{words.length} 项）</p>
                <ol aria-label="将添加的条目">
                  {words.map(word => <li key={word}>{word}</li>)}
                </ol>
                {parsed.length > MAX_BATCH_SIZE && (
                  <p className="add-count-hint">已识别 {parsed.length} 项，本次仅提交前 20 项。</p>
                )}
              </div>
            )}
            <div className="add-panel-footer">
              <button className="btn btn-primary" onClick={generate} disabled={loading || words.length === 0}>
                {loading ? "生成中…" : "AI 生成词卡"}
              </button>
            </div>
            <div className="add-result" aria-live="polite">
              {loading && <><span className="spinner" /><span className="loading">AI 生成中，请稍候…</span></>}
              {result?.data?.cards?.length > 0 && (
                <div>
                  <span className="ok">生成 {result.data.generated} 张卡：{result.data.cards.map(card => card.word).join("、")}</span>
                  <div className="learn-now-row">
                    <button className="btn btn-primary btn-small" onClick={() => onStartStudy?.(result.data.cards)}>
                      马上学一学（不等到明天）
                    </button>
                  </div>
                </div>
              )}
              {result?.data?.existing_words?.length > 0 && (
                <div className="warn">已存在：{result.data.existing_words.join("、")}</div>
              )}
              {(result?.error || result?.data?.failed_words?.length > 0) && (
                <div role="alert" className="err">
                  {result.error && <div>{result.error}</div>}
                  {result.data?.failed_words?.length > 0 && (
                    <div>未保存：{result.data.failed_words.join("、")}</div>
                  )}
                  {result.unconfirmed?.length > 0 && (
                    <div>未能确认保存状态：{result.unconfirmed.join("、")}</div>
                  )}
                  <div className="learn-now-row">
                    <button className="btn btn-ghost btn-small" onClick={generate}>↻ 重试</button>
                  </div>
                </div>
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
