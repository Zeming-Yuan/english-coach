import LearningAdvice from "../components/LearningAdvice.jsx";
import React, { useState, useEffect, useRef, useCallback } from "react";
import { api } from "../lib/api.js";
import { storageGet } from "../lib/utils.js";
import { showToast } from "../App.jsx";

/**
 * 学习统计视图：数字卡片/周正确率/热力图/导出。
 */
export default function StatsPage({ onBack, onDelayed, onAdvice }) {
  const [stats, setStats] = useState(null);
  const [history, setHistory] = useState(null);
  const [weekly, setWeekly] = useState(null);
  const [today, setToday] = useState(null);
  const [loading, setLoading] = useState(true);
  const canvasRef = useRef(null);
  const [tooltip, setTooltip] = useState(null);
  const [exportSummary, setExportSummary] = useState(null);

  const showTooltip = useCallback((e, date, reviews) => {
    setTooltip({ x: e.clientX + 12, y: e.clientY + 14, text: `${date} · ${reviews} 次作答` });
  }, []);
  const moveTooltip = useCallback((e) => {
    setTooltip((t) => t ? { ...t, x: Math.min(e.clientX + 12, window.innerWidth - 160), y: e.clientY + 14 } : null);
  }, []);
  const hideTooltip = useCallback(() => setTooltip(null), []);

  useEffect(() => {
    Promise.all([
      api("/api/stats"),
      api("/api/stats/history?days=365"),
      api("/api/stats/weekly").catch(() => null),
      api("/api/today").catch(() => null),
    ]).then(([s, h, w, t]) => {
      setStats(s);
      setHistory(h);
      setWeekly(w);
      setToday(t);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  // 导出
  const downloadExport = async (path, filename) => {
    try {
      const response = await fetch(path);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      showToast("导出失败：" + error.message);
    }
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
      showToast(`✅ 恢复完成：导入 ${resp.imported_words} 个新词`);
    } catch (err) {
      showToast("恢复失败：" + err.message);
    }
    e.target.value = "";
  };

  // 成绩单：重新读取导出时统计，不画按次数换算的掌握百分比
  const openReport = async () => {
    if (!stats) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    let fresh = stats;
    try {
      fresh = await api("/api/stats");
      setStats(fresh);
    } catch {}
    const counts = fresh.evidence_counts || {};
    const labels = fresh.evidence_labels || {};
    const summary = [
      `${labels.verified || "独立回忆已有证据"} ${counts.verified || 0}`,
      `${labels.weak || "仍需巩固"} ${counts.weak || 0}`,
      `${labels.stale || "历史证据，待复测"} ${counts.stale || 0}`,
      `${labels.history_incomplete || "历史依据不完整"} ${counts.history_incomplete || 0}`,
      `${labels.insufficient || "独立证据不足"} ${counts.insufficient || 0}`,
    ].join(" · ");
    setExportSummary(summary);

    const latest = fresh.evidence_latest_at
      ? new Date(fresh.evidence_latest_at).toLocaleDateString()
      : "暂无";
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
    ctx.fillText(String(fresh.total_cards), 46, 150);
    ctx.fillText(String(fresh.graduated), 46, 280);
    ctx.fillText(String(fresh.streak), 46, 410);
    ctx.font = "700 13px sans-serif";
    ctx.fillStyle = "#7A8B94";
    ctx.fillText("累计词汇", 96, 144);
    ctx.fillText("句子练习已解锁", 96, 274);
    ctx.fillText("连续天数", 96, 404);
    ctx.textAlign = "center";
    ctx.font = "700 11px sans-serif";
    ctx.fillStyle = "#7A8B94";
    ctx.fillText(
      `${labels.verified || "独立回忆已有证据"} ${counts.verified || 0} · ${labels.weak || "仍需巩固"} ${counts.weak || 0}`,
      170,
      344,
    );
    ctx.fillText(
      `${labels.stale || "历史证据，待复测"} ${counts.stale || 0} · ${labels.insufficient || "独立证据不足"} ${counts.insufficient || 0}`,
      170,
      360,
    );
    ctx.fillText(
      `${labels.history_incomplete || "历史依据不完整"} ${counts.history_incomplete || 0} · 样本 ${fresh.evidence_samples || 0} · 最近 ${latest}`,
      170,
      376,
    );
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
            if (!d) return <div key={i} className="cal-cell cal-empty" style={{ gridRow: row + 2, gridColumn: col + 2 }} />;
            return (
              <div
                key={i}
                className={`cal-cell cal-l${getLevel(d.reviews)}`}
                style={{ gridRow: row + 2, gridColumn: col + 2 }}
                data-date={d.date}
                data-count={d.reviews}
                onMouseEnter={(e) => showTooltip(e, d.date, d.reviews)}
                onMouseMove={moveTooltip}
                onMouseLeave={hideTooltip}
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
        <h2 className="page-title">学习记录</h2>
      </div>

      <div className="stats-grid">
        <div className="stats-card"><span className="stats-card-value">{stats.total_cards}</span><span className="stats-card-label">累计词汇</span></div>
        <div className="stats-card"><span className="stats-card-value">{stats.graduated}</span><span className="stats-card-label">句子练习已解锁</span></div>
        <div className="stats-card"><span className="stats-card-value" data-testid="streak">{stats.streak}</span><span className="stats-card-label">连续天数</span></div>
        <div className="stats-card"><span className="stats-card-value">{stats.reviewed_today}</span><span className="stats-card-label">今日完成</span></div>
      </div>

      <div className="today-stats" style={{ marginTop: 12 }}>
        今日完成 <b>{stats.reviewed_today}</b> 词 · 练习 <b>{stats.attempted_today}</b> 次 ·
        跳过 <b>{stats.skipped_today}</b> 次
      </div>

      <div data-testid="evidence-overview" style={{ marginTop: 12 }}>
        <h3 className="lesson-section">学习证据</h3>
        <p style={{ fontSize: 13 }}>
          {stats.evidence_labels?.verified || "独立回忆已有证据"}{" "}
          {stats.evidence_counts?.verified || 0} 张 ·{" "}
          {stats.evidence_labels?.weak || "仍需巩固"}{" "}
          {stats.evidence_counts?.weak || 0} 张 ·{" "}
          {stats.evidence_labels?.stale || "历史证据，待复测"}{" "}
          {stats.evidence_counts?.stale || 0} 张 ·{" "}
          {stats.evidence_labels?.insufficient || "独立证据不足"}{" "}
          {stats.evidence_counts?.insufficient || 0} 张
        </p>
        <p style={{ fontSize: 12, color: "var(--muted)" }}>
          {stats.evidence_labels?.history_incomplete || "历史依据不完整"}{" "}
          {stats.evidence_counts?.history_incomplete || 0} 张 ·
          独立样本 {stats.evidence_samples || 0} 次 ·
          最近证据{" "}
          {stats.evidence_latest_at
            ? new Date(stats.evidence_latest_at).toLocaleDateString()
            : "暂无"}
        </p>
      </div>
      <div data-testid="retention-overview" className="metrics-panel">
        <h3>延迟保持 · 距应用内上次记录</h3>
        <p>每轮最多三题；首测结果按词、学习日和窗口保留，不代表全部词汇。</p>
        {[["day", "隔日回测"], ["week", "一周回测"], ["other", "其他间隔"]].map(([key, label]) => {
          const row = stats.retention?.[key];
          return <div key={key}>
            <h4>{label}</h4>
            <p>独立成功/样本 {row?.successes || 0}/{row?.count || 0} · 辅助 {row?.assisted || 0} · 跳过 {row?.skipped || 0} · 覆盖 {row?.covered || 0} 词 · 依据不完整 {row?.incomplete || 0}</p>
            <p>{!row?.count ? "暂无数据" : row.count < 10 ? "样本较少，仅说明所测内容" : "仅说明所测内容"}</p>
            <p>实际间隔：{row?.gap_seconds?.length ? row.gap_seconds.map(seconds => `${Number((seconds / 3600).toFixed(2))} 小时`).join("、") : "暂无"}</p>
            {key !== "other" && stats.delayed_recall_enabled !== false && <button className="btn btn-ghost btn-small" onClick={() => onDelayed(key)}>{label}</button>}
          </div>;
        })}
      </div>
      {stats.history_incomplete && (
        <p role="note" className="add-hint">
          部分旧历史不可还原，图表只展示可确认的记录；旧数据最后活动另见词卡详情。
        </p>
      )}

      {/* 分类指标：自评与客观题分开解释 */}
      <div className="metrics-panel" style={{ marginTop: 14 }}>
        <h3 className="lesson-section">练习指标</h3>
        {[
          ["retrieval", "独立提取正确率"],
          ["assisted", "辅助练习正确率"],
          ["recognition", "识别练习正确率"],
          ["self_report", "自评通过率"],
        ].map(([key, label]) => {
          const value = stats.metrics?.[key];
          return (
            <p key={key} data-testid={`${key === "self_report" ? "self-report" : key}-metric`}>
              {label}：{value?.percent === null || value?.percent === undefined ? "暂无数据" : value.percent + "%"}
              {value && value.count > 0 && `（${value.successes}/${value.count}）`}
            </p>
          );
        })}
        {today && (
          <p data-testid="new-word-limit">
            新词建议 {today.recommended_goal} 个 · 有效样本 {today.sample_count}
          </p>
        )}
        <p className="add-hint">独立、辅助与识别按客观作答统计；自评只表示主观通过率，不是客观正确率。</p>
      </div>

      <LearningAdvice onStart={onAdvice} />

      {/* 本周复习通过率 */}
      {weekly && (
        <div className="weekly-accuracy">
          <h3 className="lesson-section">本周复习通过率 <span className="week-acc" style={{ color: weekly.this_week >= 80 ? "var(--success)" : weekly.this_week >= 60 ? "var(--sun)" : "var(--coral)" }}>{weekly.this_week !== null ? weekly.this_week + "%" : "（暂无）"}</span></h3>
          <div className="week-bars">
            {weekly.weeks.map((w, i) => (
              <div key={i} className="week-bar-wrap" title={`${w.start}：${w.total} 题 · 复习通过率 ${w.accuracy === null ? "-" : w.accuracy + "%"}`}>
                <div className="week-bar" style={{ height: w.accuracy === null ? 2 : w.accuracy * 0.5, background: w.accuracy === null ? "var(--line)" : w.accuracy >= 80 ? "var(--mint)" : w.accuracy >= 60 ? "var(--sun)" : "var(--coral)" }} />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 导出 */}
      <div className="export-row">
        <button className="btn btn-ghost btn-small" onClick={() => downloadExport("/api/export/cards", "englishcoach_backup.json")}>备份词库</button>
        <button className="btn btn-ghost btn-small" onClick={() => downloadExport("/api/export/anki", "englishcoach_anki.csv")}>导出 Anki</button>
        <button className="btn btn-ghost btn-small" onClick={openReport}>成绩单</button>
        <button className="btn btn-ghost btn-small" onClick={() => importRef.current?.click()}>恢复词库</button>
        <input ref={importRef} type="file" accept=".json" hidden onChange={handleImport} />
      </div>
      {exportSummary && (
        <p role="status" data-testid="export-summary" style={{ fontSize: 12, color: "var(--muted)" }}>
          成绩单已按导出时证据生成：{exportSummary}
        </p>
      )}

      <h3 className="lesson-section">最近 1 年</h3>
      {renderHeatmap()}

      <canvas ref={canvasRef} width={340} height={420} style={{ display: "none" }} />

      {/* 热力图 tooltip */}
      {tooltip && (
        <div className="cal-tooltip" style={{ left: tooltip.x, top: tooltip.y }}>
          {tooltip.text}
          <span style={{ display: "block", opacity: 0.75 }}>
            学习日按 {stats.learning_timezone || "Asia/Shanghai"} 归属
          </span>
        </div>
      )}
    </section>
  );
}
