import React, { useState, useEffect, useRef } from "react";
import { api } from "../lib/api.js";
import { storageGet } from "../lib/utils.js";

/**
 * 学习统计视图：数字卡片/周正确率/热力图/导出。
 */
export default function StatsPage({ onBack }) {
  const [stats, setStats] = useState(null);
  const [history, setHistory] = useState(null);
  const [weekly, setWeekly] = useState(null);
  const [loading, setLoading] = useState(true);
  const canvasRef = useRef(null);

  useEffect(() => {
    Promise.all([
      api("/api/stats"),
      api("/api/stats/history?days=365"),
      api("/api/stats/weekly").catch(() => null),
    ]).then(([s, h, w]) => {
      setStats(s);
      setHistory(h);
      setWeekly(w);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  // 导出
  const downloadExport = (path, filename) => {
    fetch(path).then((r) => r.blob()).then((blob) => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    });
  };

  // 导入
  const importRef = useRef(null);
  const handleImport = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (!window.confirm("导入会覆盖当前的复习记录/记忆法/错词（词卡按单词去重合并）。确认恢复？")) { e.target.value = ""; return; }
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      const resp = await api("/api/import/cards", { method: "POST", body: JSON.stringify(data) });
      window.dispatchEvent(new CustomEvent("toast-detail", { detail: { msg: `✅ 恢复完成：导入 ${resp.imported_words} 个新词` } }));
    } catch (err) {
      window.dispatchEvent(new CustomEvent("toast-detail", { detail: { msg: "恢复失败：" + err.message } }));
    }
    e.target.value = "";
  };

  // 成绩单
  const openReport = () => {
    if (!stats) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#F7FBFA";
    ctx.fillRect(0, 0, 340, 420);
    ctx.fillStyle = "#2DBE9E";
    ctx.fillRect(0, 0, 340, 86);
    ctx.fillStyle = "#fff";
    ctx.font = "900 22px Nunito, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("EnglishCoach 学习报告", 170, 42);
    ctx.font = "600 12px sans-serif";
    ctx.fillStyle = "rgba(255,255,255,0.85)";
    ctx.fillText("零基础英语 · AI 个性化学习", 170, 64);
    ctx.textAlign = "left";
    ctx.fillStyle = "#1E2A32";
    ctx.font = "900 30px sans-serif";
    ctx.fillText(String(stats.total_cards), 46, 150);
    ctx.fillText(String(stats.graduated), 46, 280);
    ctx.fillText(String(stats.streak), 46, 410);
    ctx.font = "700 13px sans-serif";
    ctx.fillStyle = "#7A8B94";
    ctx.fillText("累计词汇", 96, 144);
    ctx.fillText("已毕业", 96, 274);
    ctx.fillText("连续天数", 96, 404);
    ctx.strokeStyle = "#D9E2E6";
    ctx.beginPath();
    ctx.moveTo(30, 190); ctx.lineTo(310, 190);
    ctx.moveTo(30, 320); ctx.lineTo(310, 320);
    ctx.stroke();
    ctx.textAlign = "center";
    ctx.font = "700 11px sans-serif";
    ctx.fillStyle = "#7A8B94";
    ctx.fillText("坚持每天 20 分钟，英语不再是零基础", 170, 400);
    canvas.toBlob((blob) => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "englishcoach_report.png";
      a.click();
    });
  };

  if (loading) return <div className="story-empty">加载中…</div>;
  if (!stats) return <div className="story-empty">加载失败</div>;

  // 热力图渲染
  const renderHeatmap = () => {
    if (!history?.days?.length) return null;
    const days = history.days;
    const maxR = Math.max(1, ...days.map((d) => d.reviews));
    const getLevel = (r) => r === 0 ? 0 : r / maxR <= 0.25 ? 1 : r / maxR <= 0.5 ? 2 : 3;
    const firstDate = new Date(days[0].date + "T00:00:00");
    const firstDow = firstDate.getDay();
    const cells = [];
    for (let i = 0; i < firstDow; i++) cells.push(null);
    days.forEach((d) => cells.push(d));
    while (cells.length % 7 !== 0) cells.push(null);
    const weeks = cells.length / 7;
    const monthNames = ["", "1月", "2月", "3月", "4月", "5月", "6月", "7月", "8月", "9月", "10月", "11月", "12月"];
    const weekLabels = { 1: "一", 3: "三", 5: "五" };

    return (
      <div className="gh-calendar-wrap">
        <div className="cal-heatmap" style={{ gridTemplateColumns: `26px repeat(${weeks}, 1fr)`, gridTemplateRows: "18px repeat(7, 14px)" }}>
          {/* 月份标签 */}
          {(() => {
            let lastM = -1;
            const labels = [];
            for (let col = 0; col < weeks; col++) {
              const first = cells[col * 7];
              if (first) {
                const m = parseInt(first.date.split("-")[1]);
                if (m !== lastM) {
                  labels.push(<div key={col} className="cal-month-label" style={{ gridRow: 1, gridColumn: col + 2 }}>{monthNames[m]}</div>);
                  lastM = m;
                }
              }
            }
            return labels;
          })()}
          {/* 星期标签 */}
          {Object.entries(weekLabels).map(([row, label]) => (
            <span key={row} className="cal-weekday-label" style={{ gridRow: parseInt(row) + 1, gridColumn: 1 }}>{label}</span>
          ))}
          {/* 格子 */}
          {cells.map((d, i) => {
            const col = Math.floor(i / 7);
            const row = i % 7;
            return (
              <div
                key={i}
                className={`cal-cell ${d ? `cal-l${getLevel(d.reviews)}` : "cal-empty"}`}
                style={{ gridRow: row + 2, gridColumn: col + 2 }}
                title={d ? `${d.date}：${d.reviews} 次复习` : ""}
              />
            );
          })}
        </div>
        <div className="cal-legend">
          <span className="cal-legend-label">少</span>
          <span className="cal-cell cal-l0" /><span className="cal-cell cal-l1" /><span className="cal-cell cal-l2" /><span className="cal-cell cal-l3" />
          <span className="cal-legend-label">多</span>
        </div>
      </div>
    );
  };

  return (
    <section className="view">
      <div className="page-head">
        <button className="btn btn-ghost btn-small" onClick={onBack}>← 返回</button>
        <h2 className="page-title">学习统计</h2>
      </div>

      <div className="stats-grid">
        <div className="stats-card"><span className="stats-card-value">{stats.total_cards}</span><span className="stats-card-label">累计词汇</span></div>
        <div className="stats-card"><span className="stats-card-value">{stats.graduated}</span><span className="stats-card-label">已毕业</span></div>
        <div className="stats-card"><span className="stats-card-value">{stats.streak}</span><span className="stats-card-label">连续天数</span></div>
        <div className="stats-card"><span className="stats-card-value">{stats.reviewed_today}</span><span className="stats-card-label">今日已学</span></div>
      </div>

      {/* 本周正确率 */}
      {weekly && (
        <div className="weekly-accuracy">
          <h3 className="lesson-section">本周正确率 <span className="week-acc" style={{ color: weekly.this_week >= 80 ? "#137A62" : weekly.this_week >= 60 ? "#B8860B" : "var(--coral)" }}>{weekly.this_week !== null ? weekly.this_week + "%" : "（暂无）"}</span></h3>
          <div className="week-bars">
            {weekly.weeks.map((w, i) => (
              <div key={i} className="week-bar-wrap" title={`${w.start}：${w.total} 题 · 正确率 ${w.accuracy === null ? "-" : w.accuracy + "%"}`}>
                <div className="week-bar" style={{ height: w.accuracy === null ? 2 : w.accuracy * 0.5, background: w.accuracy === null ? "var(--line)" : w.accuracy >= 80 ? "var(--mint)" : w.accuracy >= 60 ? "var(--sun)" : "var(--coral)" }} />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 导出 */}
      <div className="export-row">
        <button className="btn btn-ghost btn-small" onClick={() => downloadExport("/api/export/cards", "englishcoach_backup.json")}>💾 备份词库</button>
        <button className="btn btn-ghost btn-small" onClick={() => downloadExport("/api/export/anki", "englishcoach_anki.csv")}>🎴 导出 Anki</button>
        <button className="btn btn-ghost btn-small" onClick={openReport}>🏅 成绩单</button>
        <button className="btn btn-ghost btn-small" onClick={() => importRef.current?.click()}>📥 恢复词库</button>
        <input ref={importRef} type="file" accept=".json" hidden onChange={handleImport} />
      </div>

      <h3 className="lesson-section">最近 1 年</h3>
      {renderHeatmap()}

      <canvas ref={canvasRef} width={340} height={420} style={{ display: "none" }} />
    </section>
  );
}
