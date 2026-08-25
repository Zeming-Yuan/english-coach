import React, { useState, useEffect, useCallback, useRef } from "react";
import { api } from "../lib/api.js";
import { speak } from "../lib/tts.js";
import { escapeHtml } from "../lib/utils.js";
import { showToast } from "../App.jsx";

/**
 * 故事视图：列表/删除/阅读/整句朗读/点词弹卡。
 */
export default function StoriesPage() {
  const [stories, setStories] = useState([]);
  const [activeStory, setActiveStory] = useState(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);

  useEffect(() => {
    api("/api/stories").then((d) => { setStories(d.stories); setLoading(false); }).catch(() => setLoading(false));
  }, []);

  const deleteStory = async (id, title) => {
    if (!window.confirm(`删除故事「${title}」？（词卡不会删）`)) return;
    try {
      await api(`/api/stories/${id}`, { method: "DELETE" });
      setStories((s) => s.filter((x) => x.id !== id));
    } catch {}
  };

  const openStory = async (id) => {
    try {
      const s = await api(`/api/stories/${id}`);
      setActiveStory(s);
    } catch {}
  };

  if (loading) return <div className="story-empty">加载中…</div>;

  // 阅读视图
  if (activeStory) {
    return <StoryRead story={activeStory} onBack={() => setActiveStory(null)} />;
  }

  return (
    <section className="view">
      <div className="page-head">
        <h2 className="page-title">故事</h2>
        <button className="btn btn-primary btn-small" disabled={generating} onClick={async () => {
          setGenerating(true);
          try {
            await api("/api/stories/generate", { method: "POST" });
            const d = await api("/api/stories");
            setStories(d.stories);
          } catch (e) {
            showToast("生成失败：" + e.message, "重试");
          } finally {
            setGenerating(false);
          }
        }}>{generating ? "生成中…" : "生成新故事"}</button>
      </div>
      <div className="story-list">
        {stories.length === 0 && <div className="story-empty">还没有故事。「生成新故事」会用你学过的词编一篇</div>}
        {stories.map((s) => (
          <div key={s.id} className="story-item">
            <div className="story-item-main" onClick={() => openStory(s.id)}>
              <div className="story-item-title">{escapeHtml(s.title)}</div>
              {s.title_cn && <div className="story-item-title-cn">{escapeHtml(s.title_cn)}</div>}
              <div className="story-item-meta">{s.words.length} 个词 · {escapeHtml(s.content.slice(0, 40))}…</div>
            </div>
            <button className="story-delete" title="删除" onClick={() => deleteStory(s.id, s.title)}>🗑</button>
          </div>
        ))}
      </div>
    </section>
  );
}

