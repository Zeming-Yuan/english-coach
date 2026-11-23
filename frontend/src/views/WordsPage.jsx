import UiIcon from "../components/UiIcon.jsx";
import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { api } from "../lib/api.js";
import { recordContact, recordVisibleCards } from "../lib/contacts.js";
import { speak, prewarmTts } from "../lib/tts.js";
import { useLearningAttempt } from "../hooks/useLearningAttempt.js";
import { showToast } from "../App.jsx";
import ChunkChips from "../components/ChunkChips.jsx";
import LearningEvidence from "../components/LearningEvidence.jsx";
import RatingButtons from "../components/RatingButtons.jsx";
import WordExpansions from "../components/WordExpansions.jsx";
import ExpansionPracticeLinks from "../components/ExpansionPracticeLinks.jsx";

/**
 * 单词本视图：搜索/A-Z/快速查阅/详情/编辑/删除/记忆法/换例句/困难词。
 */
export default function WordsPage({ onBack, detailId = null, onDetailChange, onReturnToStudy, onStartExpansionPractice }) {
  const [allCards, setAllCards] = useState([]);
  const [query, setQuery] = useState("");
  const [internalDetail, setInternalDetail] = useState(null);
  const detail = onDetailChange ? detailId : internalDetail;
  const setDetail = useCallback(
    (nextId, options) => {
      if (onDetailChange) onDetailChange(nextId, options);
      else setInternalDetail(nextId);
    },
    [onDetailChange],
  );
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [quickPeek, setQuickPeek] = useState(null);
  const [peekPos, setPeekPos] = useState({ x: 0, y: 0 });
  const [tab, setTab] = useState("words"); // words | sentences

  const loadCards = useCallback(() => {
    setLoadError("");
    return api("/api/cards").then((d) => {
      setAllCards(d.cards);
      prewarmTts(d.cards.map((c) => c.kind === "sentence" ? (c.example || c.word) : c.word));
      setLoading(false);
    }).catch(error => {setLoadError(error.message); setLoading(false);});
  }, []);

  useEffect(() => {
    loadCards();
  }, [loadCards]);

  // 数据加载时就预分成两组并按字母排序，切换 tab 只是引用不同的数组
  const { wordsCards, sentenceCards } = useMemo(() => {
    const wc = [], sc = [];
    for (const c of allCards) {
      if (c.kind === "sentence") sc.push(c);
      else wc.push(c);  // kind 为 word / undefined / null 统一归入词汇
    }
    const byWord = (a, b) => (a.word || "").localeCompare(b.word || "", "en", { sensitivity: "base" });
    wc.sort(byWord);
    sc.sort(byWord);
    return { wordsCards: wc, sentenceCards: sc };
  }, [allCards]);

  const tabCards = tab === "words" ? wordsCards : sentenceCards;

  // 搜索：按字段相关性加权排序
  // 权重：word完全匹配(0) < word前缀(1) < word包含(2) < meaning匹配(3) < 例句翻译匹配(4)
  const searchQuery = query.toLowerCase();
  const filtered = searchQuery
    ? tabCards
        .filter((c) =>
          (c.word || "").toLowerCase().includes(searchQuery) ||
          (c.meaning || "").toLowerCase().includes(searchQuery) ||
          (c.example_cn || "").toLowerCase().includes(searchQuery)
        )
        .sort((a, b) => searchRank(a, searchQuery) - searchRank(b, searchQuery))
    : tabCards;

  // 按首字母分组
  const grouped = [];
  let currentLetter = "";
  filtered.forEach((c) => {
    const ch = (c.word || "").charAt(0).toUpperCase();
    const letter = /[A-Z]/.test(ch) ? ch : "#";
    if (letter !== currentLetter) {
      currentLetter = letter;
      grouped.push({ type: "header", letter });
    }
    grouped.push({ type: "card", card: c });
  });

  // A-Z 导航
  const usedLetters = new Set(grouped.filter((g) => g.type === "header").map((g) => g.letter));

  // EL-04：只有真正进入视口的卡片才算一次展示接触；预取、预热与未展示都不算。
  const contactCards = useMemo(
    () => new Map(allCards.map((c) => [c.id, c])),
    [allCards],
  );
  useEffect(() => {
    if (loading || detail || typeof IntersectionObserver === "undefined") return;
    const seen = new Set();
    const observer = new IntersectionObserver((entries) => {
      const shown = [];
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const card = contactCards.get(Number(entry.target.dataset.contactCardId));
        if (!card || seen.has(card.id)) continue;
        seen.add(card.id);
        shown.push(card);
      }
      if (shown.length === 0) return;
      recordVisibleCards(shown, "words_list").then(({ failed, retryable }) => {
        if (failed.length === 0) return;
        const finalCount = failed.length - retryable.length;
        const message = (remaining, final) =>
          final > 0
            ? `接触依据不完整：${remaining} 张未确认（${final} 张无法确认）`
            : `接触依据不完整：${remaining} 张尚未确认`;
        const retry = (cards, final) => {
          recordVisibleCards(cards, "words_list").then((again) => {
            const remaining = final + again.failed.length;
            if (remaining === 0) {
              showToast("接触记录已确认");
            } else if (again.retryable.length === 0) {
              showToast(message(remaining, final));
            } else {
              showToast(message(remaining, final), "重试", () =>
                retry(again.retryable, final),
              );
            }
          });
        };
        if (retryable.length === 0) {
          showToast(message(failed.length, finalCount));
        } else {
          showToast(message(failed.length, finalCount), "重试", () =>
            retry(retryable, finalCount),
          );
        }
      });
    }, { threshold: 0.5 });
    document
      .querySelectorAll("[data-contact-card-id]")
      .forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [loading, detail, tab, query, contactCards]);

  const speakCard = (card, text, source) =>
    speak(text, null, () => {
      recordContact({
        cardId: card.id,
        revision: card.content_revision,
        source,
        kind: "answer_audio",
      }).catch((error) => {
        showToast("接触记录尚未确认：" + (error?.message || error));
      });
    });

  if (loading) return <div className="story-empty">加载中…</div>;
  if (loadError && !detail) return <div role="alert" className="ec-callout is-err ec-callout-inline"><span>加载失败：{loadError}</span><button className="btn btn-ghost btn-small" onClick={() => {setLoading(true); loadCards();}}>重试加载</button></div>;

  // 详情页
  if (detail) {
    return <>
      {loadError && <div role="alert" className="ec-callout is-err ec-callout-inline"><span>词表刷新失败：{loadError}</span><button className="btn btn-ghost btn-small" onClick={loadCards}>重试刷新</button></div>}
      <WordDetail
        key={detail}
        cardId={detail}
        onBack={onReturnToStudy || (() => setDetail(null, { popIfFromParent: true, replace: true }))}
        backLabel={onReturnToStudy ? "返回原词卡" : "单词本"}
        openExpansionCard={setDetail}
        onStartExpansionPractice={onStartExpansionPractice}
        onDismissDeleted={onReturnToStudy || (() => setDetail(null, { popIfFromParent: true, replace: true }))}
        allCards={filtered}
        setDetail={(nextId) => setDetail(nextId, { replace: true })}
        onCardChanged={loadCards}
      />
    </>;
  }

  // 点击关闭快速查阅
  const closePeek = () => { setQuickPeek(null); };

  return (
    <section className="view">
      <div className="page-head">
        <h2 className="page-title">单词本</h2>
        <div className="word-tabs">
          <button className={`word-tab ${tab === "words" ? "word-tab-active" : ""}`} onClick={() => setTab("words")}>词汇</button>
          <button className={`word-tab ${tab === "sentences" ? "word-tab-active" : ""}`} onClick={() => setTab("sentences")}>句子</button>
        </div>
      </div>
      <div className="word-search-bar">
        <input className="word-search-input" name="word-search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="搜索单词或释义…" />
        {query && <span className="word-search-count">{filtered.length} 个结果</span>}
      </div>
      <div className="word-list-wrap">
        {/* key 含 query：搜索词变化时强制重建列表，避免 React diff 残留旧DOM */}
        <div className="word-list" key={`${tab}-${query}`}>
          {filtered.length === 0 && <div className="story-empty">还没有卡片，先去「加词」添加第一个吧</div>}
          {grouped.map((g, i) => {
            if (g.type === "header") {
              // 字母头 key 必须与卡片 key 空间隔离，否则冲突导致 diff 错乱
              return <div key={`h-${g.letter}`} className="word-letter-header" id={`letter-${g.letter}`}>{g.letter}</div>;
            }
            const c = g.card;
            const badges = [];
            badges.push(c.kind === "sentence" ? "句子" : "词");
            if (c.graduated) badges.push("已解锁");
            if (c.error_count > 0) badges.push(`错词×${c.error_count}`);
            return (
              <div key={c.id} className="word-item" data-contact-card-id={c.id} onClick={() => setDetail(c.id)} onContextMenu={(e) => {
                e.preventDefault();
                setQuickPeek(c);
                setPeekPos({ x: Math.min(e.clientX, window.innerWidth - 280), y: Math.min(e.clientY, window.innerHeight - 200) });
              }}>
                <div className="word-main">
                  {c.kind === "sentence" ? (
                    <>
                      <div className="word-item-word">
                        {c.example || c.word}
                        {badges.map((b, j) => <span key={j} className={`badge ${b === "句子" ? "badge-sentence" : b === "已解锁" ? "badge-graduated" : b.startsWith("错词") ? "badge-error" : "badge-word"}`}>{b}</span>)}
                      </div>
                      <div className="word-item-meaning">{c.example_cn || ""} · 复习 {c.review_count} 次</div>
                    </>
                  ) : (
                    <>
                      <div className="word-item-word">
                        {c.word}
                        {badges.map((b, j) => <span key={j} className={`badge ${b === "句子" ? "badge-sentence" : b === "已解锁" ? "badge-graduated" : b.startsWith("错词") ? "badge-error" : "badge-word"}`}>{b}</span>)}
                      </div>
                      {c.phonetic && <div className="word-item-phonetic">{c.phonetic}</div>}
                      <div className="word-item-meaning">{c.meaning || ""} · {c.progress_label || "独立证据不足"}</div>
                    </>
                  )}
                </div>
                <button className="speak-mini" title="朗读" onClick={(e) => { e.stopPropagation(); speakCard(c, c.kind === "sentence" ? (c.example || c.word) : c.word, "words_list"); }} aria-label="朗读"><UiIcon name="speaker" /></button>
              </div>
            );
          })}
        </div>
        <nav className="alpha-nav">
          {"ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("").map((L) => (
            <button key={L} className={`alpha-btn ${!usedLetters.has(L) ? "alpha-disabled" : ""}`} onClick={() => {
              const el = document.getElementById(`letter-${L}`);
              if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
            }}>{L}</button>
          ))}
        </nav>
      </div>

      {/* 快速查阅浮层 */}
      {quickPeek && (
        <div className="quick-peek" style={{ left: peekPos.x, top: peekPos.y }}>
          <div className="quick-peek-head">
            <span className="qp-word">{quickPeek.kind === "sentence" ? (quickPeek.example || quickPeek.word) : quickPeek.word}</span>
            <button className="speak-mini" onClick={() => speakCard(quickPeek, quickPeek.kind === "sentence" ? (quickPeek.example || quickPeek.word) : quickPeek.word, "words_list")} aria-label="朗读"><UiIcon name="speaker" /></button>
          </div>
          {quickPeek.kind !== "sentence" && quickPeek.phonetic && <div className="qp-phonetic">{quickPeek.phonetic}</div>}
          <div className="qp-meaning">{quickPeek.kind === "sentence" ? (quickPeek.example_cn || "") : (quickPeek.meaning || "")}</div>
          {quickPeek.kind !== "sentence" && quickPeek.example && <div className="qp-example">{quickPeek.example}</div>}
          <button className="btn btn-ghost btn-small" style={{ marginTop: 8 }} onClick={() => { setDetail(quickPeek.id); setQuickPeek(null); }}>查看详情 →</button>
        </div>
      )}

      {/* 点击关闭浮层 */}
      {quickPeek && <div style={{ position: "fixed", inset: 0, zIndex: 149 }} onClick={closePeek} />}
    </section>
  );
}

