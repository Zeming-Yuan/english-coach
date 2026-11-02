import React, { useState, useEffect, useCallback, useRef } from "react";
import { api } from "../lib/api.js";
import { speak } from "../lib/tts.js";
import { cleanToken, escapeHtml } from "../lib/utils.js";
import { recordVisibleCards } from "../lib/contacts.js";
import { recordPracticeContact } from "../lib/practiceContacts.js";
import { useWordLookup } from "../lib/wordLookup.js";
import { useLearningAttempt } from "../hooks/useLearningAttempt.js";
import { showToast } from "../App.jsx";
import StoryGeneration, {StoryQuality} from "../components/StoryGeneration.jsx";
import RatingButtons from "../components/RatingButtons.jsx";

/**
 * 故事视图：列表/删除/阅读/整句朗读/点词弹卡。
 */
export default function StoriesPage() {
  const [stories, setStories] = useState([]);
  const [activeStory, setActiveStory] = useState(null);
  const [loading, setLoading] = useState(true);
  const [starter, setStarter] = useState(null);
  const [generated, setGenerated] = useState(null);
  const [generationEnabled, setGenerationEnabled] = useState(true);
  const selection = useRef(0);
  useEffect(() => () => { selection.current += 1; }, []);

  useEffect(() => {
    api("/api/stories").then((d) => { setStories(d.stories); setGenerationEnabled(d.generation_enabled !== false); setLoading(false); }).catch(() => setLoading(false));
  }, []);

  const deleteStory = async (id, title) => {
    if (!window.confirm(`删除故事「${title}」？（词卡不会删）`)) return;
    try {
      await api(`/api/stories/${id}`, { method: "DELETE" });
      setStories((s) => s.filter((x) => x.id !== id));
    } catch (e) { showToast("删除失败：" + e.message); }
  };

  const openStory = async (id) => {
    const request = ++selection.current;
    try {
      const s = await api(`/api/stories/${id}`);
      if (request === selection.current) setActiveStory(s);
    } catch (e) { if (request === selection.current) showToast("读取失败：" + e.message); }
  };

  if (loading) return <div className="story-empty">加载中…</div>;

  // 阅读视图
  if (activeStory) {
    return <StoryRead story={activeStory} onBack={() => {selection.current += 1; setActiveStory(null);}} />;
  }

  return (
    <section className="view">
      <div className="page-head">
        <h2 className="page-title">故事</h2>
        {generationEnabled && <StoryGeneration onStarter={(story) => {setGenerated(null); setStarter(story);}} onSaved={(story) => {
          setStarter(null);
          setGenerated(story);
          setStories((rows) => [story, ...rows.filter(row => row.id !== story.id)]);
        }} />}
      </div>
      {generated && <StoryQuality story={generated} />}
      {starter && <div>
        <StoryQuality story={starter} />
        <button className="btn btn-ghost btn-small" onClick={() => {selection.current += 1; setActiveStory(starter);}}>打开入门故事</button>
      </div>}
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
  const [mode, setMode] = useState("bilingual"); // en | bilingual | cn
  const [addingWord, setAddingWord] = useState(false);
  // 点词查义共享流程（清洗/已学判断/查词接口）
  const { word: activeWord, result: lookupResult, open: handleWordClick, close: closePanel, markLearned } =
    useWordLookup({ learnedWords: story.words });

  // 逐句拆分（\n 分隔），中英行一一对应
  const enLines = (story.content || "").split("\n").filter(Boolean);
  const cnLines = (story.content_cn || "").split("\n").filter(Boolean);

  // 只有真正进入视口的句子中出现的目标词才算接触；预取与未展示不算。
  const seenContacts = useRef(new Set());
  const observedStory = useRef(null);
  useEffect(() => {
    if (observedStory.current !== story.id) {
      observedStory.current = story.id;
      seenContacts.current = new Set();
    }
    if (mode === "cn" || typeof IntersectionObserver === "undefined") return;
    const record = (ids) => {
      const fresh = Array.from(new Set(ids)).filter(
        (id) => !seenContacts.current.has(id),
      );
      if (fresh.length === 0) return;
      fresh.forEach((id) => seenContacts.current.add(id));
      const targets = fresh
        .map((id) => story.words.find((word) => word.id === id))
        .filter((word) => word?.content_revision);
      recordVisibleCards(targets, "story").then(({ failed, retryable }) => {
        if (failed.length === 0) return;
        failed.forEach((target) => seenContacts.current.delete(target.id));
        const message = `接触依据不完整：${failed.length} 个目标词`;
        if (retryable.length === 0) {
          showToast(message);
          return;
        }
        showToast(message, "重试", () =>
          record(retryable.map((target) => target.id)),
        );
      });
    };
    const observer = new IntersectionObserver(
      (entries) => {
        const ids = [];
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const raw = entry.target.dataset.contactIds;
          if (raw) ids.push(...raw.split(",").map(Number).filter(Boolean));
        }
        record(ids);
      },
      {threshold: 0.5},
    );
    document
      .querySelectorAll("[data-contact-ids]")
      .forEach((element) => observer.observe(element));
    return () => observer.disconnect();
  }, [mode, story.id]);

  const contactAudio = (text, ids) =>
    speak(text, null, () => {
      for (const id of ids || []) {
        const target = story.words.find((word) => word.id === id);
        if (target?.content_revision) {
          recordPracticeContact({
            cardId: id,
            revision: target.content_revision,
            source: "story",
            kind: "answer_audio",
          });
        }
      }
    });

  // 点词弹层真正显示释义后才算接触；暂无释义不记录。
  useEffect(() => {
    if (!activeWord?.meaning || lookupResult.status !== "found") return;
    const target = story.words.find(
      (word) => word.word.toLowerCase() === activeWord.word.toLowerCase(),
    );
    if (target?.content_revision) {
      recordPracticeContact({
        cardId: target.id,
        revision: target.content_revision,
        source: "story",
        kind: "answer_visible",
      });
    }
  }, [activeWord?.word, activeWord?.meaning, lookupResult.status, story.id]);

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
        markLearned({ id: r.cards[0].id, word: word, phonetic: r.cards[0].phonetic, meaning: r.cards[0].meaning });
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
      const clean = cleanToken(tok);
      const isLearned = story.words.some((w) => w.word.toLowerCase() === clean);
      if (clean.length > 1) {
        return (
          <span key={i} className={isLearned ? "sw" : "story-clickable-word"} onClick={() => handleWordClick(tok)}>
            {tok}
          </span>
        );
      }
      return <span key={i}>{tok}</span>;
    });
  };

  const isLearnedWord = activeWord && (lookupResult.isLearned || story.words.some((w) => w.word === activeWord.word));

  return (
    <section data-story-version={story.version_id || ""} className="view">
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

      <StoryQuality story={story} />
      {/* 故事内容：逐句中英对照 */}
      <div className="story-read-content">
        {enLines.map((enSent, i) => (
          <div key={i} className="story-pair">
            {/* 英文句子 */}
            {mode !== "cn" && (
              <div
                data-contact-ids={(story.line_card_ids?.[i] || []).join(",")}
                className="story-sentence-row"
              >
                <button className="speak-mini sentence-speak" title="朗读整句" onClick={() => contactAudio(enSent.trim(), story.line_card_ids?.[i])}>🔊</button>
                <span className="story-sentence-en">{renderTokens(enSent)}</span>
              </div>
            )}
            {/* 对应中文翻译 */}
            {mode !== "en" && cnLines[i] && (
              <div className="story-sentence-cn">{cnLines[i]}</div>
            )}
          </div>
        ))}

        <div className="story-tap-tip">👆 点击任意英文单词查释义 · 点击 🔊 朗读整句</div>
        <div data-testid="content-contact-status" className="story-tap-tip">
          应用内接触：本故事正文包含{" "}
          {story.visible_card_ids?.length || 0} 个目标词
        </div>
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

      {/* 查词底部抽屉：点词即现，不随内容滚动（旧内联面板要滚到全文底部才能看到） */}
      {activeWord && (
        <>
          <div className="story-word-backdrop" onClick={closePanel} />
          <div className="story-word-panel">
            <div className="story-word-panel-head">
              <span className="story-word-panel-word">{activeWord.word}</span>
              <button className="speak-mini" onClick={() => speak(activeWord.word)}>🔊</button>
              <button className="story-word-panel-close" onClick={closePanel}>✕</button>
            </div>
            {activeWord.phonetic && <div className="story-word-panel-phonetic">{activeWord.phonetic}</div>}
            <div className="story-word-panel-meaning">
              {activeWord.meaning || (lookupResult.status === "missing" ? "暂无释义" : "查询中…")}
            </div>
            {/* 已学过的词：显示评分 */}
            {isLearnedWord && activeWord.id && (
              <div className="story-word-panel-rating">
                <StoryRating
                  key={activeWord.id}
                  cardId={activeWord.id}
                  onRated={(rating) => {
                    closePanel();
                    showToast(
                      rating == null
                        ? "已确认保存本次评分"
                        : rating >= 3
                          ? "✅ 已标记记得"
                          : "📌 已加入复习队列",
                    );
                  }}
                />
              </div>
            )}
            {/* 未学过的词：显示添加按钮 */}
            {!isLearnedWord && lookupResult.status !== "missing" && (
              <button className="btn btn-primary btn-small" style={{ marginTop: 8 }} disabled={addingWord} onClick={() => addToLibrary(activeWord.word)}>
                {addingWord ? "添加中…" : "📥 添加到词库"}
              </button>
            )}
          </div>
        </>
      )}
    </section>
  );
}

