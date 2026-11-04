import React, { useEffect, useState } from "react";
import { api } from "../lib/api.js";
import { storageGet, storageSet } from "../lib/utils.js";
import { setTtsRate } from "../lib/tts.js";
import { showToast } from "../App.jsx";

/**
 * 设置视图：发音速度/每日完成目标/暗色模式/刷新例句。
 */
export default function SettingsPage({ darkMode, setDarkMode, onOpenBackup }) {
  const [rate, setRate] = useState(() => storageGet("ttsRate", 0.9));
  const [daily, setDaily] = useState(() => storageGet("dailyGoal", 10));
  const [cnMode, setCnMode] = useState(() => storageGet("sentenceCnMode", "auto"));
  const [refreshing, setRefreshing] = useState(false);
  const [refreshResult, setRefreshResult] = useState(null);
  const [regenerating, setRegenerating] = useState(false);
  const [aiConfig, setAiConfig] = useState(null);
  const [aiBaseUrl, setAiBaseUrl] = useState("");
  const [aiModel, setAiModel] = useState("");
  const [aiKey, setAiKey] = useState("");
  const [aiBusy, setAiBusy] = useState("");
  const [aiTest, setAiTest] = useState(null);

  useEffect(() => {
    let alive = true;
    api("/api/ai-config")
      .then((r) => {
        if (!alive) return;
        setAiConfig(r);
        setAiBaseUrl(r.base_url);
        setAiModel(r.model);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  const aiPayload = () => ({ base_url: aiBaseUrl, model: aiModel, api_key: aiKey });

  const saveAiConfig = async () => {
    setAiBusy("save");
    setAiTest(null);
    try {
      const r = await api("/api/ai-config", { method: "PUT", body: JSON.stringify(aiPayload()) });
      setAiConfig(r);
      setAiKey("");
      showToast("✅ AI 服务配置已保存");
    } catch (e) {
      showToast("保存失败：" + e.message);
    } finally {
      setAiBusy("");
    }
  };

  const testAiConfig = async () => {
    setAiBusy("test");
    setAiTest(null);
    try {
      setAiTest(await api("/api/ai-config/test", { method: "POST", body: JSON.stringify(aiPayload()) }));
    } catch (e) {
      setAiTest({ ok: false, error: e.message });
    } finally {
      setAiBusy("");
    }
  };

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
        <h1 className="settings-panel-head">设置</h1>
        <h2 className="settings-section-title">学习偏好</h2>
        <div className="settings-row">
          <span className="settings-label">发音速度</span>
          <div className="diff-group">
            {[{ l: "慢速", v: 0.7 }, { l: "标准", v: 0.9 }, { l: "快速", v: 1.2 }].map((o) => (
              <button key={o.v} className={`diff-btn ${rate === o.v ? "diff-active" : ""}`} onClick={() => updateRate(o.v)}>{o.l}</button>
            ))}
          </div>
        </div>
        <div className="settings-row">
          <span className="settings-label">最低完成目标</span>
          <div className="diff-group">
            {[5, 10, 15, 20].map((n) => (
              <button key={n} className={`diff-btn ${daily === n ? "diff-active" : ""}`} onClick={() => updateDaily(n)}>{n}</button>
            ))}
          </div>
        </div>
        <p className="add-hint" style={{ margin: "0 0 12px" }}>
          这是每日完成目标，不等于新词配额；新词建议由近期复习表现单独调节，提高目标不会抵消下调。
        </p>
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
        <h2 className="settings-section-title">AI 服务</h2>
        <div className="settings-row" style={{ flexDirection: "column", alignItems: "stretch", gap: 8 }}>
          <p style={{ fontSize: 12, color: "var(--muted)", margin: 0 }}>
            用于生成词卡、故事与查词。保存后立即生效；配置只存在本机 data/llm_config.json，不进入备份。
          </p>
          <label className="settings-label" htmlFor="ai-base-url">服务地址</label>
          <input id="ai-base-url" className="word-search-input" value={aiBaseUrl} onChange={(e) => setAiBaseUrl(e.target.value)} placeholder="https://api.deepseek.com" autoComplete="off" spellCheck={false} />
          <label className="settings-label" htmlFor="ai-model">模型</label>
          <input id="ai-model" className="word-search-input" value={aiModel} onChange={(e) => setAiModel(e.target.value)} placeholder="deepseek-flash" autoComplete="off" spellCheck={false} />
          <label className="settings-label" htmlFor="ai-key">API Key</label>
          <input id="ai-key" className="word-search-input" type="password" value={aiKey} onChange={(e) => setAiKey(e.target.value)} placeholder={aiConfig?.has_key ? "已保存，留空则不修改" : "sk-..."} autoComplete="new-password" />
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <button className="btn btn-primary btn-small" disabled={!!aiBusy} onClick={saveAiConfig}>{aiBusy === "save" ? "保存中…" : "保存配置"}</button>
            <button className="btn btn-ghost btn-small" disabled={!!aiBusy} onClick={testAiConfig}>{aiBusy === "test" ? "测试中…" : "测试连接"}</button>
            <span style={{ fontSize: 12, color: "var(--muted)" }}>{aiConfig?.has_key ? "密钥已配置" : "密钥未配置"}</span>
          </div>
          {aiTest && (
            <p role="status" style={{ fontSize: 12, margin: 0, color: aiTest.ok ? "var(--success)" : "var(--coral)" }}>
              {aiTest.ok ? "✅ 连接成功" : `❌ ${aiTest.error}`}
            </p>
          )}
        </div>
        <h2 className="settings-section-title">内容维护</h2>
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
            {refreshing ? "刷新中…" : "刷新例句（每次10个）"}
          </button>
          {refreshResult && (
            <div style={{ fontSize: 12, color: "var(--muted)" }}>
              本次刷新 {refreshResult.refreshed} 个 · 待刷新 {refreshResult.remaining} 个 / 共 {refreshResult.total_weak} 个弱例句
            </div>
          )}
        </div>
        <div className="settings-row" style={{ flexDirection: "column", alignItems: "flex-start", gap: 8 }}>
          <span className="settings-label">句子卡</span>
          <p style={{ fontSize: 12, color: "var(--muted)", margin: 0 }}>为已解锁句子练习的词生成更复杂的阅读句子（15-25词，有上下文故事感）</p>
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
            {regenerating ? "生成中…" : "生成句子卡（每次5个）"}
          </button>
        </div>
        <h2 className="settings-section-title">数据与备份</h2>
        <div className="settings-row" style={{ flexDirection: "column", alignItems: "flex-start", gap: 8 }}>
          <span className="settings-label">数据备份</span>
          <p style={{ fontSize: 12, color: "var(--muted)", margin: 0 }}>下载数据库全部学习内容的版本化备份</p>
          <button className="btn btn-ghost btn-small" onClick={onOpenBackup}>备份与恢复</button>
        </div>
      </div>
    </section>
  );
}
