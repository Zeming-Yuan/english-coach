import React, { useState, useEffect, useCallback, useRef } from "react";
import { api } from "../lib/api.js";
import { speak } from "../lib/tts.js";
import {storyAudioSegments} from "../lib/storyAudio.js";
import { cleanToken, escapeHtml } from "../lib/utils.js";
import { recordVisibleCards } from "../lib/contacts.js";
import { recordPracticeContact } from "../lib/practiceContacts.js";
import { useWordLookup } from "../lib/wordLookup.js";
import { useLearningAttempt } from "../hooks/useLearningAttempt.js";
import { showToast } from "../App.jsx";
import StoryGeneration, {StoryQuality} from "../components/StoryGeneration.jsx";
import StoryCheck from "../components/StoryCheck.jsx";
import StoryVersions from "../components/StoryVersions.jsx";
import RatingButtons from "../components/RatingButtons.jsx";
import {ArrowLeftIcon} from "@phosphor-icons/react/dist/csr/ArrowLeft";
import {SpeakerHighIcon} from "@phosphor-icons/react/dist/csr/SpeakerHigh";
import {TextAaIcon} from "@phosphor-icons/react/dist/csr/TextAa";
import {XIcon} from "@phosphor-icons/react/dist/csr/X";
import {PlusCircleIcon} from "@phosphor-icons/react/dist/csr/PlusCircle";
import {TrashIcon} from "@phosphor-icons/react/dist/csr/Trash";
import "@fontsource/tinos/latin-400.css";
import "@fontsource/tinos/latin-700.css";
import "./story-reader.css";

function StoryLayout({onNavigate, children}) {
  return <div className="story-layout"><div className="story-surface">{children}</div></div>;
}

/**
 * 故事视图：列表/删除/阅读/整句朗读/点词弹卡。
 */
export default function StoriesPage({onNavigate}) {
  const [stories, setStories] = useState([]);
  const [activeStory, setActiveStory] = useState(null);
  const [loading, setLoading] = useState(true);
  const [starter, setStarter] = useState(null);
  const [generated, setGenerated] = useState(null);
  const [simplificationEnabled, setSimplificationEnabled] = useState(true);
  const [generationEnabled, setGenerationEnabled] = useState(true);
  const selection = useRef(0);
  const openingStory = useRef(null);
  useEffect(() => () => { selection.current += 1; }, []);

  useEffect(() => {
    api("/api/stories").then((d) => { setStories(d.stories); setSimplificationEnabled(d.simplification_enabled !== false); setGenerationEnabled(d.generation_enabled !== false); setLoading(false); }).catch(() => setLoading(false));
  }, []);

  const deleteStory = async (id, title) => {
    if (!window.confirm(`删除故事「${title}」？（词卡不会删）`)) return;
    try {
      await api(`/api/stories/${id}`, { method: "DELETE" });
      setStories((s) => s.filter((x) => x.id !== id));
      setActiveStory((current) => current?.id === id ? null : current);
      if (openingStory.current === id) {
        selection.current += 1;
        openingStory.current = null;
      }
    } catch (e) { showToast("删除失败：" + e.message); }
  };

  const openStory = async (id) => {
    const request = ++selection.current;
    openingStory.current = id;
    try {
      const s = await api(`/api/stories/${id}`);
      if (request === selection.current) setActiveStory(s);
    } catch (e) { if (request === selection.current) showToast("读取失败：" + e.message); }
  };

  if (loading) return <StoryLayout onNavigate={onNavigate}><div className="story-empty">加载中…</div></StoryLayout>;

  // 阅读视图
  if (activeStory) {
    const reader = <StoryRead key={activeStory.version_id || activeStory.id} story={activeStory} onBack={() => {selection.current += 1; openingStory.current = null; setActiveStory(null);}} />;
    const versionReader = <StoryVersions key={activeStory.parent_version_id || activeStory.version_id || activeStory.id} story={activeStory} enabled={simplificationEnabled} onSelect={openStory} onSaved={story => setStories(rows => [story, ...rows.filter(row => row.id !== story.id)])}>
      {reader}
    </StoryVersions>;
    const checkedReader = ["normal", "short"].includes(activeStory.mode) && activeStory.version_id
      ? <StoryCheck key={activeStory.version_id} story={activeStory} onCreated={id => {
          setActiveStory(current => current?.version_id === activeStory.version_id ? {...current, check_session_id: id} : current);
          setStories(rows => rows.map(row => row.id === activeStory.id ? {...row, check_session_id: id} : row));
        }}>{versionReader}</StoryCheck> : versionReader;
    return <StoryLayout onNavigate={onNavigate}>{checkedReader}</StoryLayout>;
  }

  return (
    <StoryLayout onNavigate={onNavigate}>
    <section className="view story-library">
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
              {["normal", "short"].includes(s.mode) && <div>{s.mode === "short" ? "简化版" : "原版"} · {s.check_session_id ? "已有检查记录" : "未检查"}</div>}
              <div className="story-item-title">{escapeHtml(s.title)}</div>
              {s.title_cn && <div className="story-item-title-cn">{escapeHtml(s.title_cn)}</div>}
              <div className="story-item-meta">{s.words.length} 个词 · {escapeHtml(s.content.slice(0, 40))}…</div>
            </div>
            <button className="story-delete" title="删除" aria-label={`删除故事 ${s.title}`} onClick={() => deleteStory(s.id, s.title)}><TrashIcon aria-hidden="true" size={20} /></button>
          </div>
        ))}
      </div>
    </section>
    </StoryLayout>
  );
}

