import React, {useEffect, useState} from "react";
import App from "../App.jsx";
import {configureAccount} from "../lib/accountSession.js";
import "../styles/login.css";

const AUTH_CHANGE = "ec.auth.change";
function announceChange() {
  try { localStorage.setItem(AUTH_CHANGE, crypto.randomUUID()); } catch {}
}
async function sessionRequest(path, options = {}) {
  const response = await fetch(path, {cache: "no-store", credentials: "same-origin", ...options});
  let data;
  try { data = await response.json(); } catch { throw new Error("服务器响应异常，请稍后重试"); }
  if (!response.ok) throw new Error(data.detail || "暂时无法连接，请稍后重试");
  return data;
}

function Brand() {
  return <div className="login-brand"><img src="/static/favicon.svg" alt="" width="30" height="30" /><span>EnglishCoach</span></div>;
}

function LoginPage({notice}) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const submit = async event => {
    event.preventDefault();
    if (busy) return;
    setBusy(true); setError("");
    try {
      await sessionRequest("/auth/login", {method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify({username: username.trim(), password})});
      setPassword("");
      announceChange();
      window.location.replace("/");
    } catch (failure) {
      setError(failure.message || "连接失败，请检查网络后重试");
      setBusy(false);
    }
  };
  return <main className="login-page">
    <section className="login-intro" aria-label="EnglishCoach">
      <Brand />
      <div className="login-editorial">
        <span className="login-eyebrow">A LITTLE PRACTICE, EVERY DAY</span>
        <p className="login-headline">每天一点，<br />让英语成为日常。</p>
        <p className="login-intro-copy">从一个单词、一段故事开始。<br />按自己的节奏，把学过的慢慢变成会用的。</p>
      </div>
      <p className="login-intro-note">你的学习，留在自己的空间。</p>
    </section>
    <section className="login-form-section" aria-labelledby="login-title">
      <div className="login-form-wrap">
        <p className="login-eyebrow">YOUR LEARNING SPACE</p>
        <h1 id="login-title">欢迎回来</h1>
        <p className="login-description">登录账号，继续今天的学习。</p>
        {notice && !error && <p className="login-notice" role="status">{notice}</p>}
        <form onSubmit={submit} className="login-form" aria-busy={busy}>
          <div className="login-field">
            <label htmlFor="login-username">用户名</label>
            <input id="login-username" name="username" autoComplete="username" autoCapitalize="none" spellCheck={false} required maxLength={32} value={username} onChange={event => setUsername(event.target.value)} placeholder="输入用户名" disabled={busy} aria-describedby={error ? "login-error" : undefined} />
          </div>
          <div className="login-field">
            <label htmlFor="login-password">密码</label>
            <div className="login-password-wrap">
              <input id="login-password" name="password" type={visible ? "text" : "password"} autoComplete="current-password" required maxLength={1024} value={password} onChange={event => setPassword(event.target.value)} placeholder="输入密码" disabled={busy} aria-describedby={error ? "login-error" : undefined} />
              <button className="login-reveal" type="button" aria-label={visible ? "隐藏密码" : "显示密码"} aria-pressed={visible} disabled={busy} onClick={() => setVisible(!visible)}>{visible ? "隐藏" : "显示"}</button>
            </div>
          </div>
          {error && <p id="login-error" role="alert" className="login-error">{error}</p>}
          <button type="submit" className="login-submit" disabled={busy}>{busy ? "正在登录…" : "登录并开始学习"}<span aria-hidden="true">→</span></button>
        </form>
        <p className="login-invitation">使用邀请人提供的账号和密码登录。</p>
        <div className="login-privacy"><span className="login-privacy-dot" aria-hidden="true" /><p>学习记录与 AI 配置按账号独立保存。</p></div>
      </div>
    </section>
  </main>;
}

export default function SessionRoot() {
  const [session, setSession] = useState(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [leaving, setLeaving] = useState(false);
  const load = async () => {
    const current = await sessionRequest("/auth/session");
    if (typeof current.enabled !== "boolean" || (current.username !== null && typeof current.username !== "string")) throw new Error("登录状态无效，请刷新重试");
    if (!current.enabled || current.username) configureAccount(current.username);
    return current;
  };
  useEffect(() => {
    let active = true;
    load().then(value => {if (active) setSession(value);}).catch(() => {if (active) setError("无法确认登录状态，请检查网络后重试。");});
    return () => { active = false; };
  }, []);
  useEffect(() => {
    const changed = event => { if (event.key === AUTH_CHANGE) window.location.replace("/"); };
    const expired = () => { setNotice("登录已失效或账号已切换，请重新登录。"); setSession({enabled: true, username: null}); };
    const recheck = async () => {
      if (!session?.enabled || !session.username || document.visibilityState === "hidden") return;
      try {
        const current = await sessionRequest("/auth/session");
        if (current.username !== session.username) window.location.replace("/");
      } catch { /* Keep the current account boundary during a transient outage. */ }
    };
    window.addEventListener("storage", changed);
    window.addEventListener("ec-auth-expired", expired);
    window.addEventListener("pageshow", recheck);
    window.addEventListener("focus", recheck);
    document.addEventListener("visibilitychange", recheck);
    return () => {
      window.removeEventListener("storage", changed);
      window.removeEventListener("ec-auth-expired", expired);
      window.removeEventListener("pageshow", recheck);
      window.removeEventListener("focus", recheck);
      document.removeEventListener("visibilitychange", recheck);
    };
  }, [session]);
  const logout = async () => {
    setLeaving(true); setError("");
    try {
      await sessionRequest("/auth/logout", {method: "POST"});
      announceChange();
      window.location.replace("/");
    } catch {
      setLeaving(false);
      setError("退出失败，请检查网络后再试。");
    }
  };
  if (!session) return <main className="session-loading"><Brand />{error ? <><p role="alert">{error}</p><button onClick={() => window.location.reload()}>重新连接</button></> : <p role="status">正在打开你的学习空间…</p>}</main>;
  if (session.enabled && !session.username) return <LoginPage notice={notice} />;
  return <><App account={session.enabled ? session.username : null} onLogout={logout} logoutBusy={leaving} logoutError={error} />{leaving && <div className="session-leaving" role="status">正在安全退出…</div>}</>;
}
