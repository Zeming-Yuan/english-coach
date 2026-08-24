import React, { useState, useEffect, useCallback } from "react";
import { api } from "../lib/api.js";
import { speak } from "../lib/tts.js";
import { escapeHtml } from "../lib/utils.js";

/**
 * 故事视图：列表/删除/阅读/整句朗读/点词弹卡。
 */
export default function StoriesPage() {
  const [stories, setStories] = useState([]);
  const [activeStory, setActiveStory] = useState(null);
  const [loading, setLoading] = useState(true);

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
        <button className="btn btn-primary btn-small" onClick={async () => {
          try { await api("/api/stories/generate", { method: "POST" }); const d = await api("/api/stories"); setStories(d.stories); } catch {}
        }}>生成新故事</button>
      </div>
      <div className="story-list">
        {stories.length === 0 && <div className="story-empty">还没有故事。「生成新故事」会用你学过的词编一篇</div>}
        {stories.map((s) => (
          <div key={s.id} className="story-item">
            <div className="story-item-main" onClick={() => openStory(s.id)}>
              <div className="story-item-title">{escapeHtml(s.title)}</div>
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
  const [activeSentence, setActiveSentence] = useState(null);

  // 按句拆分
  const sentences = story.content.match(/[^.!?]+[.!?]*\s*/g) || [story.content];

  const handleWordClick = (e, word, sentenceIdx) => {
    e.stopPropagation();
    setActiveWord(word);
    setActiveSentence(sentenceIdx);
  };

  const renderTokens = (text, sentenceIdx) => {
    return text.split(/\s+/).map((tok, i) => {
      const clean = tok.replace(/[^a-zA-Z'-]/g, "").toLowerCase();
      const target = story.words.find((w) => w.word.toLowerCase() === clean);
      if (target) {
        return <span key={i} className="sw" onClick={(e) => handleWordClick(e, target, sentenceIdx)}>{tok} </span>;
      }
      return <span key={i}>{tok} </span>;
    });
  };

  const rateWord = async (rating) => {
    if (!activeWord) return;
    try {
      await api("/api/reviews", { method: "POST", body: JSON.stringify({ card_id: activeWord.id, rating }) });
      setActiveWord(null);
    } catch {}
  };

  return (
    <section className="view">
      <div className="page-head">
        <button className="btn btn-ghost btn-small" onClick={onBack}>← 返回</button>
      </div>
      <h2 className="story-read-title">{story.title}</h2>
      <div className="story-read-content">
        {sentences.map((sent, i) => (
          <React.Fragment key={i}>
            <span className="story-sentence" onClick={() => speak(sent.trim())}>
              {renderTokens(sent, i)}
            </span>
            {/* 内联词面板：在点击词的句子下方展开 */}
            {activeWord && activeSentence === i && (
              <div className="story-word-panel">
                <div className="story-word-panel-head">
                  <span className="story-word-panel-word">{activeWord.word}</span>
                  <button className="speak-mini" onClick={() => speak(activeWord.word)}>🔊</button>
                  <button className="story-word-panel-close" onClick={() => setActiveWord(null)}>✕</button>
                </div>
                {activeWord.phonetic && <div className="story-word-panel-phonetic">{activeWord.phonetic}</div>}
                <div className="story-word-panel-meaning">{activeWord.meaning}</div>
                <div className="story-word-panel-rating">
                  {[1, 2, 3, 4].map((r) => (
                    <button key={r} className={`btn-rating rating-${r}`} onClick={() => rateWord(r)}>
                      {r}<span className="rating-label">{r === 1 ? "忘了" : r === 2 ? "模糊" : r === 3 ? "记得" : "太简单"}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </React.Fragment>
        ))}
        <div className="story-tap-tip">👆 点击句子整句朗读 · 点击绿词查看释义</div>
      </div>
      <div className="story-read-words">
        {story.words.map((w) => (
          <div key={w.id} className="story-word-row">
            <b>{escapeHtml(w.word)}</b> <span>{escapeHtml(w.phonetic || "")}</span> <span>{escapeHtml(w.meaning || "")}</span>
          </div>
        ))}
      </div>
    </section>
  );
}