function StoryRead({ story, onBack }) {
  const [mode, setMode] = useState("bilingual"); // en | bilingual | cn
  const [addingWord, setAddingWord] = useState(false);
  const [fontSize, setFontSize] = useState(30);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [selectedContext, setSelectedContext] = useState("");
  const [reading, setReading] = useState(false);
  const speechRun = useRef(0);
  const selectedToken = useRef(null);
  const panelRef = useRef(null);
  const settingsRef = useRef(null);
  const [narrow, setNarrow] = useState(() => window.matchMedia("(max-width: 1023px)").matches);
  // 点词查义共享流程（清洗/已学判断/查词接口）
  const { word: activeWord, result: lookupResult, open: handleWordClick, close: closePanel, markLearned } =
    useWordLookup({ learnedWords: story.words });

  const dismissWord = useCallback(() => {
    closePanel();
    selectedToken.current?.focus({preventScroll: true});
  }, [closePanel]);

  useEffect(() => {
    const query = window.matchMedia("(max-width: 1023px)");
    const update = () => setNarrow(query.matches);
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    if (!activeWord) return;
    const previousOverflow = document.body.style.overflow;
    if (narrow) {
      document.body.style.overflow = "hidden";
      panelRef.current?.querySelector("button")?.focus({preventScroll: true});
    }
    const onKey = (event) => {
      if (event.key === "Escape") { event.preventDefault(); dismissWord(); }
      if (narrow && event.key === "Tab") {
        const controls = Array.from(panelRef.current?.querySelectorAll("button:not(:disabled), [tabindex='0']") || []);
        const first = controls[0], last = controls[controls.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => { document.body.style.overflow = previousOverflow; window.removeEventListener("keydown", onKey); };
  }, [activeWord?.word, narrow]);

  useEffect(() => {
    if (!settingsOpen) return;
    const close = (event) => {
      if (event.type === "keydown" && event.key !== "Escape") return;
      if (event.type === "pointerdown" && settingsRef.current?.contains(event.target)) return;
      setSettingsOpen(false);
    };
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", close);
    return () => { window.removeEventListener("pointerdown", close); window.removeEventListener("keydown", close); };
  }, [settingsOpen]);

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

  useEffect(() => () => { speechRun.current += 1; }, []);

  const contactAudio = async (text, ids) => {
    const run = ++speechRun.current;
    setReading(true);
    try {
      for (const segment of storyAudioSegments(text)) {
        if (run !== speechRun.current) break;
        const result = await speak(segment, null, () => {
          for (const id of ids || []) {
            const target = story.words.find(word => word.id === id);
            // Match the server's visible_card_ids ASCII letter boundaries, including phrases.
            const word = target?.word?.trim();
            const escaped = word?.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
            if (target?.content_revision && word && new RegExp(`(^|[^A-Za-z])${escaped}(?![A-Za-z])`, "i").test(segment)) {
              recordPracticeContact({cardId: id, revision: target.content_revision, source: "story", kind: "answer_audio"});
            }
          }
        });
        if (result === "none") { showToast("暂时无法朗读，请稍后重试"); break; }
      }
    } finally {
      if (run === speechRun.current) setReading(false);
    }
  };

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
    let offset = 0;
    return text.split(/(\s+)/).map((tok, i) => {
      const tokenOffset = offset;
      offset += tok.length;
      if (/^\s+$/.test(tok)) return tok;
      const clean = cleanToken(tok);
      const isLearned = story.words.some((w) => w.word.toLowerCase() === clean);
      if (clean.length > 1) {
        return (
          <button type="button" key={i} aria-label={`查词 ${clean}`} aria-pressed={activeWord?.word.toLowerCase() === clean}
            className={`${isLearned ? "sw" : "story-clickable-word"} ${activeWord?.word.toLowerCase() === clean ? "reader-word-selected" : ""}`}
            onClick={(event) => {
              selectedToken.current = event.currentTarget;
              const sentences = typeof Intl.Segmenter === "function"
                ? Array.from(new Intl.Segmenter("en", {granularity: "sentence"}).segment(text))
                : [{index: 0, segment: text}];
              const sentence = sentences.find(({index, segment}) => tokenOffset >= index && tokenOffset < index + segment.length);
              setSelectedContext((sentence?.segment || text).trim());
              handleWordClick(tok);
            }}>
            {tok}
          </button>
        );
      }
      return <span key={i}>{tok}</span>;
    });
  };

  const isLearnedWord = activeWord && (lookupResult.isLearned || story.words.some((w) => w.word === activeWord.word));

  return (
    <section data-story-version={story.version_id || ""} className="view story-reader" style={{"--reader-font-size": `${fontSize}px`}}>
      <div className="reader-toolbar">
        <button className="reader-back" onClick={onBack}><ArrowLeftIcon aria-hidden="true" />返回故事列表</button>
        <div className="reader-breadcrumb"><span>故事 /</span> {story.title_cn || story.title}</div>
        <div className="reader-tools">
          <div className="reader-type-control" ref={settingsRef}>
            <button className="reader-tool" aria-label="阅读设置" aria-expanded={settingsOpen} aria-controls="reader-settings" onClick={() => setSettingsOpen(!settingsOpen)}><TextAaIcon aria-hidden="true" /><span>字号</span></button>
            {settingsOpen && <div id="reader-settings" className="reader-preferences">
              <div className="reader-size-row"><span>字号</span><button aria-label="减小字号" disabled={fontSize <= 20} onClick={() => setFontSize(s => s - 2)}>A−</button><output aria-live="polite">{fontSize}</output><button aria-label="增大字号" disabled={fontSize >= 36} onClick={() => setFontSize(s => s + 2)}>A+</button></div>
              <fieldset><legend>阅读语言</legend><div className="story-mode-switch">
                {[["en", "EN"], ["bilingual", "中英"], ["cn", "中文"]].map(([value, label]) => <button key={value} className={`mode-btn ${mode === value ? "mode-active" : ""}`} aria-pressed={mode === value} onClick={() => setMode(value)}>{label}</button>)}
              </div></fieldset>
            </div>}
          </div>
          <button className="reader-translation" role="switch" aria-label="显示译文" aria-checked={mode !== "en"} onClick={() => setMode(mode === "en" ? "bilingual" : "en")}><span className="reader-switch-track" aria-hidden="true"><span /></span><span>译文</span></button>
        </div>
      </div>

      <div className="reader-layout">
      <article className="reader-article" aria-label={story.title}>
      {/* 标题 */}
      <header className="reader-heading">
        {story.title_cn && <p className="reader-kicker">{story.title_cn}</p>}
        <h1 className="story-read-title" lang="en">{story.title}</h1>
        <div className="reader-meta"><span>短篇故事 <span aria-hidden="true">·</span> {mode === "bilingual" ? "中英对照" : mode === "cn" ? "中文阅读" : "英文阅读"}</span><button className="reader-tool" disabled={reading} onClick={() => contactAudio(story.content, story.visible_card_ids)}><SpeakerHighIcon aria-hidden="true" />{reading ? "朗读中…" : "朗读"}</button></div>
      </header>

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
                <button className="speak-mini sentence-speak" title="朗读整句" aria-label={`朗读第 ${i + 1} 段`} onClick={() => contactAudio(enSent.trim(), story.line_card_ids?.[i])}><SpeakerHighIcon aria-hidden="true" /></button>
                <p className="story-sentence-en" lang="en">{renderTokens(enSent)}</p>
              </div>
            )}
            {/* 对应中文翻译 */}
            {mode !== "en" && cnLines[i] && (
              <div className="story-sentence-cn">{cnLines[i]}</div>
            )}
          </div>
        ))}

      </div>

      {/* 词表 */}
      <footer className="reader-footer">
        <button className="reader-back" onClick={onBack}><ArrowLeftIcon aria-hidden="true" />返回故事列表</button>
        <details className="reader-targets"><summary>本故事目标词 · {story.words.length}</summary>
        <div data-testid="content-contact-status" className="story-tap-tip">应用内接触：本故事正文包含 {story.visible_card_ids?.length || 0} 个目标词</div>
        {story.words.map((w) => (
          <div key={w.id} className="story-word-row">
            <b>{escapeHtml(w.word)}</b> <span>{escapeHtml(w.phonetic || "")}</span> <span>{escapeHtml(w.meaning || "")}</span>
          </div>
        ))}
        </details>
      </footer>
      </article>

      {/* 查词底部抽屉：点词即现，不随内容滚动（旧内联面板要滚到全文底部才能看到） */}
      {activeWord && (
        <>
          <div className="story-word-backdrop" onClick={dismissWord} />
          <aside className="story-word-panel" ref={panelRef} role={narrow ? "dialog" : "complementary"} aria-modal={narrow ? true : undefined} aria-label="词语释义">
            <div className="story-word-panel-head">
              <span>词语</span>
              <button className="story-word-panel-close" aria-label="关闭词语释义" onClick={dismissWord}><XIcon aria-hidden="true" /></button>
            </div>
            <h2 className="story-word-panel-word" lang="en">{activeWord.word}</h2>
            <div className="reader-pronunciation">{activeWord.phonetic && <span className="story-word-panel-phonetic">{activeWord.phonetic}</span>}<button className="reader-tool" aria-label={`朗读 ${activeWord.word}`} onClick={() => speak(activeWord.word)}><SpeakerHighIcon aria-hidden="true" /></button></div>
            <div className="story-word-panel-meaning" aria-live="polite">
              {activeWord.meaning || (lookupResult.status === "missing" ? "暂无释义" : "查询中…")}
            </div>
            {selectedContext && <div className="reader-context"><h3>文中用法</h3><blockquote lang="en">{selectedContext}</blockquote></div>}
            {/* 已学过的词：显示评分 */}
            {isLearnedWord && activeWord.id && (
              <div className="story-word-panel-rating">
                <StoryRating
                  key={activeWord.id}
                  cardId={activeWord.id}
                  onRated={(rating) => {
                    dismissWord();
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
              <button className="reader-add-word" disabled={addingWord || lookupResult.status === "loading"} onClick={() => addToLibrary(activeWord.word)}>
                <PlusCircleIcon weight="fill" aria-hidden="true" />{addingWord ? "添加中…" : "加入单词本"}
              </button>
            )}
            {!isLearnedWord && lookupResult.status === "found" && <p className="reader-word-note">在单词本中继续复习。</p>}
          </aside>
        </>
      )}
      </div>
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