function StoryRead({ story, onBack }) {
  const [activeWord, setActiveWord] = useState(null);
  const [lookupResult, setLookupResult] = useState(null);
  const [mode, setMode] = useState("bilingual"); // en | bilingual | cn
  const [addingWord, setAddingWord] = useState(false);

  // 逐句拆分（\n 分隔），中英行一一对应
  const enLines = (story.content || "").split("\n").filter(Boolean);
  const cnLines = (story.content_cn || "").split("\n").filter(Boolean);

  const handleWordClick = async (e, word) => {
    e.stopPropagation();
    const clean = word.replace(/[^a-zA-Z'-]/g, "").toLowerCase();
    if (!clean || clean.length < 2) return;
    // 先查已学过的词
    const learned = story.words.find((w) => w.word.toLowerCase() === clean);
    if (learned) {
      setActiveWord(learned);
      setLookupResult({ found: true, isLearned: true });
      return;
    }
    // 未学过的词 → 调查词接口
    setActiveWord({ word: clean, phonetic: null, meaning: null });
    setLookupResult(null);
    try {
      const r = await api(`/api/lookup/${encodeURIComponent(clean)}`);
      setActiveWord({ word: clean, phonetic: r.phonetic, meaning: r.meaning, card_id: r.card_id });
      setLookupResult({ ...r, isLearned: false });
    } catch {
      setLookupResult({ found: false, isLearned: false });
    }
  };

  // 添加到词库
  const addToLibrary = async (word) => {
    if (!word || addingWord) return;
    setAddingWord(true);
    try {
      const r = await api("/api/cards/generate", {
        method: "POST",
        body: JSON.stringify({ words: [word] }),
      });
      if (r.generated > 0) {
        showToast(`✅ 「${word}」已加入词库`);
        // 更新 story.words 让按钮消失
        story.words = [...story.words, { id: r.cards[0].id, word: word, phonetic: r.cards[0].phonetic, meaning: r.cards[0].meaning }];
        setActiveWord({ ...activeWord, id: r.cards[0].id });
        setLookupResult({ found: true, isLearned: true, card_id: r.cards[0].id });
      } else {
        showToast(`「${word}」已在词库中`);
      }
    } catch (err) {
      showToast("添加失败：" + err.message);
    } finally {
      setAddingWord(false);
    }
  };

  const renderTokens = (text) => {
    return text.split(/(\s+)/).map((tok, i) => {
      if (/^\s+$/.test(tok)) return tok;
      const clean = tok.replace(/[^a-zA-Z'-]/g, "").toLowerCase();
      const isLearned = story.words.some((w) => w.word.toLowerCase() === clean);
      if (clean.length > 1) {
        return (
          <span key={i} className={isLearned ? "sw" : "story-clickable-word"} onClick={(e) => handleWordClick(e, tok)}>
            {tok}
          </span>
        );
      }
      return <span key={i}>{tok}</span>;
    });
  };

  const rateWord = async (rating) => {
    if (!activeWord?.id) return;
    try {
      await api("/api/reviews", { method: "POST", body: JSON.stringify({ card_id: activeWord.id, rating }) });
      setActiveWord(null);
      setLookupResult(null);
      showToast(rating >= 3 ? "✅ 已标记记得" : "📌 已加入复习队列");
    } catch {}
  };

  const closePanel = () => { setActiveWord(null); setLookupResult(null); };

  const isLearnedWord = activeWord && (lookupResult?.isLearned || story.words.some((w) => w.word === activeWord.word));

  return (
    <section className="view">
      <div className="page-head">
        <button className="btn btn-ghost btn-small" onClick={onBack}>← 返回</button>
        <div className="story-mode-switch">
          <button className={`mode-btn ${mode === "en" ? "mode-active" : ""}`} onClick={() => setMode("en")}>EN</button>
          <button className={`mode-btn ${mode === "bilingual" ? "mode-active" : ""}`} onClick={() => setMode("bilingual")}>中英</button>
          <button className={`mode-btn ${mode === "cn" ? "mode-active" : ""}`} onClick={() => setMode("cn")}>中文</button>
        </div>
      </div>

      {/* 标题 */}
      <h2 className="story-read-title">
        {story.title}
        {story.title_cn && mode !== "en" && <span className="story-title-cn">{story.title_cn}</span>}
      </h2>

      {/* 故事内容：逐句中英对照 */}
      <div className="story-read-content">
        {enLines.map((enSent, i) => (
          <div key={i} className="story-pair">
            {/* 英文句子 */}
            {mode !== "cn" && (
              <div className="story-sentence-row">
                <button className="speak-mini sentence-speak" title="朗读整句" onClick={() => speak(enSent.trim())}>🔊</button>
                <span className="story-sentence-en">{renderTokens(enSent)}</span>
              </div>
            )}
            {/* 对应中文翻译 */}
            {mode !== "en" && cnLines[i] && (
              <div className="story-sentence-cn">{cnLines[i]}</div>
            )}
          </div>
        ))}

        {/* 词面板 */}
        {activeWord && (
          <div className="story-word-panel">
            <div className="story-word-panel-head">
              <span className="story-word-panel-word">{activeWord.word}</span>
              <button className="speak-mini" onClick={() => speak(activeWord.word)}>🔊</button>
              <button className="story-word-panel-close" onClick={closePanel}>✕</button>
            </div>
            {activeWord.phonetic && <div className="story-word-panel-phonetic">{activeWord.phonetic}</div>}
            <div className="story-word-panel-meaning">
              {activeWord.meaning || (lookupResult?.found === false ? "暂无释义" : "查询中…")}
            </div>
            {/* 已学过的词：显示评分 */}
            {isLearnedWord && activeWord.id && (
              <div className="story-word-panel-rating">
                {[1, 2, 3, 4].map((r) => (
                  <button key={r} className={`btn-rating rating-${r}`} onClick={() => rateWord(r)}>
                    {r}<span className="rating-label">{r === 1 ? "忘了" : r === 2 ? "模糊" : r === 3 ? "记得" : "太简单"}</span>
                  </button>
                ))}
              </div>
            )}
            {/* 未学过的词：显示添加按钮 */}
            {!isLearnedWord && lookupResult?.found !== false && (
              <button className="btn btn-primary btn-small" style={{ marginTop: 8 }} disabled={addingWord} onClick={() => addToLibrary(activeWord.word)}>
                {addingWord ? "添加中…" : "📥 添加到词库"}
              </button>
            )}
          </div>
        )}

        <div className="story-tap-tip">👆 点击任意英文单词查释义 · 点击 🔊 朗读整句</div>
      </div>

      {/* 词表 */}
      <div className="story-read-words">
        <h3 className="lesson-section">本故事目标词</h3>
        {story.words.map((w) => (
          <div key={w.id} className="story-word-row">
            <b>{escapeHtml(w.word)}</b> <span>{escapeHtml(w.phonetic || "")}</span> <span>{escapeHtml(w.meaning || "")}</span>
          </div>
        ))}
      </div>
    </section>
  );
}