/* ============ 搜索相关性排名 ============ */
function searchRank(card, query) {
  const q = query.toLowerCase();
  const word = (card.word || "").toLowerCase();
  const meaning = (card.meaning || "").toLowerCase();
  const exampleCn = (card.example_cn || "").toLowerCase();
  if (word === q) return 0;
  if (word.startsWith(q)) return 1;
  if (word.includes(q)) return 2;
  if (meaning.includes(q)) return 3;
  if (exampleCn.includes(q)) return 4;
  return 5; // 其他字段（不该出现）
}

/* ============ 学习事件展示 ============ */
const SOURCE_LABELS = {
  study: "队列闪卡",
  lesson: "课程",
  story: "故事",
  card_detail: "词卡详情",
  words_list: "词表",
  spelling: "拼写",
  quiz: "测验",
  listening: "听力",
  mixed: "混合",
  reinforcement: "巩固",
  legacy: "未分类",
};
const KIND_LABELS = {
  self_rating: "自评",
  typed: "拼写/填空",
  choice: "选择",
  related: "相关词",
};
const RATING_LABELS = { 1: "忘了", 2: "模糊", 3: "记得", 4: "太简单" };
const CONTACT_KIND_LABELS = { answer_visible: "看到答案", answer_audio: "播放答案" };
const ASSISTANCE_LABELS = {
  first_letter: "首字母",
  length: "字母数",
  live_feedback: "逐字反馈",
  answer_audio: "答案发音",
  answer_visible: "提前显示答案",
};

