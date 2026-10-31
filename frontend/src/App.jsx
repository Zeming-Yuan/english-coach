import React, { useState, useEffect, useRef, useCallback, Component } from "react";
import { api } from "./lib/api.js";
import { storageGet, storageSet } from "./lib/utils.js";
import { setTtsRate } from "./lib/tts.js";
import { loadPending, sendPending, clearPending } from "./lib/learning.js";
import StudyPage from "./views/StudyPage.jsx";
import DailySessionPage from "./views/DailySessionPage.jsx";
import QuizPage from "./views/QuizPage.jsx";
import SpellingPage from "./views/SpellingPage.jsx";
import ListeningPage from "./views/ListeningPage.jsx";
import MixedPage from "./views/MixedPage.jsx";
import WordsPage from "./views/WordsPage.jsx";
import StoriesPage from "./views/StoriesPage.jsx";
import AddPage from "./views/AddPage.jsx";
import StatsPage from "./views/StatsPage.jsx";
import SettingsPage from "./views/SettingsPage.jsx";
import BackupPage from "./views/BackupPage.jsx";
import LessonsPage from "./views/LessonsPage.jsx";
import { useStarterCards } from "./hooks/useStarterCards.js";

/* ============ 视图路由 ============ */
const NAV_TABS = { queue: "队列", words: "单词本", stories: "故事", add: "加词" };

/* ============ Toast 系统 ============ */
let _toastTimeout = null;
export function showToast(msg, actionLabel = null, action = null) {
  window.__toastData = { msg, actionLabel, action };
  window.dispatchEvent(new Event("toast"));
  clearTimeout(_toastTimeout);
  _toastTimeout = setTimeout(() => {
    window.__toastData = null;
    window.dispatchEvent(new Event("toast"));
  }, actionLabel ? 4000 : 2600);
}

function Toast() {
  const [data, setData] = useState(null);
  useEffect(() => {
    const h = () => setData(window.__toastData || null);
    window.addEventListener("toast", h);
    return () => window.removeEventListener("toast", h);
  }, []);
  if (!data) return null;
  return (
    <div className={`toast ${data ? "show" : ""}`}>
      {data.msg}
      {data.actionLabel && data.action && (
        <button className="toast-action" onClick={() => { data.action(); setData(null); }}>
          {data.actionLabel}
        </button>
      )}
    </div>
  );
}

/* ============ 待确认保存恢复（EC-04） ============ */
const PENDING_PREFIX = "ec.pending.";

function pendingScopes() {
  try {
    const scopes = [];
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (key && key.startsWith(PENDING_PREFIX)) {
        scopes.push(key.slice(PENDING_PREFIX.length));
      }
    }
    return scopes;
  } catch {
    // storage 不可用：内存 pending 由仍挂载的页面自行提示，刷新后无从恢复。
    return [];
  }
}

function PendingRecovery({ onConfirmed }) {
  const [entries, setEntries] = useState(() =>
    pendingScopes()
      .map((scope) => ({ scope, pending: loadPending(scope) }))
      .filter((entry) => entry.pending),
  );
  const [busyScope, setBusyScope] = useState(null);
  const [error, setError] = useState("");

  if (entries.length === 0) return null;

  const confirm = async (entry) => {
    setBusyScope(entry.scope);
    setError("");
    try {
      const result = await sendPending(entry.pending);
      if (result.committed !== true) throw new Error("尚未确认保存");
      if (loadPending(entry.scope)?.payload.submission_id === entry.pending.payload.submission_id) {
        clearPending(entry.scope);
      }
      setEntries((list) => list.filter((item) => item.scope !== entry.scope));
      showToast("已确认保存这条学习记录");
      onConfirmed(result, entry.pending);
    } catch (e) {
      setError("继续确认失败：" + (e?.message || e));
    } finally {
      setBusyScope(null);
    }
  };

  const abandon = (entry) => {
    clearPending(entry.scope);
    setEntries((list) => list.filter((item) => item.scope !== entry.scope));
  };

  return (
    <div className="pending-recovery">
      {entries.map((entry) => (
        <div key={entry.scope} className="pending-recovery-item">
          <p role="status">有一条学习记录尚未确认保存；刷新后可能需要重新核对。</p>
          <div className="save-state-actions">
            <button
              className="btn btn-primary btn-small"
              disabled={busyScope === entry.scope}
              onClick={() => confirm(entry)}
            >
              继续确认保存
            </button>
            <button className="btn btn-ghost btn-small" onClick={() => abandon(entry)}>
              放弃这条待确认
            </button>
          </div>
        </div>
      ))}
      {error && <p role="alert" className="err">{error}</p>}
    </div>
  );
}

