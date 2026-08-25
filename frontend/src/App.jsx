import React, { useState, useEffect, useRef, useCallback } from "react";
import { api } from "./lib/api.js";
import { storageGet, storageSet } from "./lib/utils.js";
import { setTtsRate } from "./lib/tts.js";
import StudyPage from "./views/StudyPage.jsx";
import QuizPage from "./views/QuizPage.jsx";
import SpellingPage from "./views/SpellingPage.jsx";
import ListeningPage from "./views/ListeningPage.jsx";
import MixedPage from "./views/MixedPage.jsx";
import WordsPage from "./views/WordsPage.jsx";
import StoriesPage from "./views/StoriesPage.jsx";
import AddPage from "./views/AddPage.jsx";
import StatsPage from "./views/StatsPage.jsx";
import SettingsPage from "./views/SettingsPage.jsx";
import LessonsPage from "./views/LessonsPage.jsx";

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

/* ============ 主应用 ============ */
export default function App() {
  const [view, setView] = useState("queue");
  const [studyQueue, setStudyQueue] = useState([]);
  const [singleCard, setSingleCard] = useState(null);
  const [navLocked, setNavLocked] = useState(false);
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

  const isNavView = NAV_TABS[view] !== undefined;

  return (
    <div className="app">
      {/* 顶栏 */}
      <header className="topbar">
        <div className="logo">
          <span className="logo-mark">E</span>
          <span className="logo-text">EnglishCoach</span>
        </div>
        <button className="settings-btn" title="设置" onClick={() => setView(view === "settings" ? "queue" : "settings")}>⚙️</button>
      </header>

      {/* 内容区 */}
      <main className="stage">
        {view === "queue" && <QueueView setView={setView} setStudyQueue={setStudyQueue} />}
        {view === "words" && <WordsPage />}
        {view === "stories" && <StoriesPage />}
        {view === "add" && <AddPage onStartStudy={(cards) => { setStudyQueue(cards); setView("study"); }} />}
        {view === "stats" && <StatsPage onBack={() => setView("queue")} />}
        {view === "settings" && <SettingsPage darkMode={darkMode} setDarkMode={setDarkMode} />}
        {view === "lessons" && <LessonsPage onExit={() => setView("queue")} />}
        {view === "study" && <StudyPage queue={studyQueue} onExit={() => setView("queue")} onToQuiz={() => setView("quiz")} onToMixed={() => setView("mixed")} />}
        {view === "quiz" && <QuizPage onExit={() => setView("queue")} />}
        {view === "spelling" && <SpellingPage onExit={() => { setView("queue"); setSingleCard(null); }} singleCard={singleCard} />}
        {view === "listening" && <ListeningPage onExit={() => setView("queue")} />}
        {view === "mixed" && <MixedPage onExit={() => setView("queue")} />}
      </main>

      {/* 底部导航 */}
      <nav className={`bottom-nav ${!isNavView ? "nav-locked" : ""}`}>
        {Object.entries(NAV_TABS).map(([key, label]) => (
          <button
            key={key}
            className={`nav-item ${view === key ? "nav-active" : ""}`}
            onClick={() => { if (!navLocked && isNavView) setView(key); }}
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
function QueueView({ setView, setStudyQueue }) {
  const [data, setData] = useState(null);
  const [stats, setStats] = useState(null);
  const [lessonData, setLessonData] = useState(null);
  const [recommended, setRecommended] = useState([]);
  const [loading, setLoading] = useState(true);
  const [dailyGoal, setDailyGoal] = useState(() => storageGet("dailyGoal", 10));

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
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  if (loading) return <div className="story-empty">加载中…</div>;
  if (!data) return <div className="story-empty">加载失败</div>;

  const errorCount = (data.error_cards || []).length;
  const isEmpty = data.new_cards.length === 0 && data.due_cards.length === 0 && errorCount === 0;

  // 今日目标环（科学自适应：后端推荐值驱动，用户设置为最低保底）
  const done = stats?.reviewed_today || 0;
  const queueTotal = errorCount + data.new_cards.length + data.due_cards.length;
  const adaptiveGoal = data.recommended_goal || 10;  // 后端自适应推荐
  const target = Math.min(Math.max(dailyGoal, adaptiveGoal), queueTotal);  // 取保底和推荐的较大值
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
          <span className="big-number">{data.new_cards.length}</span>
          <span className="big-label">个新词</span>
        </div>
        <div className="big-stat big-stat-alt">
          <span className="big-number">{data.due_cards.length}</span>
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
              <span className="goal-title">{done >= target ? "今日目标达成 🎉" : pct === 0 ? "今日目标" : "继续加油"}</span>
              <span className="goal-sub">
                {done >= target
                  ? `目标 ${target} 词已达成`
                  : `还剩 ${target - done} 张`}
                {data.error_rate !== null && data.error_rate !== undefined && (
                  <span style={{ marginLeft: 8, fontSize: 10, opacity: 0.7 }}>
                    （近7天正确率 ${100 - data.error_rate}%）
                  </span>
                )}
              </span>
              <select
                className="goal-daily-set"
                value={dailyGoal}
                title="最低保底目标（实际目标由学习表现自动调节）"
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

      {/* 欢迎页 */}
      {isEmpty && (
        <div className="welcome-box">
          <div className="welcome-emoji">👋</div>
          <h2>欢迎来到 EnglishCoach</h2>
          <p>AI 会根据你的记忆安排每天学什么。<br />先加几个想学的词，马上开始！</p>
          <button className="btn btn-primary" onClick={() => setView("add")}>先加几个词</button>
        </div>
      )}

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

      {/* 今日统计 */}
      {stats && (
        <div className="today-stats" style={{ cursor: "pointer" }} onClick={() => setView("stats")}>
          {stats.streak > 0 && <span className="streak-badge">🔥 <b>{stats.streak}</b> 天连续</span>}
          <span>今日已学 <b>{stats.reviewed_today}</b> 张 · 累计 <b>{stats.total_cards}</b> 词</span>
        </div>
      )}

      {!isEmpty && (
        <>
          <button className="btn btn-primary btn-large" onClick={() => {
            const queue = [...(data.error_cards || []), ...data.new_cards, ...data.due_cards];
            setStudyQueue(queue);
            setView("study");
          }}>开始今天的学习</button>
          <button className="btn btn-ghost" onClick={() => setView("quiz")}>直接做测验</button>
          <button className="btn btn-ghost" onClick={() => setView("listening")}>🎧 听写练习</button>
          <button className="btn btn-ghost" onClick={() => setView("spelling")}>⌨️ 拼写练习</button>
          <button className="btn btn-ghost" onClick={() => setView("mixed")}>🎲 混合练习</button>
        </>
      )}
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
