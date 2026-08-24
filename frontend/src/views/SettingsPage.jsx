import React, { useState } from "react";
import { storageGet, storageSet } from "../lib/utils.js";
import { setTtsRate } from "../lib/tts.js";

/**
 * 设置视图：发音速度/每日新词量/暗色模式。
 */
export default function SettingsPage({ darkMode, setDarkMode }) {
  const [rate, setRate] = useState(() => storageGet("ttsRate", 0.9));
  const [daily, setDaily] = useState(() => storageGet("dailyGoal", 10));

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
          <span className="settings-label">每日新词量</span>
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
      </div>
    </section>
  );
}