/* ============ 错误边界 ============ */
class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error) {
    return { error };
  }
  componentDidCatch(error, info) {
    console.error("[App] 渲染错误:", error, info);
  }
  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 20, fontFamily: "monospace", fontSize: 14 }}>
          <h3>⚠️ 页面崩溃了</h3>
          <p style={{ color: "#c00" }}>{String(this.state.error?.message || this.state.error)}</p>
          <pre style={{ whiteSpace: "pre-wrap", maxHeight: 300, overflow: "auto", background: "#f5f5f5", padding: 10 }}>
            {String(this.state.error?.stack || "")}
          </pre>
          <button className="btn btn-primary" onClick={() => this.setState({ error: null })}>重试</button>
        </div>
      );
    }
    return this.props.children;
  }
}

/* ============ 主应用 ============ */
export default function App() {
  const [view, setView] = useState("queue");
  const [studyQueue, setStudyQueue] = useState([]);
  const [isDailyStudy, setIsDailyStudy] = useState(false);
  const [dailySession, setDailySession] = useState(() => storageGet("activeDailySession", null));
  const updateDaily = (session) => {
    storageSet("activeDailySession", session?.finished ? null : session);
    setDailySession(session);
  };
  const updateDailyDetails = (sessionId, details) => {
    setDailySession((current) => {
      if (!current || current.id !== sessionId || current.finished) return current;
      const next = {...current, ...details};
      storageSet("activeDailySession", next);
      return next;
    });
  };
  const confirmDailyCard = (command, result) => {
    if (result?.committed !== true || result.card_id !== command?.card_id || command.stage !== "main") return;
    setDailySession((current) => {
      if (!current || current.id !== command.session_id || current.queue[current.index]?.id !== command.card_id) return current;
      const index = current.index + 1;
      const next = { ...current, index, complete: index >= current.target };
      storageSet("activeDailySession", next.finished ? null : next);
      return next;
    });
  };
  const startDaily = (data) => {
    const session = { id: crypto.randomUUID(), queue: data.queue, target: data.target, index: 0, remainingDue: data.remaining_due, reviewCount: data.review_count, newCount: data.new_count };
    updateDaily(session);
    setIsDailyStudy(true);
    setStudyQueue(session.queue);
    setView("study");
  };
  const [singleCard, setSingleCard] = useState(null);
  const [restoringBackup, setRestoringBackup] = useState(false);
  const [queueVersion, setQueueVersion] = useState(0);
  const [darkMode, setDarkMode] = useState(() => storageGet("darkMode", false));

  // 设置初始化
  useEffect(() => {
    const rate = storageGet("ttsRate", 0.9);
    setTtsRate(rate);
    document.body.classList.toggle("dark", darkMode);
  }, [darkMode]);

  // 监听"测这个词"事件（从单词详情页跳转）
  useEffect(() => {
    const handler = (e) => {
      setSingleCard(e.detail.card);
      setView("spelling");
    };
    window.addEventListener("quiz-single-word", handler);
    return () => window.removeEventListener("quiz-single-word", handler);
  }, []);

  // 入门词卡：首页空态与「加词」页共用同一个显式添加动作（无需 AI）
  const addStarterCards = useCallback(
    () => api("/api/cards/starter", { method: "POST" }),
    []
  );

  const isNavView = NAV_TABS[view] !== undefined;

  return (
    <div className={`app ${!isNavView ? "practice-mode" : ""}`}>
      {/* 顶栏 */}
      <header className="topbar">
        <div className="logo">
          <span className="logo-mark">E</span>
          <span className="logo-text">EnglishCoach</span>
        </div>
        <button className="settings-btn" title="设置" aria-label="设置" disabled={restoringBackup} onClick={() => setView(view === "settings" ? "queue" : "settings")}>⚙️</button>
      </header>

      {/* 内容区 */}
      <ErrorBoundary>
      <main className="stage">
        {view !== "study" && <PendingRecovery onConfirmed={(result, pending) => {
          confirmDailyCard(pending.payload, result);
          setQueueVersion((v) => v + 1);
        }} />}
        {view === "queue" && <QueueView key={queueVersion} setView={setView} setStudyQueue={(cards) => { setIsDailyStudy(false); setStudyQueue(cards); }} dailySession={dailySession} onStartDaily={startDaily} onResumeDaily={() => {
          setIsDailyStudy(true); setStudyQueue(dailySession.queue); setView("study");
        }} onAddStarter={addStarterCards} />}
        {view === "words" && <WordsPage />}
        {view === "stories" && <StoriesPage />}
        {view === "add" && <AddPage onAddStarter={addStarterCards} onGoWords={() => setView("words")} onStartStudy={(cards) => { setIsDailyStudy(false); setStudyQueue(cards); setView("study"); }} />}
        {view === "stats" && <StatsPage onBack={() => setView("queue")} />}
        {view === "settings" && <SettingsPage darkMode={darkMode} setDarkMode={setDarkMode} onOpenBackup={() => setView("backup")} />}
        {view === "backup" && <BackupPage restoring={restoringBackup} onRestoringChange={setRestoringBackup} onBack={() => setView("settings")} onRestored={() => {
          setIsDailyStudy(false);
          updateDaily(null);
          setStudyQueue([]);
          setSingleCard(null);
          setQueueVersion((v) => v + 1);
        }} />}
        {view === "lessons" && <LessonsPage onExit={() => setView("queue")} />}
        {view === "study" && (isDailyStudy ? <DailySessionPage session={dailySession} onSessionChange={(details) => updateDailyDetails(dailySession.id, details)} onFinish={() => { updateDaily({...dailySession, finished: true}); setView("queue"); }} recoveryVersion={queueVersion} onAbort={() => { setIsDailyStudy(false); updateDaily(null); setStudyQueue([]); setView("queue"); }} onProgress={confirmDailyCard} queue={studyQueue} onExit={() => setView("queue")} onToQuiz={() => setView("quiz")} onToMixed={() => setView("mixed")} /> : <StudyPage recoveryVersion={queueVersion} session={isDailyStudy ? dailySession : null} onAbort={() => { setIsDailyStudy(false); updateDaily(null); setStudyQueue([]); setView("queue"); }} onProgress={confirmDailyCard} queue={studyQueue} onExit={() => setView("queue")} onToQuiz={() => setView("quiz")} onToMixed={() => setView("mixed")} />)}
        {view === "quiz" && <QuizPage onExit={() => setView("queue")} />}
        {view === "spelling" && <SpellingPage onExit={() => { setView("queue"); setSingleCard(null); }} singleCard={singleCard} />}
        {view === "listening" && <ListeningPage onExit={() => setView("queue")} />}
        {view === "mixed" && <MixedPage onExit={() => setView("queue")} />}
      </main>
      </ErrorBoundary>

      {/* 底部导航（练习视图时滑出屏幕） */}
      <nav className={`bottom-nav ${!isNavView ? "nav-hidden" : ""}`}>
        {Object.entries(NAV_TABS).map(([key, label]) => (
          <button
            key={key}
            className={`nav-item ${view === key ? "nav-active" : ""}`}
            disabled={restoringBackup}
            onClick={() => { if (!restoringBackup && isNavView) setView(key); }}
          >
            <span className="nav-icon">{key === "queue" ? "📋" : key === "words" ? "📖" : key === "stories" ? "📚" : "➕"}</span>
            <span>{label}</span>
          </button>
        ))}
      </nav>

      <Toast />
    </div>
  );
}

