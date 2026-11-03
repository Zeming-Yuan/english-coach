import React, { useState, useEffect, useRef, useCallback, Component } from "react";
import { api } from "./lib/api.js";
import { storageGet, storageSet } from "./lib/utils.js";
import { setTtsRate } from "./lib/tts.js";
import { refreshPendingContacts } from "./lib/contacts.js";
import { loadPending, sendPending, clearPending, savePending } from "./lib/learning.js";
import DurationRecovery from "./components/DurationRecovery.jsx";
import ScenePage from "./views/ScenePage.jsx";
import StudyPage from "./views/StudyPage.jsx";
import DailySessionPage from "./views/DailySessionPage.jsx";
import QuizPage from "./views/QuizPage.jsx";
import SpellingPage from "./views/SpellingPage.jsx";
import ListeningPage from "./views/ListeningPage.jsx";
import MixedPage from "./views/MixedPage.jsx";
import WordsPage from "./views/WordsPage.jsx";
import StoriesPage from "./views/StoriesPage.jsx";
import AddPage from "./views/AddPage.jsx";
import LearningAdvice from "./components/LearningAdvice.jsx";
import AdvicePracticePage from "./views/AdvicePracticePage.jsx";
import StatsPage from "./views/StatsPage.jsx";
import DelayedCheckPage from "./views/DelayedCheckPage.jsx";
import SettingsPage from "./views/SettingsPage.jsx";
import BackupPage from "./views/BackupPage.jsx";
import LessonsPage from "./views/LessonsPage.jsx";
import { useStarterCards } from "./hooks/useStarterCards.js";
import AppNavigation from "./components/AppNavigation.jsx";
import UiIcon, {navigationIcons} from "./components/UiIcon.jsx";
import {CaretRightIcon} from "@phosphor-icons/react/dist/csr/CaretRight";
import {StackIcon} from "@phosphor-icons/react/dist/csr/Stack";

