import { accountFetch } from "../lib/accountSession.js";
import LearningAdvice from "../components/LearningAdvice.jsx";
import React, { useState, useEffect, useRef, useCallback } from "react";
import { api } from "../lib/api.js";
import { showToast } from "../App.jsx";

const URL_REVOKE_DELAY_MS = 1000;
const REPORT_THEME = {
  paper: "#fcfaf6",
  accent: "#a26243",
  headerSub: "rgba(252, 250, 246, 0.88)",
  ink: "#302e2b",
  muted: "#736c63",
  line: "#e5dfd5",
};
const EVIDENCE_DEFAULTS = [
  ["verified", "独立回忆已有证据"],
  ["weak", "仍需巩固"],
  ["stale", "历史证据，待复测"],
  ["history_incomplete", "历史依据不完整"],
  ["insufficient", "独立证据不足"],
];

function shortMonthDay(isoDate) {
  if (typeof isoDate !== "string") return "";
  const parts = isoDate.split("-");
  return parts.length === 3 ? `${Number(parts[1])}/${Number(parts[2])}` : isoDate;
}

function triggerBlobDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), URL_REVOKE_DELAY_MS);
}

function formatEvidenceItems(fresh) {
  const counts = fresh.evidence_counts || {};
  const labels = fresh.evidence_labels || {};
  return Object.fromEntries(
    EVIDENCE_DEFAULTS.map(([key, fallback]) => [
      key,
      `${labels[key] || fallback} ${counts[key] || 0}`,
    ]),
  );
}

function drawReportCanvas(canvas, fresh, items) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return false;
  const latest = fresh.evidence_latest_at
    ? new Date(fresh.evidence_latest_at).toLocaleDateString()
    : "暂无";

  ctx.fillStyle = REPORT_THEME.paper;
  ctx.fillRect(0, 0, 340, 460);
  ctx.fillStyle = REPORT_THEME.accent;
  ctx.fillRect(0, 0, 340, 86);
  ctx.fillStyle = REPORT_THEME.paper;
  ctx.font = "700 22px sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("EnglishCoach 学习报告", 170, 42);
  ctx.font = "500 12px sans-serif";
  ctx.fillStyle = REPORT_THEME.headerSub;
  ctx.fillText("零基础英语 · AI 个性化学习", 170, 64);

  const drawStatRow = (value, label, y) => {
    const numText = String(value ?? 0);
    ctx.textAlign = "left";
    ctx.fillStyle = REPORT_THEME.ink;
    ctx.font = "700 30px sans-serif";
    ctx.fillText(numText, 40, y);
    const numWidth = ctx.measureText(numText).width;
    ctx.font = "600 13px sans-serif";
    ctx.fillStyle = REPORT_THEME.muted;
    ctx.fillText(label, Math.max(104, 40 + numWidth + 14), y - 6);
  };
  drawStatRow(fresh.total_cards, "累计词汇", 138);
  drawStatRow(fresh.graduated, "句子练习已解锁", 208);
  drawStatRow(fresh.streak, "连续天数", 278);

  ctx.strokeStyle = REPORT_THEME.line;
  ctx.beginPath();
  for (const lineY of [162, 232, 302, 402]) {
    ctx.moveTo(30, lineY);
    ctx.lineTo(310, lineY);
  }
  ctx.stroke();

  ctx.textAlign = "center";
  ctx.font = "600 11px sans-serif";
  ctx.fillStyle = REPORT_THEME.muted;
  ctx.fillText(`${items.verified} · ${items.weak}`, 170, 334);
  ctx.fillText(`${items.stale} · ${items.insufficient}`, 170, 354);
  ctx.fillText(
    `${items.history_incomplete} · 样本 ${fresh.evidence_samples || 0} · 最近 ${latest}`,
    170,
    374,
  );
  ctx.fillText("坚持每天 20 分钟，英语不再是零基础", 170, 430);
  return true;
}

/**
 * 学习统计视图：数字卡片/周正确率/热力图/导出。
 */
