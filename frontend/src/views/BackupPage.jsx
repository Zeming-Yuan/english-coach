import React, { useState } from "react";

/**
 * 备份与恢复：当前只提供完整备份下载，恢复由后续版本交付。
 */
export default function BackupPage({ onBack }) {
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  const downloadBackup = async () => {
    setDownloading(true);
    setError("");
    setDone(false);
    try {
      const response = await fetch("/api/export/backup");
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = "english-coach-backup.json";
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 0);
      setDone(true);
    } catch (e) {
      setError("备份下载失败：" + (e?.message || String(e)));
    } finally {
      setDownloading(false);
    }
  };

  return (
    <section className="view view-center">
      <div className="settings-panel" style={{ position: "static", width: "100%", maxWidth: 460 }}>
        <div className="settings-panel-head">备份与恢复</div>
        <p style={{ fontSize: 13, color: "var(--muted)", margin: "0 0 12px" }}>
          下载包含数据库全部学习内容的版本化 JSON 备份，可在换设备或故障后使用。
        </p>
        <button className="btn btn-primary" disabled={downloading} onClick={downloadBackup}>
          {downloading ? "正在准备备份…" : "下载完整备份"}
        </button>
        {done && <p role="status" style={{ fontSize: 13 }}>备份已下载：english-coach-backup.json</p>}
        {error && <p role="alert" className="err">{error}</p>}

        <div style={{ marginTop: 20, fontSize: 13, lineHeight: 1.7 }}>
          <span className="settings-label">备份包含</span>
          <p style={{ margin: "4px 0 12px", color: "var(--muted)" }}>
            词卡全部字段、当前记忆状态、学习事件、迁移基线、记忆法、错词、困难词、课程、故事及关联。
          </p>
          <span className="settings-label">不包含</span>
          <p style={{ margin: "4px 0 12px", color: "var(--muted)" }}>
            API 密钥、环境配置、语音缓存，以及仅保存在浏览器中的外观与播放偏好。
          </p>
        </div>

        <p style={{ fontSize: 12, color: "var(--muted)" }}>
          恢复功能将在后续版本提供；当前仅支持下载备份。
        </p>
        <button className="btn btn-ghost" onClick={onBack}>返回设置</button>
      </div>
    </section>
  );
}