/* 故事内已学词的显式评分：保存确认后才关闭面板并提示。 */
function StoryRating({ cardId, onRated }) {
  const attempt = useLearningAttempt("story:" + cardId);

  const finish = (result, rating) => {
    if (result.committed !== true) return;
    attempt.clear();
    onRated(rating);
  };

  const rate = async (rating) => {
    if (attempt.phase === "saving" || attempt.phase === "failed") return;
    try {
      finish(
        await attempt.submit("/api/reviews", {
          card_id: cardId,
          rating,
          source: "story",
          kind: "self_rating",
          stage: "standalone",
        }),
        rating,
      );
    } catch {}
  };

  const retry = async () => {
    try {
      finish(await attempt.retry(), null);
    } catch {}
  };

  return (
    <>
      <RatingButtons
        onRate={rate}
        disabled={attempt.phase === "saving" || attempt.phase === "failed"}
      />
      {attempt.phase === "saving" && (
        <p role="status" className="save-state">正在确认保存…</p>
      )}
      {attempt.phase === "failed" && (
        <div role="alert" className="save-state save-state-error">
          <p>{attempt.error}</p>
          <div className="save-state-actions">
            <button className="btn btn-primary btn-small" onClick={retry}>继续确认保存</button>
            <button className="btn btn-ghost btn-small" onClick={attempt.clear}>放弃这条待确认</button>
          </div>
        </div>
      )}
    </>
  );
}