export default function StatsPage({ onDelayed, onAdvice, onOpenBackup }) {
  const [stats, setStats] = useState(null);
  const [history, setHistory] = useState(null);
  const [weekly, setWeekly] = useState(null);
  const [today, setToday] = useState(null);
  const [loading, setLoading] = useState(true);
  const [exportingAnki, setExportingAnki] = useState(false);
  const [exportingReport, setExportingReport] = useState(false);
  const canvasRef = useRef(null);
  const mountedRef = useRef(true);
  const ankiBusyRef = useRef(false);
  const reportBusyRef = useRef(false);
  const [tooltip, setTooltip] = useState(null);
  const [exportSummary, setExportSummary] = useState(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

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
    if (ankiBusyRef.current) return;
    ankiBusyRef.current = true;
    setExportingAnki(true);
    try {
      const response = await accountFetch(path);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const blob = await response.blob();
      if (!mountedRef.current) return;
      triggerBlobDownload(blob, filename);
    } catch (error) {
      if (mountedRef.current) showToast("导出失败：" + error.message);
    } finally {
      ankiBusyRef.current = false;
      if (mountedRef.current) setExportingAnki(false);
    }
  };

  // 成绩单：重新读取导出时统计，不画按次数换算的掌握百分比
  const openReport = async () => {
    if (!stats || reportBusyRef.current) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    reportBusyRef.current = true;
    setExportingReport(true);
    try {
      let fresh = stats;
      try {
        fresh = await api("/api/stats");
        if (!mountedRef.current) return;
        setStats(fresh);
      } catch {
        if (!mountedRef.current) return;
      }
      const items = formatEvidenceItems(fresh);
      setExportSummary(EVIDENCE_DEFAULTS.map(([key]) => items[key]).join(" · "));
      if (!drawReportCanvas(canvas, fresh, items)) {
        showToast("成绩单导出失败");
        return;
      }

      await new Promise((resolve) => {
        canvas.toBlob((blob) => {
          if (!mountedRef.current) {
            resolve();
            return;
          }
          if (!blob) {
            showToast("成绩单导出失败");
            resolve();
            return;
          }
          triggerBlobDownload(blob, "englishcoach_report.png");
          resolve();
        });
      });
    } finally {
      reportBusyRef.current = false;
      if (mountedRef.current) setExportingReport(false);
    }
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
        <h2 className="page-title">学习记录</h2>
      </div>

      <div className="stats-grid">
        <div className="stats-card"><span className="stats-card-value">{stats.total_cards}</span><span className="stats-card-label">累计词汇</span></div>
        <div className="stats-card"><span className="stats-card-value">{stats.graduated}</span><span className="stats-card-label">句子练习已解锁</span></div>
        <div className="stats-card"><span className="stats-card-value" data-testid="streak">{stats.streak}</span><span className="stats-card-label">连续天数</span></div>
        <div className="stats-card"><span className="stats-card-value">{stats.reviewed_today}</span><span className="stats-card-label">今日完成</span></div>
      </div>

      <div className="today-stats">
        今日完成 <b>{stats.reviewed_today}</b> 词 · 练习 <b>{stats.attempted_today}</b> 次 ·
        跳过 <b>{stats.skipped_today}</b> 次
      </div>

      <section data-testid="evidence-overview" className="metrics-panel stats-half-panel">
        <h3>学习证据</h3>
        <dl className="stats-kv-list">
          {[
            ["verified", "独立回忆已有证据"],
            ["weak", "仍需巩固"],
            ["stale", "历史证据，待复测"],
            ["insufficient", "独立证据不足"],
            ["history_incomplete", "历史依据不完整"],
          ].map(([key, fallback]) => (
            <div key={key}>
              <dt>{stats.evidence_labels?.[key] || fallback}</dt>{" "}
              <dd>{stats.evidence_counts?.[key] || 0} 张</dd>
            </div>
          ))}
        </dl>
        <p className="stats-panel-foot">
          独立样本 {stats.evidence_samples || 0} 次 · 最近证据{" "}
          {stats.evidence_latest_at
            ? new Date(stats.evidence_latest_at).toLocaleDateString()
            : "暂无"}
        </p>
      </section>

      {/* 分类指标：自评与客观题分开解释 */}
      <section data-testid="metrics-overview" className="metrics-panel stats-half-panel">
        <h3>练习指标</h3>
        <dl className="stats-kv-list">
          {[
            ["retrieval", "独立提取正确率"],
            ["assisted", "辅助练习正确率"],
            ["recognition", "识别练习正确率"],
            ["self_report", "自评通过率"],
          ].map(([key, label]) => {
            const value = stats.metrics?.[key];
            return (
              <div key={key} data-testid={`${key === "self_report" ? "self-report" : key}-metric`}>
                <dt>{label}</dt>{" "}
                <dd>
                  {value?.percent === null || value?.percent === undefined ? "暂无数据" : `${value.percent}%`}
                  {value && value.count > 0 ? `（${value.successes}/${value.count}）` : ""}
                </dd>
              </div>
            );
          })}
        </dl>
        {today && (
          <p className="stats-panel-meta" data-testid="new-word-limit">
            新词建议 {today.recommended_goal} 个 · 有效样本 {today.sample_count}
          </p>
        )}
        <p className="add-hint stats-panel-foot">独立、辅助与识别按客观作答统计；自评只表示主观通过率，不是客观正确率。</p>
      </section>

      <section data-testid="retention-overview" className="metrics-panel retention-panel">
        <div className="retention-head">
          <h3>延迟保持 · 距应用内上次记录</h3>
          <p>每轮最多三题；首测结果按词、学习日和窗口保留，不代表全部词汇。</p>
        </div>
        <div className="retention-windows">
          {[["day", "隔日回测"], ["week", "一周回测"], ["other", "其他间隔"]].map(([key, label]) => {
            const row = stats.retention?.[key];
            return (
              <div key={key} className="retention-window">
                <div className="retention-window-head">
                  <h4>{label}</h4>
                  <span className="retention-status-tag">
                    {!row?.count ? "暂无数据" : row.count < 10 ? "样本较少，仅说明所测内容" : "仅说明所测内容"}
                  </span>
                </div>
                <dl className="stats-kv-list">
                  <div>
                    <dt>独立成功/样本</dt>{" "}
                    <dd>{row?.successes || 0}/{row?.count || 0}</dd>
                  </div>
                  <div>
                    <dt>辅助 / 跳过</dt>{" "}
                    <dd>辅助 {row?.assisted || 0} · 跳过 {row?.skipped || 0}</dd>
                  </div>
                  <div>
                    <dt>覆盖 / 依据不完整</dt>{" "}
                    <dd>{row?.covered || 0} 词 · {row?.incomplete || 0}</dd>
                  </div>
                  <div>
                    <dt>实际间隔</dt>{" "}
                    <dd>{row?.gap_seconds?.length ? row.gap_seconds.map(seconds => `${Number((seconds / 3600).toFixed(2))} 小时`).join("、") : "暂无"}</dd>
                  </div>
                </dl>
                {key !== "other" && stats.delayed_recall_enabled !== false && (
                  <div className="retention-window-action">
                    <button className="btn btn-ghost btn-small" onClick={() => onDelayed(key)}>{label}</button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>
      {stats.history_incomplete && (
        <p role="note" className="add-hint">
          部分旧历史不可还原，图表只展示可确认的记录；旧数据最后活动另见词卡详情。
        </p>
      )}

      <LearningAdvice onStart={onAdvice} />

      {/* 本周复习通过率 */}
      {weekly && (() => {
        const hasWeeklyData = weekly.weeks.some((w) => w.accuracy !== null);
        const weekAccColor =
          weekly.this_week === null
            ? "var(--muted)"
            : weekly.this_week >= 80
              ? "var(--success)"
              : weekly.this_week >= 60
                ? "var(--sun)"
                : "var(--coral)";
        return (
          <section className="metrics-panel weekly-accuracy">
            <div className="weekly-head">
              <h3>
                本周复习通过率{" "}
                <span className="week-acc" style={{ color: weekAccColor }}>
                  {weekly.this_week !== null ? `${weekly.this_week}%` : "（暂无）"}
                </span>
              </h3>
              {!hasWeeklyData && (
                <span className="weekly-empty-note">最近 8 周暂无排期复习记录</span>
              )}
            </div>
            <div className="week-chart">
              {weekly.weeks.map((w, i) => (
                <div
                  key={i}
                  className="week-col"
                  title={`${w.start}：${w.total} 题 · 复习通过率 ${w.accuracy === null ? "-" : `${w.accuracy}%`}`}
                >
                  <span className="week-col-val">
                    {w.accuracy === null ? "—" : `${w.accuracy}%`}
                  </span>
                  <div className="week-bar-track">
                    {w.accuracy !== null && (
                      <div
                        className="week-bar"
                        style={{
                          height: `${Math.max(8, w.accuracy)}%`,
                          background:
                            w.accuracy >= 80
                              ? "var(--mint)"
                              : w.accuracy >= 60
                                ? "var(--sun)"
                                : "var(--coral)",
                        }}
                      />
                    )}
                  </div>
                  <span className="week-axis-label">{shortMonthDay(w.start)}</span>
                </div>
              ))}
            </div>
          </section>
        );
      })()}

      {/* 导出 */}
      <div className="export-row">
        <button className="btn btn-ghost btn-small" disabled={exportingAnki} onClick={() => downloadExport("/api/export/anki", "englishcoach_anki.csv")}>导出 Anki</button>
        <button className="btn btn-ghost btn-small" disabled={exportingReport} onClick={openReport}>成绩单</button>
        {onOpenBackup && (
          <button className="btn btn-ghost btn-small" onClick={onOpenBackup}>备份与恢复</button>
        )}
      </div>
      {exportSummary && (
        <p role="status" data-testid="export-summary" style={{ fontSize: 12, color: "var(--muted)" }}>
          成绩单已按导出时证据生成：{exportSummary}
        </p>
      )}

      <h3 className="lesson-section">最近 1 年</h3>
      {renderHeatmap()}

      <canvas ref={canvasRef} width={340} height={460} style={{ display: "none" }} />

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