function eventResult(event) {
  if (event.skipped) return "跳过";
  if (event.kind === "self_rating") {
    return RATING_LABELS[event.self_rating] || "自评";
  }
  if (event.correct === true) return "答对";
  if (event.correct === false) return "答错";
  return "结果未知";
}

function LearningEventRow({ event }) {
  const assistance = (event.assistance || []).map(
    (item) => ASSISTANCE_LABELS[item] || item,
  );
  const when = event.occurred_at
    ? new Date(event.occurred_at).toLocaleString()
    : event.learning_day;
  const outcome = event.skipped
    ? "skip"
    : event.kind === "self_rating"
      ? event.self_rating === 1 ? "err" : event.self_rating === 2 ? "warn" : "ok"
      : event.correct === true ? "ok" : event.correct === false ? "err" : "neutral";
  return (
    <div className="tl-item tl-latest" data-testid="learning-event" data-outcome={outcome}>
      <div className={`tl-dot tl-rating-${event.self_rating || 3}`} />
      <div className="tl-content">
        <span className="tl-label">
          {SOURCE_LABELS[event.source] || event.source} ·{" "}
          {KIND_LABELS[event.kind] || event.kind} · {eventResult(event)}
        </span>
        <span className="tl-date">
          {when}
          {event.scheduled ? " · 已更新排期" : " · 未更新排期"}
          {assistance.length > 0 ? ` · 提示：${assistance.join("、")}` : ""}
        </span>
      </div>
    </div>
  );
}

