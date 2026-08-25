import React, { useState } from "react";
import { api } from "../lib/api.js";
import { storageGet, storageSet } from "../lib/utils.js";
import { setTtsRate } from "../lib/tts.js";
import { showToast } from "../App.jsx";

/**
 * 设置视图：发音速度/每日新词量/暗色模式/刷新例句。
 */
export default function SettingsPage({ darkMode, setDarkMode }) {
  const [rate, setRate] = useState(() => storageGet("ttsRate", 0.9));
  const [daily, setDaily] = useState(() => storageGet("dailyGoal", 10));
  const [cnMode, setCnMode] = useState(() => storageGet("sentenceCnMode", "auto"));
  const [refreshing, setRefreshing] = useState(false);
  const [refreshResult, setRefreshResult] = useState(null);
  const [regenerating, setRegenerating] = useState(false);

  const updateRate = (r) => {
    setRate(r);
    storageSet("ttsRate", r);
    setTtsRate(r);
  };

  const updateDaily = (n) => {
    setDaily(n);
    storageSet("dailyGoal", n);
  };

  return (
    <section className="view view-center">
      <div className="settings-panel" style={{ position: "static", width: "100%", maxWidth: 400 }}>
        <div className="settings-panel-head">⚙️ 设置</div>
        <div className="settings-row">
          <span className="settings-label">发音速度</span>
          <div className="diff-group">
            {[{ l: "慢速", v: 0.7 }, { l: "标准", v: 0.9 }, { l: "快速", v: 1.2 }].map((o) => (
              <button key={o.v} className={`diff-btn ${rate === o.v ? "diff-active" : ""}`} onClick={() => updateRate(o.v)}>{o.l}</button>
            ))}
          </div>
        </div>
        <div className="settings-row">
          <span className="settings-label">最低保底</span>
          <div className="diff-group">
            {[5, 10, 15, 20].map((n) => (
              <button key={n} className={`diff-btn ${daily === n ? "diff-active" : ""}`} onClick={() => updateDaily(n)}>{n}</button>
            ))}
          </div>
        </div>
        <div className="settings-row">
          <span className="settings-label">暗色模式</span>
          <button className="btn btn-ghost btn-small" onClick={() => { setDarkMode(!darkMode); storageSet("darkMode", !darkMode); }}>
            {darkMode ? "关闭" : "开启"}
          </button>
        </div>
        <div className="settings-row">
          <span className="settings-label">句子中文翻译</span>
          <div className="diff-group">
            {[{ l: "智能", v: "auto" }, { l: "常显", v: "on" }, { l: "隐藏", v: "off" }].map((o) => (
              <button key={o.v} className={`diff-btn ${cnMode === o.v ? "diff-active" : ""}`} onClick={() => { setCnMode(o.v); storageSet("sentenceCnMode", o.v); }}>{o.l}</button>
            ))}
          </div>
        </div>
        <div className="settings-row" style={{ flexDirection: "column", alignItems: "flex-start", gap: 8 }}>
          <span className="settings-label">词库例句质量</span>
          <p style={{ fontSize: 12, color: "var(--muted)", margin: 0 }}>旧词卡的例句可能太简单，点击刷新为更有画面感的例句</p>
          <button className="btn btn-ghost btn-small" disabled={refreshing} onClick={async () => {
            setRefreshing(true);
            setRefreshResult(null);
            try {
              const r = await api("/api/cards/refresh-examples?limit=10", { method: "POST" });
              setRefreshResult(r);
              if (r.refreshed > 0) {
                showToast(`✅ 已刷新 ${r.refreshed} 个词卡（还剩 ${r.remaining} 个）`);
              } else {
                showToast("所有词卡例句质量已达标 ✅");
              }
            } catch (e) {
              showToast("刷新失败：" + e.message);
            } finally {
              setRefreshing(false);
            }
          }}>
            {refreshing ? "刷新中…" : "🔄 刷新例句（每次10个）"}
          </button>
          {refreshResult && (
            <div style={{ fontSize: 12, color: "var(--muted)" }}>
              本次刷新 {refreshResult.refreshed} 个 · 待刷新 {refreshResult.remaining} 个 / 共 {refreshResult.total_weak} 个弱例句
            </div>
          )}
        </div>
        <div className="settings-row" style={{ flexDirection: "column", alignItems: "flex-start", gap: 8 }}>
          <span className="settings-label">句子卡</span>
          <p style={{ fontSize: 12, color: "var(--muted)", margin: 0 }}>为已毕业的词生成更复杂的阅读句子（15-25词，有上下文故事感）</p>
          <button className="btn btn-ghost btn-small" disabled={regenerating} onClick={async () => {
            setRegenerating(true);
            try {
              const r = await api("/api/cards/regenerate-sentences?limit=5", { method: "POST" });
              if (r.generated > 0) {
                showToast(`✅ 已生成 ${r.generated} 个句子卡（还剩 ${r.remaining} 个）`);
              } else {
                showToast("没有需要生成句子卡的词 ✅");
              }
            } catch (e) {
              showToast("生成失败：" + e.message);
            } finally {
              setRegenerating(false);
            }
          }}>
            {regenerating ? "生成中…" : "📝 生成句子卡（每次5个）"}
          </button>
        </div>
      </div>
    </section>
  );
}