/* ============ 视图路由 ============ */
const NAV_TABS = { queue: "队列", words: "单词本", stories: "故事", add: "加词" };
const VIEW_LABELS = {queue: "每日学习", lessons: "课程", words: "单词本", stories: "故事", add: "添加单词", stats: "学习记录", settings: "偏好设置", backup: "备份与恢复", study: "词卡学习", spelling: "拼写练习", listening: "听写练习", quiz: "测验", mixed: "混合练习", advice: "建议练习", delayed: "延迟回测"};

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
      const pending = refreshPendingContacts(loadPending(entry.scope) || entry.pending);
      savePending(entry.scope, pending);
      const result = await sendPending(pending);
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
  const [adviceRequest, setAdviceRequest] = useState(null);
  const startAdvice = request => {setAdviceRequest(request); setView("advice");};
  const [delayedWindow, setDelayedWindow] = useState("week");
  const startDelayed = (window) => { setDelayedWindow(window); setView("delayed"); };
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
    const session = { id: crypto.randomUUID(), queue: data.queue, target: data.target, index: 0, remainingDue: data.remaining_due, reviewCount: data.review_count, newCount: data.new_count, plan: data.plan, startedAt: Date.now() };
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

  const isNavView = ["queue", "lessons", "words", "stories", "add", "stats", "settings", "backup"].includes(view);

  return (
    <div className={`app product-app view-${view} ${!isNavView ? "practice-mode" : ""} ${view === "stories" ? "story-workspace" : ""}`}>
      <AppNavigation view={view} onNavigate={setView} disabled={restoringBackup} />
      {/* 顶栏 */}
      <header className="topbar">
        <div className="logo">
          <UiIcon name="book" size={28} weight="fill" />
          <span className="logo-text">EnglishCoach</span>
        </div>
        <span className="workspace-location">{view === "queue" ? "今日学习工作台" : VIEW_LABELS[view]}</span>
        <div className="workspace-header-actions">
          {view === "queue" && <time className="home-date" dateTime={new Date().toLocaleDateString("en-CA")}>{new Intl.DateTimeFormat("zh-CN", {month: "long", day: "numeric", weekday: "short"}).format(new Date())}</time>}
          <button className="workspace-header-link" aria-label="打开课程" disabled={restoringBackup} onClick={() => setView("lessons")}><UiIcon name="book" /><span>课程</span></button>
          <button className="workspace-header-link" aria-label="学习记录" disabled={restoringBackup} onClick={() => setView("stats")}><UiIcon name="stats" /></button>
          <button className="settings-btn" title="设置" aria-label="设置" disabled={restoringBackup} onClick={() => setView(view === "settings" ? "queue" : "settings")}><UiIcon name="settings" /></button>
        </div>
      </header>

      {/* 内容区 */}
      <ErrorBoundary>
      <main className="stage">
        <DurationRecovery />
        {view !== "study" && view !== "scene" && <PendingRecovery onConfirmed={(result, pending) => {
          confirmDailyCard(pending.payload, result);
          setQueueVersion((v) => v + 1);
        }} />}
        {view === "queue" && <QueueView onAdvice={startAdvice} key={queueVersion} setView={setView} onDelayed={startDelayed} setStudyQueue={(cards) => { setIsDailyStudy(false); setStudyQueue(cards); }} dailySession={dailySession} onStartDaily={startDaily} onResumeDaily={() => {
          setIsDailyStudy(true); setStudyQueue(dailySession.queue); setView("study");
        }} onAddStarter={addStarterCards} />}
        {view === "scene" && <ScenePage onExit={() => setView("queue")} />}
        {view === "words" && <WordsPage />}
        {view === "stories" && <StoriesPage onNavigate={setView} />}
        {view === "add" && <AddPage onAddStarter={addStarterCards} onGoWords={() => setView("words")} onStartStudy={(cards) => { setIsDailyStudy(false); setStudyQueue(cards); setView("study"); }} />}
        {view === "stats" && <StatsPage onAdvice={startAdvice} onBack={() => setView("queue")} onDelayed={startDelayed} />}
        {view === "advice" && <AdvicePracticePage request={adviceRequest} onExit={() => setView("stats")} onNormal={() => setView("spelling")} />}
        {view === "delayed" && <DelayedCheckPage key={delayedWindow} window={delayedWindow} onExit={() => setView("stats")} onNormal={() => setView("spelling")} />}
        {view === "settings" && <SettingsPage darkMode={darkMode} setDarkMode={setDarkMode} onOpenBackup={() => setView("backup")} />}
        {view === "backup" && <BackupPage restoring={restoringBackup} onRestoringChange={setRestoringBackup} onBack={() => setView("settings")} onRestored={() => {
          setAdviceRequest(null);
          try { localStorage.removeItem("ec.advice.request"); } catch {}
          setIsDailyStudy(false);
          updateDaily(null);
          setStudyQueue([]);
          setSingleCard(null);
          setQueueVersion((v) => v + 1);
        }} />}
        {view === "lessons" && <LessonsPage onExit={() => setView("queue")} />}
        {view === "study" && (isDailyStudy ? <DailySessionPage session={dailySession} onSessionChange={(details) => updateDailyDetails(dailySession.id, details)} onFinish={() => { updateDaily({...dailySession, finished: true}); setView("queue"); }} onPauseExit={() => setView("queue")} recoveryVersion={queueVersion} onAbort={() => { setIsDailyStudy(false); updateDaily(null); setStudyQueue([]); setView("queue"); }} onProgress={confirmDailyCard} queue={studyQueue} onExit={() => setView("queue")} onToQuiz={() => setView("quiz")} onToMixed={() => setView("mixed")} /> : <StudyPage recoveryVersion={queueVersion} session={isDailyStudy ? dailySession : null} onAbort={() => { setIsDailyStudy(false); updateDaily(null); setStudyQueue([]); setView("queue"); }} onProgress={confirmDailyCard} queue={studyQueue} onExit={() => setView("queue")} onToQuiz={() => setView("quiz")} onToMixed={() => setView("mixed")} />)}
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
            <span className="nav-icon"><UiIcon name={navigationIcons[key]} size={23} /></span>
            <span>{label}</span>
          </button>
        ))}
      </nav>

      <Toast />
    </div>
  );
}

/* ============ 队列页 ============ */
// The home preview must not display an English answer before independent recall.
function homeChinesePreview(value, fallback = "") {
  const text = typeof value === "string" ? value.trim().replace(/^(?:(?:n|v|vt|vi|adj|adv|prep|pron|conj|interj|num|art)\.\s*)+/i, "") : "";
  return text && !/[a-z]/i.test(text) ? text : fallback;
}