function InlineDetailEditor({
  id,
  label,
  multiline = false,
  value,
  onChange,
  onSave,
  onCancel,
  saving = false,
  error = "",
  placeholder = "",
  saveLabel = "保存",
  inputRef,
}) {
  const [composing, setComposing] = useState(false);
  const handleKeyDown = (e) => {
    if (e.nativeEvent?.isComposing || e.keyCode === 229 || composing) {
      if (!multiline && e.key === "Enter") e.preventDefault();
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      onCancel();
    }
  };
  const handleSubmit = (e) => {
    e.preventDefault();
    if (!composing) onSave();
  };
  const sharedProps = {
    ref: inputRef,
    id,
    maxLength: 500,
    autoFocus: true,
    disabled: saving,
    value,
    onChange: (e) => onChange(e.target.value),
    onCompositionStart: () => setComposing(true),
    onCompositionEnd: () => setComposing(false),
    onKeyDown: handleKeyDown,
    placeholder,
  };
  return (
    <form className="inline-detail-editor" onSubmit={handleSubmit}>
      <label className="sr-only" htmlFor={id}>{label}</label>
      {multiline ? (
        <textarea {...sharedProps} className="inline-detail-textarea" rows={3} />
      ) : (
        <input {...sharedProps} className="inline-detail-input" type="text" />
      )}
      {error && <p role="alert" className="inline-detail-error">{error}</p>}
      <div className="inline-detail-actions">
        <button type="submit" className="btn btn-primary btn-small" disabled={saving}>
          {saving ? "保存中…" : saveLabel}
        </button>
        <button type="button" className="btn btn-ghost btn-small" disabled={saving} onClick={onCancel}>
          取消
        </button>
      </div>
    </form>
  );
}

