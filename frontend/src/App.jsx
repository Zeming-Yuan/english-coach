import React, { useState, useEffect, useRef, useCallback } from "react";
import { api } from "./lib/api.js";
import { storageGet, storageSet } from "./lib/utils.js";
import { setTtsRate } from "./lib/tts.js";

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
  const [navLocked, setNavLocked] = useState(false);
  const [darkMode, setDarkMode] = useState(() => storageGet("darkMode", false));

  // 设置初始化
  useEffect(() => {
    const rate = storageGet("ttsRate", 0.9);
    setTtsRate(rate);
    document.body.classList.toggle("dark", darkMode);
  }, [darkMode]);

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
        {view === "queue" && <QueueView setView={setView} />}
        {view === "words" && <PlaceholderView name="单词本" />}
        {view === "stories" && <PlaceholderView name="故事" />}
        {view === "add" && <PlaceholderView name="加词" />}
        {view === "settings" && <PlaceholderView name="设置" />}
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

/* ============ 队列页（先行迁移，验证骨架） ============ */
function QueueView({ setView }) {
  const [data, setData] = useState(null);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const [todayData, statsData] = await Promise.all([
          api("/api/today"),
          api("/api/stats"),
        ]);
        setData(todayData);
        setStats(statsData);
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

  // 今日目标环
  const dailyGoal = storageGet("dailyGoal", 10);
  const done = stats?.reviewed_today || 0;
  const queueTotal = errorCount + data.new_cards.length + data.due_cards.length;
  const target = Math.min(dailyGoal, queueTotal);
  const pct = target > 0 ? Math.min(1, done / target) : 0;
  const deg = Math.round(pct * 360);

  return (
    <section className="view view-center">
      <p className="eyebrow">今天的学习</p>

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
              <span className="goal-sub">{done >= target ? `目标 ${target} 词已达成` : `还剩 ${target - done} 张`}</span>
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

      {/* 今日统计 */}
      {stats && (
        <div className="today-stats" style={{ cursor: "pointer" }} onClick={() => setView("stats")}>
          {stats.streak > 0 && <span className="streak-badge">🔥 <b>{stats.streak}</b> 天连续</span>}
          <span>今日已学 <b>{stats.reviewed_today}</b> 张 · 累计 <b>{stats.total_cards}</b> 词</span>
        </div>
      )}

      {!isEmpty && (
        <>
          <button className="btn btn-primary btn-large" onClick={() => setView("study")}>开始今天的学习</button>
          <button className="btn btn-ghost" onClick={() => setView("quiz")}>直接做测验</button>
          <button className="btn btn-ghost">🎧 听写练习</button>
          <button className="btn btn-ghost">⌨️ 拼写练习</button>
          <button className="btn btn-ghost">🎲 混合练习</button>
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