function QueueView({ onAdvice, onDelayed, setView, setStudyQueue, dailySession, onStartDaily, onResumeDaily, onAddStarter }) {
  const [data, setData] = useState(null);
  const [stats, setStats] = useState(null);
  const [lessonData, setLessonData] = useState(null);
  const [storyData, setStoryData] = useState(null);
  const [materialErrors, setMaterialErrors] = useState({});
  const [materialsLoading, setMaterialsLoading] = useState({lessons: true, stories: true});
  const [recommended, setRecommended] = useState([]);
  const [recommendedReload, setRecommendedReload] = useState(0);
  const [loading, setLoading] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);
  const [loadError, setLoadError] = useState("");
  const [budget, setBudget] = useState(() => {
    const saved = storageGet("timeBudget", 8);
    return [3, 8, 15].includes(saved) ? saved : 8;
  });
  const [mode, setMode] = useState("regular");
  const [dailyGoal, setDailyGoal] = useState(() => storageGet("dailyGoal", 10));
  const {
    loading: starterLoading,
    error: starterError,
    addStarter: requestStarter,
  } = useStarterCards(onAddStarter);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const [todayData, statsData] = await Promise.all([
          api(mode === "recovery" ? "/api/today?budget_minutes=3&mode=recovery" : budget === 8 ? "/api/today" : `/api/today?budget_minutes=${budget}`),
          api("/api/stats"),
        ]);
        if (cancelled) return;
        setData(todayData);
        setStats(statsData);
      } catch (e) {
        if (cancelled) return;
        console.error("加载队列失败", e);
        setLoadError(e?.message || String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    async function loadMaterial(key, path, update) {
      try {
        const result = await api(path);
        if (!cancelled) update(result);
      } catch {
        if (!cancelled) setMaterialErrors(current => ({...current, [key]: true}));
      } finally {
        if (!cancelled) setMaterialsLoading(current => ({...current, [key]: false}));
      }
    }
    setLoading(true);
    setData(null);
    setLoadError("");
    setMaterialErrors({});
    setMaterialsLoading({lessons: true, stories: true});
    load();
    loadMaterial("lessons", "/api/lessons", setLessonData);
    loadMaterial("stories", "/api/stories", setStoryData);
    return () => { cancelled = true; };
  }, [reloadKey, budget, mode]);

  useEffect(() => {
    let cancelled = false;
    setMaterialsLoading(current => ({...current, recommended: true}));
    setMaterialErrors(current => ({...current, recommended: false}));
    api("/api/recommended?limit=5")
      .then(result => {if (!cancelled) setRecommended(result.recommended || []);})
      .catch(() => {if (!cancelled) setMaterialErrors(current => ({...current, recommended: true}));})
      .finally(() => {if (!cancelled) setMaterialsLoading(current => ({...current, recommended: false}));});
    return () => {cancelled = true;};
  }, [recommendedReload, reloadKey]);

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
  const plan = activeSession?.plan ?? data.plan;
  const errorCount = (data.error_cards || []).length;
  const isEmpty = stats?.total_cards === 0;

  // 每日最低目标、新词建议与本轮卡数分别表达。
  const done = stats?.reviewed_today || 0;
  const queueTotal = data.target;
  const adaptiveGoal = data.recommended_goal || 10;  // 后端自适应推荐
  const target = dailyGoal;
  const pct = target > 0 ? Math.min(1, done / target) : 0;
  const hour = new Date().getHours();
  const showEveningReminder = hour >= 20 && done === 0;
  const currentLesson = lessonData?.lessons?.at(-1);
  const courseWords = currentLesson?.content?.words || [];
  const dialogue = (currentLesson?.content?.dialogue || []).map(line => homeChinesePreview(line.cn)).filter(Boolean).slice(0, 2);
  const courseTitle = homeChinesePreview(currentLesson?.title, `第 ${currentLesson?.level} 课`);
  const latestStory = storyData?.stories?.[0];
  const practiceModes = [
    ["spelling", "拼写练习", "看释义，回忆拼写", "edit"],
    ["listening", "听写练习", "听发音，辨认或写出单词", "speaker"],
    ["quiz", "直接做测验", "用不同题型检查记忆", "done"],
    ["mixed", "混合练习", "组合题型，巩固薄弱项", "stack"],
  ];
  const retryMaterials = () => setReloadKey(key => key + 1);

  return (
    <section className="view home-workspace" aria-label="今天的学习">
      {showEveningReminder && <p className="home-reminder">今天还没有完成记录，可以从一轮学习开始。</p>}
      <section className="home-round" aria-labelledby="home-title">
        <div className="home-round-heading">
          <h1 id="home-title">今天的学习</h1>
          <p>{isEmpty ? "从第一组单词开始" : activeSession ? "继续从上次的位置开始" : "先回忆，再继续新的内容"}</p>
        </div>
        <div className="home-round-notes">
          {data.time_budget_enabled !== false && <label>今天可用时间 <select aria-label="今天可用时间" value={activeSession?.plan?.budget_minutes ?? data.plan?.budget_minutes ?? budget} disabled={!!activeSession} onChange={event => {
            const minutes = Number(event.target.value);
            storageSet("timeBudget", minutes); setBudget(minutes); setMode("regular");
          }}>{[3, 8, 15].map(minutes => <option key={minutes} value={minutes}>约 {minutes} 分钟</option>)}</select></label>}
          <p role="status" data-testid="time-budget-plan">预计约 {Math.ceil((plan?.estimated_seconds ?? 0) / 60)} 分钟 · 巩固至多 {plan?.reinforcement_limit ?? 3} 题。固定开销 15 秒；时间仅作估计，可保存后暂停。</p>
          {plan?.may_exceed_budget && <p role="status">至少保留一张有效词卡，本轮可能超过所选时间，可保存后暂停。</p>}
          <p role="status" data-testid="estimate-basis">{plan?.estimate_basis === "personal" ? "个人估算（部分类型可能仍用默认值）" : "默认估算"}：{[["review", "复习", 20], ["new", "新词", 40], ["reinforcement", "巩固", 20]].map(([kind, label, fallback]) => {
            const value = plan?.estimates?.[kind];
            return `${label} ${value?.seconds ?? fallback} 秒（${value?.basis === "personal" ? `个人，最近 ${value.sample_count} 条中位数` : `默认，有效样本 ${value?.sample_count ?? 0}/5，不足或记录不可靠`}）`;
          }).join("；")}。后台、超过 30 秒无操作和保存等待不计主动时长；只校准未来计划。</p>
        </div>
        {!activeSession && data.recovery_available && <div className="home-round-notes" data-testid="recovery-offer">
          <p role="status">恢复学习：中断至少三个学习日，可先用约三分钟复习至多五张到期词，零新词；无需一次清空积压。</p>
          {data.plan?.mode === "recovery"
            ? <button className="btn btn-ghost home-on-dark" onClick={() => setMode("regular")}>选择常规计划</button>
            : <button className="btn btn-ghost home-on-dark" onClick={() => setMode("recovery")}>选择恢复学习</button>}
        </div>}
        {isEmpty ? <div className="home-welcome">
          <div><h2>欢迎来到 EnglishCoach</h2><p>添加想学的词，或先用 10 张已核对的入门词卡开始。</p></div>
          <div className="home-welcome-actions">
            <button className="btn home-primary" onClick={() => setView("add")}>先加几个词<CaretRightIcon aria-hidden="true" /></button>
            <button className="btn home-on-dark" onClick={addStarter} disabled={starterLoading}>{starterLoading ? "正在添加…" : "体验入门词卡"}</button>
            <button className="home-text-link home-on-dark" onClick={() => setView("backup")}>恢复备份</button>
          </div>
          {starterError && <p role="alert">添加失败：{starterError}，请重试</p>}
        </div> : <>
          <div className="home-round-body">
            <div className="home-round-summary">
              <h2>{activeSession || queueTotal > 0 ? "本轮学习" : "今日复习已完成"}</h2>
              {activeSession || queueTotal > 0 ? <p data-testid="round-target">本轮目标 {activeSession?.target ?? data.target} 张 · 到期复习 {activeSession?.reviewCount ?? data.review_count} 张 · 新词 {activeSession?.newCount ?? data.new_count} 个</p> : <p>{data.new_remaining === 0 ? "今日新词余量已用完，可稍后复习或继续专项练习。" : "当前没有到期词或待学新词，可继续专项练习。"}</p>}
            </div>
            <div className="home-goal">
              <div className="home-goal-label">今日完成 <b>{done}</b><span className="goal-total">/ {target}</span><span>词</span></div>
              <div className="home-goal-controls">
                <div className="home-progress" role="progressbar" aria-label="今日最低目标进度" aria-valuemin={0} aria-valuemax={target} aria-valuenow={Math.min(done, target)} aria-valuetext={`今日完成 ${done} 词，最低目标 ${target} 词`}><span style={{width: `${pct * 100}%`}} /></div>
                <label className="home-goal-change">更改目标<select className="goal-daily-set" aria-label="每日最低完成目标" value={dailyGoal} title="每日最低完成目标（不改变新词配额或本轮张数）" onChange={e => {const n = parseInt(e.target.value); setDailyGoal(n); storageSet("dailyGoal", n);}}>{[5, 10, 15, 20].map(n => <option key={n} value={n}>至少 {n} 词/日</option>)}</select></label>
              </div>
            </div>
            <button className="btn home-primary home-round-action" onClick={() => activeSession ? onResumeDaily() : queueTotal > 0 ? onStartDaily(data) : setView("add")}>
              {activeSession ? "继续本轮学习" : queueTotal > 0 ? (plan?.mode === "recovery" ? "开始恢复学习" : "开始今天的学习") : "添加新词"}<CaretRightIcon aria-hidden="true" size={20} />
            </button>
          </div>
          <div className="home-round-notes">
            <span data-testid="remaining-due">另有 {activeSession?.remainingDue ?? data.remaining_due} 张到期词，完成后可继续下一轮</span>
            <span data-testid="new-word-limit">新词建议 {adaptiveGoal} 个 · 今日剩余 {data.new_remaining ?? adaptiveGoal} 个 · 有效样本 {data.sample_count ?? 0}</span>
          </div>
        </>}
      </section>

      <div className="home-content-grid">
        <section className="home-course" aria-label="当前课程">
          <header className="home-section-head"><h2>当前课程</h2><button className="home-text-link" onClick={() => setView("lessons")}>查看全部课程<CaretRightIcon aria-hidden="true" /></button></header>
          {materialsLoading.lessons ? <p className="home-material-empty" role="status">正在读取课程…</p> : materialErrors.lessons ? <div className="home-material-empty"><p role="alert">课程暂时无法读取，今天的学习仍可继续。</p><button className="btn btn-ghost" onClick={retryMaterials}>重新读取课程</button></div> : <>
            <h3>{currentLesson ? (courseTitle.startsWith(`第 ${currentLesson.level} 课`) || courseTitle.startsWith(`第${currentLesson.level}课`) ? courseTitle : `第 ${currentLesson.level} 课 · ${courseTitle}`) : "从第一课开始"}</h3>
            <p className="home-course-goal">{currentLesson ? `学习目标：${homeChinesePreview(currentLesson.goal, "通过词汇与对话练习本课主题。")}` : "从基础词汇到简单对话，一课一课地积累。"}</p>
            {currentLesson ? <>
              <p className="home-course-meta">{courseWords.length} 个词汇 · {currentLesson.content?.dialogue?.length || 0} 句对话 · {currentLesson.learning_progress?.browsed ? "已浏览，检查结果见课程" : "浏览与短测分别记录"}</p>
              <dl className="home-course-preview">
                <div><dt>本课会接触</dt><dd>{courseWords.slice(0, 6).map(word => homeChinesePreview(word.meaning)).filter(Boolean).join("、") || "打开课程查看学习内容"}</dd></div>
                {dialogue.length > 0 && <div><dt>对话场景</dt><dd className="home-dialogue">{dialogue.map((line, i) => <p key={i}>“{line}”</p>)}</dd></div>}
              </dl>
            </> : <dl className="home-course-preview home-course-intro"><div><dt>明确目标</dt><dd>每课都有学习目标、词汇与对话。</dd></div><div><dt>循序学习</dt><dd>打开课程、浏览内容，再用短测检查。</dd></div></dl>}
          </>}
          <div className="home-course-actions"><button className="btn home-course-open" data-testid="open-lessons" onClick={() => setView("lessons")}>打开课程<CaretRightIcon aria-hidden="true" /></button>{data.scenes_enabled !== false && <button className="btn home-scene-link" onClick={() => setView("scene")}><UiIcon name="words" />场景练习</button>}</div>
        </section>
        <section className="home-story" aria-label="故事阅读">
          <header className="home-section-head"><h2>故事阅读</h2></header>
          {materialsLoading.stories ? <p className="home-material-empty" role="status">正在读取故事…</p> : <div className="home-story-preview"><div><h3>{homeChinesePreview(latestStory?.title_cn || latestStory?.title, "读一个小故事")}</h3><p>{homeChinesePreview(latestStory?.content_cn?.split(/\n/)[0].slice(0, 110), "在中英对照故事里读英语，遇到生词可以查词、听发音，并保留原句。")}</p></div><img src="/static/images/home-reading.png" alt="" width="160" height="180" /></div>}
          {materialErrors.stories && <p role="alert">故事暂时无法读取。<button className="home-text-link" onClick={retryMaterials}>重新读取故事</button></p>}
          <button className="home-text-link home-story-open" onClick={() => setView("stories")}>打开故事库<CaretRightIcon aria-hidden="true" size={20} /></button>
        </section>
      </div>

      <details className="home-practice home-specialists" open>
        <summary>专项练习</summary>
        {!isEmpty ? <div className="home-practice-grid">{practiceModes.map(([view, label, description, icon]) => <button key={view} type="button" aria-label={label} onClick={() => setView(view)}>{icon === "stack" ? <StackIcon size={30} aria-hidden="true" /> : <UiIcon name={icon} size={30} />}<span><b>{view === "quiz" ? "测验" : label}</b><small>{description}</small></span><CaretRightIcon aria-hidden="true" size={19} /></button>)}</div> : <p className="home-practice-empty">添加第一组词后，就可以练习拼写、听写和测验。</p>}
      </details>

      <div className="home-record-strip">
        <button className="today-stats home-record-total" onClick={() => setView("stats")}>今日完成 <b>{stats?.reviewed_today || 0}</b> 词 · 练习 {stats?.attempted_today || 0} 次 · 跳过 {stats?.skipped_today || 0} 次 · 累计 {stats?.total_cards || 0} 词{stats?.streak > 0 ? ` · 连续 ${stats.streak} 天` : ""}</button>
        <button className="home-text-link" onClick={() => setView("stats")}>查看学习记录<CaretRightIcon aria-hidden="true" /></button>
      </div>

      <section className="home-evidence" aria-label="复习与学习依据">
        <div className="home-review-queues">
          {errorCount > 0 && <div><span>需要巩固：上次答错的 {errorCount} 个词</span><button className="home-text-link" onClick={() => {setStudyQueue(data.error_cards || []); setView("study");}}>复习错词<CaretRightIcon aria-hidden="true" /></button></div>}
          <section aria-label="推荐复习">
            {materialsLoading.recommended ? <p role="status">正在读取推荐复习词…</p>
              : materialErrors.recommended ? <div><p role="alert">推荐复习暂时无法读取，其他学习仍可继续。</p><button className="home-text-link" onClick={() => setRecommendedReload(version => version + 1)}>重新读取推荐词<CaretRightIcon aria-hidden="true" /></button></div>
                : recommended.length > 0 ? <div><span>推荐复习：{recommended.map(c => homeChinesePreview(c.meaning, "待复习词")).join("、")}</span><button className="home-text-link" onClick={() => {setStudyQueue(recommended); setView("study");}}>复习推荐词<CaretRightIcon aria-hidden="true" /></button></div>
                  : <p>目前没有推荐复习词。</p>}
          </section>
        </div>
        <div className="home-evidence-grid"><LearningAdvice onStart={onAdvice} />
          <div className="home-evidence-summary"><h3>学习依据</h3>{data.evidence_counts && <dl>{["verified", "weak", "stale", "history_incomplete", "insufficient"].map(key => <div key={key}><dt>{data.evidence_labels?.[key] || ({verified: "独立回忆已有证据", weak: "仍需巩固", stale: "历史证据，待复测", history_incomplete: "历史依据不完整", insufficient: "独立证据不足"})[key]}</dt><dd>{data.evidence_counts[key] || 0} 张</dd></div>)}</dl>}
            {!materialsLoading.lessons && !materialErrors.lessons && lessonData && <p className="home-course-status">课程：已生成 {lessonData.counts?.generated ?? 0}/20 课 · 已打开 {lessonData.counts?.opened ?? 0} 课 · 已浏览 {lessonData.counts?.browsed ?? 0} 课{lessonData.counts?.old_content ? ` · 旧内容 ${lessonData.counts.old_content} 课` : ""}{lessonData.counts?.unrecorded ? ` · 状态未记录 ${lessonData.counts.unrecorded} 课` : ""}</p>}
            {stats?.delayed_recall_enabled !== false && <div className="save-state-actions" aria-label="延迟回测"><button className="btn btn-ghost btn-small" onClick={() => onDelayed("day")}>隔日回测</button><button className="btn btn-ghost btn-small" onClick={() => onDelayed("week")}>一周回测</button></div>}
          </div>
        </div>
      </section>
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