/* ============ 单词详情子组件 ============ */
function WordDetail({ cardId, onBack, backLabel, openExpansionCard, onStartExpansionPractice, onDismissDeleted, allCards, setDetail, onCardChanged }) {
  const [c, setCard] = useState(null);
  const [loadError, setLoadError] = useState("");
  const [loading, setLoading] = useState(true);
  const attempt = useLearningAttempt("card_detail:" + cardId);

  // 找到当前词在列表中的位置，支持上/下一个导航
  const currentIndex = allCards ? allCards.findIndex((x) => x.id === cardId) : -1;
  const prevCard = allCards && currentIndex > 0 ? allCards[currentIndex - 1] : null;
  const nextCard = allCards && currentIndex < allCards.length - 1 ? allCards[currentIndex + 1] : null;

  const onDismissDeletedRef = useRef(onDismissDeleted);
  onDismissDeletedRef.current = onDismissDeleted;

  const loadDetail = useCallback(() => {
    setLoading(true);
    setLoadError("");
    return api(`/api/cards/${cardId}`)
      .then((card) => {
        if (mountedRef.current) setCard(card);
      })
      .catch(error => {
        if (!mountedRef.current) return;
        setCard(null);
        if (error?.status === 404 && onDismissDeletedRef.current) {
          onDismissDeletedRef.current();
          return;
        }
        setLoadError(error.message);
      })
      .finally(() => {
        if (mountedRef.current) setLoading(false);
      });
  }, [cardId]);
  useEffect(() => {loadDetail();}, [loadDetail]);

  const rateCard = async (rating) => {
    if (!c || attempt.phase === "saving" || attempt.phase === "failed") return;
    try {
      const result = await attempt.submit("/api/reviews", {
        card_id: c.id,
        rating,
        source: "card_detail",
        kind: "self_rating",
        stage: "standalone",
      });
      if (result.committed !== true) return;
      attempt.clear();
      try {
        setCard(await api(`/api/cards/${c.id}`));
      } catch {}
    } catch {}
  };

  const retryRating = async () => {
    try {
      const result = await attempt.retry();
      if (result.committed !== true) return;
      attempt.clear();
      try {
        setCard(await api(`/api/cards/${result.card_id}`));
      } catch {}
    } catch {}
  };

  const toggleHard = async () => {
    try {
      const r = await api(`/api/cards/${c.id}/hard`, { method: "POST" });
      setCard({ ...c, is_hard: r.is_hard });
    } catch (error) {showToast("更新失败：" + error.message);}
  };

  const deleteCard = async () => {
    if (!window.confirm(`删除「${c.word}」？复习记录/记忆法/错词都会一并删除。`)) return;
    try {
      await api(`/api/cards/${c.id}`, { method: "DELETE" });
      onCardChanged?.();
      (onDismissDeleted || onBack)();
    } catch (error) {showToast("删除失败：" + error.message);}
  };

  const [pendingExample, setPendingExample] = useState(null);
  const [regenerating, setRegenerating] = useState(false);
  const [savingExample, setSavingExample] = useState(false);
  const [editingMeaning, setEditingMeaning] = useState(false);
  const [meaningDraft, setMeaningDraft] = useState("");
  const [savingMeaning, setSavingMeaning] = useState(false);
  const [meaningError, setMeaningError] = useState("");
  const [editingMemo, setEditingMemo] = useState(false);
  const [memoDraft, setMemoDraft] = useState("");
  const [savingMemo, setSavingMemo] = useState(false);
  const [memoError, setMemoError] = useState("");
  const mountedRef = useRef(true);
  const regenerateRef = useRef(null);
  const menuRef = useRef(null);
  const meaningInputRef = useRef(null);
  const memoInputRef = useRef(null);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);
  useEffect(() => {
    setEditingMeaning(false);
    setMeaningError("");
    setEditingMemo(false);
    setMemoError("");
  }, [cardId]);

  const refreshDetail = async () => {
    try {
      const fresh = await api(`/api/cards/${c.id}`);
      if (mountedRef.current) setCard(fresh);
    } catch {}
  };

  // EL-04：详情实际显示后才确认接触；失败时明确标注依据不完整。
  const [contactState, setContactState] = useState({
    phase: "idle",
    kind: null,
    error: null,
    durable: true,
    retryable: true,
  });

  const confirmContact = async (kind = "answer_visible") => {
    if (!c?.content_revision) return;
    setContactState({ phase: "saving", kind, error: null, durable: true, retryable: true });
    try {
      await recordContact({
        cardId: c.id,
        revision: c.content_revision,
        source: "card_detail",
        kind,
      });
      setContactState({ phase: "saved", kind, error: null, durable: true, retryable: true });
      await refreshDetail();
    } catch (error) {
      setContactState({
        phase: "failed",
        kind,
        error: error?.message || String(error),
        durable: error?.durable !== false,
        retryable: error?.retryable !== false,
      });
    }
  };

  useEffect(() => {
    if (!c?.content_revision) return;
    confirmContact("answer_visible");
    // 只在本卡或内容修订变化（重新显示）时确认一次。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [c?.id, c?.content_revision?.identity, c?.content_revision?.version]);

  // 只有目标答案的语音才算“听到答案”；例句与意群朗读不冒充答案播放。
  const speakAnswer = (text) =>
    speak(text, null, () => confirmContact("answer_audio"));
  const speakPlain = (text) => speak(text);

  const regenerate = async () => {
    if (!mountedRef.current || !c || regenerating || savingExample) return;
    setRegenerating(true);
    try {
      const oldExample = c.example;
      const oldExampleCn = c.example_cn;
      const oldExplanation = c.explanation;
      const previewed = await api(`/api/cards/${c.id}/regenerate?preview=true`, { method: "POST" });
      if (!mountedRef.current) return;
      if (previewed.preview === false) {
        await refreshDetail();
        if (previewed.stale) {
          onCardChanged?.();
          showToast("词卡内容已变化，已刷新最新内容");
        }
        return;
      }
      if (previewed.example && previewed.example !== oldExample) {
        setPendingExample({
          old: { example: oldExample, example_cn: oldExampleCn, explanation: oldExplanation },
          new: {
            example: previewed.example,
            example_cn: previewed.example_cn,
            explanation: previewed.explanation,
          },
          expectedRevision: previewed.content_revision || c.content_revision,
        });
      } else {
        await refreshDetail();
      }
    } catch (e) {
      if (mountedRef.current) {
        showToast("换例句失败：" + e.message, "重试", () => {
          regenerateRef.current?.();
        });
      }
    } finally {
      if (mountedRef.current) setRegenerating(false);
    }
  };
  regenerateRef.current = regenerate;

  const applyPendingExample = async () => {
    if (!c || !pendingExample || savingExample) return;
    setSavingExample(true);
    try {
      await api(`/api/cards/${c.id}`, {
        method: "PUT",
        body: JSON.stringify({
          example: pendingExample.new.example,
          example_cn: pendingExample.new.example_cn,
          explanation: pendingExample.new.explanation,
          expected_revision: pendingExample.expectedRevision,
        }),
      });
      if (!mountedRef.current) return;
      setPendingExample(null);
      await refreshDetail();
      onCardChanged?.();
      showToast("✅ 已换新例句");
    } catch (e) {
      if (!mountedRef.current) return;
      if (e?.status === 409) {
        setPendingExample(null);
        await refreshDetail();
        onCardChanged?.();
        showToast("词卡内容已变化，请重新查看后再换例句");
      } else {
        showToast("保存新例句失败：" + e.message);
      }
    } finally {
      if (mountedRef.current) setSavingExample(false);
    }
  };

  const openMeaningEditor = () => {
    if (!c || savingMeaning) return;
    if (editingMeaning) {
      meaningInputRef.current?.focus();
      return;
    }
    setMeaningDraft(c.kind === "sentence" ? (c.example_cn || "") : (c.meaning || ""));
    setMeaningError("");
    setEditingMeaning(true);
  };

  const cancelMeaningEditor = () => {
    if (savingMeaning) return;
    setEditingMeaning(false);
    setMeaningError("");
  };

  const saveMeaningEdit = async () => {
    if (!c || savingMeaning) return;
    const trimmed = meaningDraft.trim();
    setSavingMeaning(true);
    setMeaningError("");
    try {
      const payload = c.kind === "sentence" ? { example_cn: trimmed } : { meaning: trimmed };
      await api(`/api/cards/${c.id}`, { method: "PUT", body: JSON.stringify(payload) });
      if (!mountedRef.current) return;
      setEditingMeaning(false);
      setPendingExample(null);
      await refreshDetail();
      onCardChanged?.();
    } catch (err) {
      if (mountedRef.current) {
        setMeaningError("保存失败：" + (err?.message || err));
      }
    } finally {
      if (mountedRef.current) setSavingMeaning(false);
    }
  };

  const openMemoEditor = () => {
    if (!c || savingMemo) return;
    menuRef.current?.removeAttribute("open");
    if (editingMemo) {
      memoInputRef.current?.focus();
      return;
    }
    setMemoDraft(c.memo || "");
    setMemoError("");
    setEditingMemo(true);
  };

  const cancelMemoEditor = () => {
    if (savingMemo) return;
    setEditingMemo(false);
    setMemoError("");
  };

  const saveMemoEdit = async () => {
    if (!c || savingMemo) return;
    const trimmed = memoDraft.trim();
    if (!trimmed) {
      setMemoError("请输入记忆法内容，或点击取消");
      return;
    }
    setSavingMemo(true);
    setMemoError("");
    try {
      await api(`/api/memos/${c.id}`, { method: "PUT", body: JSON.stringify({ content: trimmed }) });
      if (!mountedRef.current) return;
      setCard((prev) => (prev ? { ...prev, memo: trimmed } : prev));
      setEditingMemo(false);
    } catch (err) {
      if (mountedRef.current) {
        setMemoError("保存失败：" + (err?.message || err));
      }
    } finally {
      if (mountedRef.current) setSavingMemo(false);
    }
  };

  if (loading) return <div className="story-empty">加载中…</div>;
  if (!c) return <div role="alert" className="ec-callout is-err ec-callout-inline"><span>加载失败：{loadError}</span><div className="save-state-actions"><button className="btn btn-ghost btn-small" onClick={loadDetail}>重试加载</button><button className="btn btn-ghost btn-small" onClick={onBack}>返回单词本</button></div></div>;

  const contexts = Array.isArray(c.contexts) ? c.contexts : [];

  // 讲解三要素分行（用 | 分隔）
  const explanationParts = c.explanation ? c.explanation.split("|").map((s) => s.trim()).filter(Boolean) : [];

  const lastContact = c.last_contact;
  const contactText = lastContact
    ? `${new Date(lastContact.occurred_at).toLocaleString()} · ${SOURCE_LABELS[lastContact.source] || lastContact.source} · ${CONTACT_KIND_LABELS[lastContact.kind] || lastContact.kind} · 第 ${lastContact.card_revision} 版`
    : "暂无记录（旧数据未记录，保持未知）";

  return (
    <section className="view word-detail-view">
      <div className="page-head word-detail-toolbar">
        <button className="btn btn-ghost btn-small" onClick={onBack}><UiIcon name="back" /> {backLabel}</button>
        <span className="word-detail-location">/ <span>{c.kind === "sentence" ? "句子" : c.word}</span></span>
        <div className="word-detail-tools">
      {/* 自测按钮（句子卡不适合拼写测试，隐藏） */}
      {c.kind !== "sentence" && (
        <button className="btn btn-primary" onClick={() => {
          // 跳转到拼写练习，只测这一个词
          window.dispatchEvent(new CustomEvent("quiz-single-word", { detail: { card: c } }));
        }}><UiIcon name="words" />测这个词</button>
      )}


          <button className="btn btn-ghost" disabled={savingMeaning} onClick={openMeaningEditor}><UiIcon name="edit" />编辑内容</button>
          <details ref={menuRef} className="detail-menu">
            <summary aria-label="更多操作"><UiIcon name="more" /></summary>
            <div className="detail-menu-content">
              <button type="button" onClick={toggleHard}>{c.is_hard ? "取消困难词" : "标为困难词"}</button>
              <button type="button" onClick={openMemoEditor}>编辑记忆法</button>
              <button type="button" className="danger" onClick={deleteCard}>删除</button>
            </div>
          </details>
        </div>

      </div>

      <div className="word-detail-layout">
      <section className="word-detail-card" aria-label="词条内容">
        {c.kind === "sentence" ? (
          <>
            <div className="word-detail-header">
              <div className="word-detail-word word-detail-sentence">{c.example || c.word}</div>
              <button className="speak-btn" title="朗读" onClick={() => speakAnswer(c.example || c.word)} aria-label="朗读"><UiIcon name="speaker" /></button>
            </div>
            {c.difficulty === "reading" && <span className="diff-chip">阅读句</span>}
            {/* 意群切分（初学辅助）— 点击单块朗读，可跟读 */}
            <ChunkChips chunks={c.chunks} onSpeak={speakPlain} style={{ marginTop: 10 }} />
          </>
        ) : (
          <>
            <div className="word-detail-header">
              <div className="word-detail-word">{c.word}</div>
              <button className="speak-btn" title="朗读" onClick={() => speakAnswer(c.word)} aria-label="朗读"><UiIcon name="speaker" /></button>
            </div>
            {c.phonetic && <div className="word-detail-phonetic">{c.phonetic}</div>}
          </>
        )}
        <div className="word-detail-badges">
          <span className={`badge ${c.kind === "sentence" ? "badge-sentence" : "badge-word"}`}>{c.kind === "sentence" ? "句子" : "词"}</span>
          {c.graduated && <span className="badge badge-graduated">句子练习已解锁</span>}
          {c.error_count > 0 && <span className="badge badge-error">错词×{c.error_count}</span>}
          {c.is_hard && <span className="badge badge-error">⭕ 困难词</span>}
        </div>

        <h2 className="word-section-title">{c.kind === "sentence" ? "译文" : "词义"}</h2>
        {editingMeaning ? (
          <InlineDetailEditor
            id="word-meaning-input"
            label={c.kind === "sentence" ? "编辑译文" : "编辑词义"}
            value={meaningDraft}
            onChange={setMeaningDraft}
            onSave={saveMeaningEdit}
            onCancel={cancelMeaningEditor}
            saving={savingMeaning}
            error={meaningError}
            placeholder={c.kind === "sentence" ? "输入中文译文…" : "输入中文释义…"}
            saveLabel="保存"
            inputRef={meaningInputRef}
          />
        ) : (
          <div className="word-detail-meaning">{c.kind === "sentence" ? (c.example_cn || "") : (c.meaning || "")}</div>
        )}

        {c.kind !== "sentence" && <ExpansionPracticeLinks cardId={c.id} onStart={onStartExpansionPractice} />}
        {c.kind !== "sentence" && <WordExpansions
          key={`${c.id}:${c.content_revision?.identity}:${c.content_revision?.version}`}
          card={c}
          onOpenCard={openExpansionCard}
          onConflict={refreshDetail}
          onUpdate={(related_words) => setCard(current => (
            current?.id === c.id &&
            current.content_revision?.identity === c.content_revision?.identity &&
            current.content_revision?.version === c.content_revision?.version
              ? {...current, related_words} : current
          ))}
        />}

        {/* 例句（或换例句对比） */}
        {pendingExample ? (
          <div className="example-compare">
            <div className="example-compare-label">旧例句：</div>
            <div className="example-compare-old">{pendingExample.old.example}</div>
            <div className="example-cn">{pendingExample.old.example_cn}</div>
            <div className="example-compare-label" style={{ marginTop: 10 }}>新例句：</div>
            <div className="example-compare-new">{pendingExample.new.example}</div>
            <div className="example-cn">{pendingExample.new.example_cn}</div>
            {pendingExample.new.explanation && (
              <div className="explanation-box" style={{ marginTop: 8 }}>
                {pendingExample.new.explanation.split("|").map((s, i) => (
                  <div key={i} className="exp-line"><span className="exp-tag">{["用法", "搭配", "易错"][i] || ""}</span>{s.trim()}</div>
                ))}
              </div>
            )}
            <div className="example-compare-actions">
              <button className="btn btn-ghost btn-small" disabled={savingExample} onClick={() => {
                setPendingExample(null);
              }}>保留旧的</button>
              <button className="btn btn-primary btn-small" disabled={savingExample} onClick={applyPendingExample}>
                {savingExample ? "保存中…" : "用新的"}
              </button>
            </div>
          </div>
        ) : (
          <>
            {/* 词卡：显示例句 */}
            {c.example && c.kind !== "sentence" && (
              <>
              <h2 className="word-section-title">例句</h2>
              <div className="word-detail-example">
                <span>{c.example}</span>
                <button className="speak-mini" title="朗读例句" onClick={() => speakPlain(c.example)} aria-label="朗读"><UiIcon name="speaker" /></button>
                <button className="memo-edit-btn" title="换一个例句" disabled={regenerating} onClick={regenerate} aria-label="换一个例句"><UiIcon name="refresh" /></button>
              </div>
              </>
            )}
            {c.example_cn && c.kind !== "sentence" && (
              <div className="example-cn">{c.example_cn}</div>
            )}
            {/* 句子卡：例句已在头部显示，这里显示中文翻译 */}
            {c.kind === "sentence" && c.example_cn && (
              <div className="example-cn" style={{ fontSize: 15, marginTop: 4 }}>{c.example_cn}</div>
            )}
          </>
        )}

        {/* 讲解三要素 */}
        {explanationParts.length > 0 && (
          <div className="explanation-box">
            {explanationParts.length >= 1 && <div className="exp-line"><span className="exp-tag">用法</span>{explanationParts[0]}</div>}
            {explanationParts.length >= 2 && <div className="exp-line"><span className="exp-tag">搭配</span>{explanationParts[1]}</div>}
            {explanationParts.length >= 3 && <div className="exp-line"><span className="exp-tag">易错</span>{explanationParts[2]}</div>}
          </div>
        )}

        <h2 className="word-section-title">记忆法</h2>
        {/* 记忆法（原位编辑，保持纸书阅读流） */}
        {editingMemo ? (
          <InlineDetailEditor
            id="word-memo-input"
            label="编辑记忆法"
            multiline
            value={memoDraft}
            onChange={setMemoDraft}
            onSave={saveMemoEdit}
            onCancel={cancelMemoEditor}
            saving={savingMemo}
            error={memoError}
            placeholder="怎么写这个单词记得更牢？（谐音 / 词根 / 联想 / 小故事）"
            saveLabel="保存记忆法"
            inputRef={memoInputRef}
          />
        ) : c.memo ? (
          <div className="word-detail-memo">
            <span className="word-detail-memo-label">我的记忆法</span>
            <span>{c.memo}</span>
            <button type="button" className="memo-edit-btn" onClick={openMemoEditor} aria-label="编辑记忆法"><UiIcon name="edit" /></button>
          </div>
        ) : (
          <button type="button" className="btn btn-ghost btn-small" onClick={openMemoEditor}>写个记忆法</button>
        )}

        {/* 对话体语境 */}
        {contexts.length > 0 && (
          <div className="bubble-list" style={{ marginTop: 14 }}>
            {contexts.map((ctx, i) => (
              <div key={i} className={`bubble ${i % 2 === 0 ? "bubble-a" : "bubble-b"}`}>
                <div className="bubble-en">{ctx.en}</div>
                <div className="bubble-cn">{ctx.cn}</div>
              </div>
            ))}
          </div>
        )}

        <div className="detail-nav">
          {prevCard && <button className="btn btn-ghost btn-small" onClick={() => setDetail(prevCard.id)}>← 上一个</button>}
          {nextCard && <button className="btn btn-ghost btn-small" onClick={() => setDetail(nextCard.id)}>下一个 →</button>}
        </div>
        <div className="word-self-rating">
          <h2 className="word-section-title">自评</h2>
          <p className="add-hint">自评记录与客观作答分开统计。</p>
      {/* 评分 */}
      <div className="rating-area" style={{ marginTop: 20 }}>
        <RatingButtons
          onRate={rateCard}
          disabled={attempt.phase === "saving" || attempt.phase === "failed"}
        />
        {attempt.phase === "saving" && (
          <p role="status" className="save-state">正在确认保存…</p>
        )}
        {attempt.phase === "failed" && (
          <div role="alert" className="save-state save-state-error">
            <p>{attempt.error}</p>
            <div className="save-state-actions">
              <button className="btn btn-primary btn-small" onClick={retryRating}>继续确认保存</button>
              <button className="btn btn-ghost btn-small" onClick={attempt.clear}>放弃这条待确认</button>
            </div>
          </div>
        )}
      </div>


        </div>
      </section>
      <aside className="word-detail-evidence" aria-label="学习状态与记录">
        <h2 className="word-section-title">学习状态</h2>
        {/* 回忆证据：真实样本/日期/适用性，不用复习次数推断掌握 */}
        <LearningEvidence evidence={c.learning_evidence} />

        {/* 应用内接触：只来自实际展示/播放，不作为作答或完成量 */}
        <div className="word-detail-status wd-inspector-group wd-contact-group" data-testid="last-contact">
          <div className="status-item status-item-stacked">
            <span className="status-label">最近应用内接触</span>
            <span className="status-value wd-tabular">{contactText}</span>
          </div>
          <div className="status-item status-item-kv">
            <span className="status-label">接触依据</span>
            <span className="status-value wd-subtle-pill">{c.contact_integrity?.label || "未知"}</span>
          </div>
        </div>
        {contactState.phase === "saving" && (
          <p role="status" className="save-state">正在确认接触记录…</p>
        )}
        {contactState.phase === "failed" && (
          <div role="alert" className="save-state save-state-error">
            <p>
              接触依据不完整：{contactState.error}
              {contactState.durable === false
                ? "（本地存储不可用，刷新后无法继续确认）"
                : ""}
            </p>
            {contactState.retryable && (
              <div className="save-state-actions">
                <button
                  className="btn btn-primary btn-small"
                  onClick={() => confirmContact(contactState.kind || "answer_visible")}
                >
                  继续确认保存
                </button>
              </div>
            )}
          </div>
        )}

      {/* 状态卡 */}
      <div className="word-detail-status wd-kpi-grid">
        <div className="status-item wd-kpi-tile"><span className="status-label">复习次数</span><span className="status-value">{c.review_count}</span></div>
        <div className="status-item wd-kpi-tile"><span className="status-label">状态</span><span className="status-value" data-state={c.graduated ? "graduated" : c.review_count > 0 ? "learning" : "new"}>{c.graduated ? "句子练习已解锁" : c.review_count > 0 ? "学习中" : "新词"}</span></div>
        <div className="status-item wd-kpi-tile"><span className="status-label">下次复习</span><span className="status-value">{c.next_due ? new Date(c.next_due).toLocaleDateString() : "-"}</span></div>
      </div>

      {/* 内容修订：词形/释义等实质变化才增加版本 */}
      <div className="word-detail-status wd-inspector-group wd-revision-group" data-testid="revision-panel">
        <div className="status-item status-item-kv">
          <span className="status-label">内容修订</span>
          <span className="status-value wd-subtle-pill">第 {c.content_revision?.version ?? 1} 版</span>
        </div>
        <div className="status-item status-item-kv">
          <span className="status-label">修订身份</span>
          <code className="status-value wd-code-pill">{c.content_revision?.identity?.slice(0, 8) || "-"}</code>
        </div>
      </div>

      {/* 学习记录：只展示真实追加事件；旧基线不伪装成作答 */}
      {(c.history_incomplete || c.learning_events?.length > 0 || c.memory_state) && (
      <div className="wd-history-section">
        <h3 className="lesson-section">学习记录</h3>
        {c.history_incomplete && (
          <div className="ec-callout is-warn history-incomplete-notice">
            部分历史记录不完整：升级前或未分类的旧评分无法逐次还原；下方展示已记录的新事件与最后可知活动。
            {c.memory_state?.last_review && (
              <div>
                最后可知活动：
                {new Date(c.memory_state.last_review).toLocaleString()} · 累计{" "}
                {c.memory_state.review_count} 次
              </div>
            )}
          </div>
        )}
        {c.learning_events?.length > 0 ? (
          <div className="timeline">
            {[...c.learning_events].reverse().map((event) => (
              <LearningEventRow key={event.event_id} event={event} />
            ))}
          </div>
        ) : c.memory_state ? (
          <div className="ec-callout is-info is-compact">
            升级前累计复习 {c.memory_state.review_count} 次
            {c.memory_state.last_review
              ? ` · 最后可知活动 ${new Date(c.memory_state.last_review).toLocaleDateString()}`
              : ""}
          </div>
        ) : null}
      </div>
      )}


      </aside>
      </div>
    </section>
  );
}