/* ============ 队列页 ============ */
function QueueView({ setView, setStudyQueue, dailySession, onStartDaily, onResumeDaily, onAddStarter }) {
  const [data, setData] = useState(null);
  const [stats, setStats] = useState(null);
  const [lessonData, setLessonData] = useState(null);
  const [recommended, setRecommended] = useState([]);
  const [loading, setLoading] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);
  const [loadError, setLoadError] = useState("");
  const [dailyGoal, setDailyGoal] = useState(() => storageGet("dailyGoal", 10));
  const {
    loading: starterLoading,
    error: starterError,
    addStarter: requestStarter,
  } = useStarterCards(onAddStarter);

  useEffect(() => {
    async function load() {
      try {
        const [todayData, statsData] = await Promise.all([
          api("/api/today"),
          api("/api/stats"),
        ]);
        setData(todayData);
        setStats(statsData);
        // 推荐词（遗忘曲线）
        try {
          const rd = await api("/api/recommended?limit=5");
          setRecommended(rd.recommended || []);
        } catch {}
        // 课程入口
        try {
          const ld = await api("/api/lessons");
          setLessonData(ld);
        } catch {}
      } catch (e) {
        console.error("加载队列失败", e);
        setLoadError(e?.message || String(e));
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [reloadKey]);

  if (loading) return <div className="story-empty">加载中…</div>;
  if (!data) {
    return (
      <div className="story-empty">
        <p role="alert">加载失败：{loadError || "未知错误"}</p>
        <button
          className="btn btn-primary"
          onClick={() => {
            setLoading(true);
            setLoadError("");
            setReloadKey((key) => key + 1);
          }}
        >
          重试
        </button>
      </div>
    );
  }

  // 显式添加入门词卡：成功后直接进入现有闪卡流程；失败停留本页可重试
  const addStarter = async () => {
    const result = await requestStarter();
    if (!result) return;
    if (result.cards.length > 0) {
      setStudyQueue(result.cards);
      setView("study");
    } else {
      showToast("入门词卡已存在，已为你打开单词本");
      setView("words");
    }
  };

  const activeSession = dailySession && !dailySession.finished ? dailySession : null;
  const errorCount = (data.error_cards || []).length;
  const isEmpty = stats?.total_cards === 0;

  // 每日最低目标、新词建议与本轮卡数分别表达。
  const done = stats?.reviewed_today || 0;
  const queueTotal = data.target;
  const adaptiveGoal = data.recommended_goal || 10;  // 后端自适应推荐
  const target = dailyGoal;
  const pct = target > 0 ? Math.min(1, done / target) : 0;
  const deg = Math.round(pct * 360);
  const hour = new Date().getHours();
  const showEveningReminder = hour >= 20 && done === 0;

  return (
    <section className="view view-center">
      <p className="eyebrow">今天的学习</p>

      {showEveningReminder && (
        <div className="evening-reminder">
          🌙 睡前的复习记忆最牢——今天学完再去睡吧
        </div>
      )}

      <div className="queue-cards">
        <div className="big-stat">
          <span className="big-number">{data.new_count}</span>
          <span className="big-label">个新词</span>
        </div>
        <div className="big-stat big-stat-alt">
          <span className="big-number">{data.review_count}</span>
          <span className="big-label">待复习</span>
        </div>
        {queueTotal > 0 && (
          <div className="goal-ring-wrap">
            <div className="goal-ring" style={{ background: `conic-gradient(var(--mint) ${deg}deg, #EBEDF0 ${deg}deg)` }}>
              <div className="goal-ring-inner">
                <span className="goal-num">{done}</span>
                <span className="goal-total">/ {target}</span>
              </div>
            </div>
            <div className="goal-text">
              <span className="goal-title">{done >= target ? "今日目标达成 🎉" : pct === 0 ? "每日最低目标" : "继续加油"}</span>
              <span className="goal-sub">
                {done >= target
                  ? `目标 ${target} 词已达成`
                  : `今日完成 ${done} 词 · 最低目标 ${target} 词`}
                {data.error_rate !== null && data.error_rate !== undefined && (
                  <span style={{ marginLeft: 8, fontSize: 10, opacity: 0.7 }}>
                    （近7天复习通过率 {100 - data.error_rate}%）
                  </span>
                )}
              </span>
              <span className="goal-sub" data-testid="new-word-limit">
                新词建议 {adaptiveGoal} 个 · 有效样本 {data.sample_count ?? 0}
              </span>
              <select
                className="goal-daily-set"
                value={dailyGoal}
                title="每日最低完成目标（不改变新词配额或本轮张数）"
                onChange={(e) => {
                  const n = parseInt(e.target.value);
                  setDailyGoal(n);
                  storageSet("dailyGoal", n);
                }}
              >
                <option value={5}>至少 5 词/日</option>
                <option value={10}>至少 10 词/日</option>
                <option value={15}>至少 15 词/日</option>
                <option value={20}>至少 20 词/日</option>
              </select>
            </div>
          </div>
        )}
      </div>

      {!isEmpty && queueTotal === 0 && !(dailySession && !dailySession.finished) && <div className="welcome-box">
        <h2>今日复习已完成</h2>
        <p>当前没有到期词或待学新词，可以继续练习，也可以添加新词。</p>
        <button className="btn btn-ghost" onClick={() => setView("add")}>添加新词</button>
      </div>}

      {/* 欢迎页 */}
      {isEmpty && (
        <div className="welcome-box">
          <div className="welcome-emoji">👋</div>
          <h2>欢迎来到 EnglishCoach</h2>
          <p>AI 会根据你的记忆安排每天学什么。<br />先加几个想学的词，马上开始！</p>
          <button className="btn btn-primary" onClick={() => setView("add")}>先加几个词</button>
          <button className="btn btn-ghost" onClick={() => setView("backup")}>恢复备份</button>
          <button className="btn btn-ghost" onClick={addStarter} disabled={starterLoading}>
            {starterLoading ? "正在添加…" : "体验入门词卡"}
          </button>
          <p className="add-hint">无需 AI：加入 10 张已核对释义、音标和例句的入门词卡</p>
          {starterError && (
            <p role="alert" className="err">添加失败：{starterError}，请重试</p>
          )}
        </div>
      )}

      {(activeSession || queueTotal > 0) && <>
        <p data-testid="round-target">本轮目标 {activeSession?.target ?? data.target} 张 · 到期复习 {activeSession?.reviewCount ?? data.review_count} 张 · 新词 {activeSession?.newCount ?? data.new_count} 个</p>
        <p data-testid="remaining-due">另有 {activeSession?.remainingDue ?? data.remaining_due} 张到期词，完成后可继续下一轮</p>
        <button className="btn btn-primary btn-large" onClick={() => activeSession ? onResumeDaily() : onStartDaily(data)}>
          {activeSession ? "继续本轮学习" : "开始今天的学习"}
        </button>
      </>}

      {/* 今日统计 */}
      {stats && (
        <div className="today-stats" style={{ cursor: "pointer" }} onClick={() => setView("stats")}>
          {stats.streak > 0 && <span className="streak-badge">🔥 <b>{stats.streak}</b> 天连续</span>}
          <span>
            今日完成 <b>{stats.reviewed_today}</b> 词 · 练习 <b>{stats.attempted_today}</b> 次 ·
            跳过 <b>{stats.skipped_today}</b> 次 · 累计 <b>{stats.total_cards}</b> 词
          </span>
        </div>
      )}

      <details>
        <summary>专项练习</summary>
      {/* 错词复习入口 */}
      {errorCount > 0 && (
        <div className="lesson-entry error-entry">
          <div className="lesson-entry-body">
            <div className="lesson-entry-label">⚠️ 错词复习</div>
            <div className="lesson-entry-sub">上次答错的 <b>{errorCount}</b> 个词 · 优先重现效果最好</div>
          </div>
          <button className="btn btn-primary btn-small" onClick={() => {
            setStudyQueue(data.error_cards || []);
            setView("study");
          }}>复习 →</button>
        </div>
      )}

      {/* 每日推荐词（遗忘曲线） */}
      {recommended.length > 0 && (
        <div className="lesson-entry" style={{ background: "linear-gradient(135deg, #FFF8F0, #FFF0F0)" }}>
          <div className="lesson-entry-body">
            <div className="lesson-entry-label">⏰ 推荐复习</div>
            <div className="lesson-entry-sub">
              {recommended.length} 个词即将遗忘 · 现在复习效果最好
            </div>
            <div className="recommended-words">
              {recommended.map((c, i) => (
                <span key={i} className="recommended-chip">{c.word}</span>
              ))}
            </div>
          </div>
          <button className="btn btn-primary btn-small" onClick={() => {
            setStudyQueue(recommended);
            setView("study");
          }}>复习 →</button>
        </div>
      )}

      {/* 课程入口 */}
      {lessonData && (
        <div className="lesson-entry">
          <div className="lesson-entry-body">
            <div className="lesson-entry-label">
              {lessonData.is_done ? "全部完成 🎓" : "继续课程"}
            </div>
            <div className="lesson-entry-title">
              {lessonData.is_done
                ? "20 级课程全部完成！"
                : lessonData.lessons.length > 0
                  ? `第 ${lessonData.lessons[lessonData.lessons.length - 1].level} 课 · ${lessonData.lessons[lessonData.lessons.length - 1].title}`
                  : "开始零基础课程"}
            </div>
            <div className="lesson-entry-sub">
              {lessonData.is_done
                ? "继续用队列/故事巩固吧"
                : `已完成 ${lessonData.lessons.length}/20 课 · 下一课：${lessonData.next_level}`}
            </div>
          </div>
          {!lessonData.is_done && (
            <button className="btn btn-primary btn-small" onClick={() => setView("lessons")}>
              {lessonData.lessons.length === 0 ? "开始" : "继续 →"}
            </button>
          )}
          {lessonData.is_done && (
            <button className="btn btn-ghost btn-small" onClick={() => setView("lessons")}>回顾</button>
          )}
        </div>
      )}

      {!isEmpty && (
        <>
          <button className="btn btn-ghost" onClick={() => setView("quiz")}>直接做测验</button>
          <button className="btn btn-ghost" onClick={() => setView("listening")}>🎧 听写练习</button>
          <button className="btn btn-ghost" onClick={() => setView("spelling")}>⌨️ 拼写练习</button>
          <button className="btn btn-ghost" onClick={() => setView("mixed")}>🎲 混合练习</button>
        </>
      )}
      </details>
    </section>
  );
}

/* ============ 占位视图 ============ */
function PlaceholderView({ name }) {
  return (
    <section className="view view-center">
      <div className="story-empty">🚧 {name} — 待迁移</div>
    </section>
  );
}
