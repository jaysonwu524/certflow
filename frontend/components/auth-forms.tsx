"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@heroui/react";
import { KeyRound, Mail, ShieldCheck } from "lucide-react";

async function request(path: string, body: unknown) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 20_000);
  try {
    const response = await fetch(`/api/auth/${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: controller.signal });
    const payload = await response.json().catch(() => null) as { message?: string } | null;
    if (!response.ok) throw new Error(payload?.message ?? "请求失败，请稍后重试");
    return payload;
  } catch (reason) {
    if (reason instanceof DOMException && reason.name === "AbortError") throw new Error("邮件服务响应超时，请检查 SMTP 配置后重试");
    throw reason;
  } finally {
    window.clearTimeout(timeout);
  }
}

export function LoginForm() {
  const router = useRouter();
  const [mode, setMode] = useState<"password" | "code">("password");
  const [email, setEmail] = useState(""); const [password, setPassword] = useState(""); const [code, setCode] = useState("");
  const [message, setMessage] = useState(""); const [error, setError] = useState(""); const [pending, setPending] = useState(false);
  const finish = () => router.replace("/dashboard");
  async function login(event: React.FormEvent) { event.preventDefault(); setError(""); setPending(true); try { await request(mode === "password" ? "login/password" : "login/code", mode === "password" ? { email, password } : { email, code }); finish(); } catch (reason) { setError(reason instanceof Error ? reason.message : "登录失败"); } finally { setPending(false); } }
  async function sendCode() { setError(""); setMessage(""); setPending(true); try { await request("login/request-code", { email }); setMessage("验证码已发送，请查收邮箱。"); } catch (reason) { setError(reason instanceof Error ? reason.message : "发送失败"); } finally { setPending(false); } }
  return <section className="auth-panel"><div className="auth-brand"><span className="brand-mark"><ShieldCheck size={20} /></span><span>CertFlow</span></div><h1>登录控制台</h1><p>使用你的 CertFlow 账户继续。</p><div className="auth-tabs"><button className={mode === "password" ? "auth-tab active" : "auth-tab"} onClick={() => setMode("password")} type="button">密码登录</button><button className={mode === "code" ? "auth-tab active" : "auth-tab"} onClick={() => setMode("code")} type="button">验证码登录</button></div><form className="auth-form" onSubmit={login}><label>邮箱<input value={email} onChange={(event) => setEmail(event.target.value)} type="email" autoComplete="email" required placeholder="you@example.com" /></label>{mode === "password" ? <label>密码<input value={password} onChange={(event) => setPassword(event.target.value)} type="password" autoComplete="current-password" required /></label> : <label>验证码<div className="code-row"><input value={code} onChange={(event) => setCode(event.target.value)} inputMode="numeric" required maxLength={6} /><Button type="button" variant="secondary" isDisabled={pending || !email} onPress={sendCode}><Mail size={15} /> 获取验证码</Button></div></label>}{message ? <div className="auth-message">{message}</div> : null}{error ? <div className="form-error">{error}</div> : null}<Button type="submit" variant="primary" isDisabled={pending}><KeyRound size={16} /> {pending ? "正在处理" : "登录"}</Button></form><div className="auth-footer">没有账户？<Link href="/register">邮箱注册</Link></div></section>;
}

export function RegisterForm() {
  const router = useRouter();
  const [email, setEmail] = useState(""); const [code, setCode] = useState(""); const [password, setPassword] = useState(""); const [confirm, setConfirm] = useState(""); const [message, setMessage] = useState(""); const [error, setError] = useState(""); const [pending, setPending] = useState(false);
  async function sendCode() { setError(""); setMessage(""); setPending(true); try { await request("register/request-code", { email }); setMessage("验证码已发送，请查收邮箱。"); } catch (reason) { setError(reason instanceof Error ? reason.message : "发送失败"); } finally { setPending(false); } }
  async function register(event: React.FormEvent) { event.preventDefault(); if (password !== confirm) { setError("两次输入的密码不一致"); return; } setError(""); setPending(true); try { await request("register", { email, code, password }); router.replace("/dashboard"); } catch (reason) { setError(reason instanceof Error ? reason.message : "注册失败"); } finally { setPending(false); } }
  return <section className="auth-panel"><div className="auth-brand"><span className="brand-mark"><ShieldCheck size={20} /></span><span>CertFlow</span></div><h1>创建账户</h1><p>验证邮箱后即可创建普通用户账户。</p><form className="auth-form" onSubmit={register}><label>邮箱<input value={email} onChange={(event) => setEmail(event.target.value)} type="email" autoComplete="email" required placeholder="you@example.com" /></label><label>验证码<div className="code-row"><input value={code} onChange={(event) => setCode(event.target.value)} inputMode="numeric" required maxLength={6} /><Button type="button" variant="secondary" isDisabled={pending || !email} onPress={sendCode}><Mail size={15} /> 获取验证码</Button></div></label><label>密码<input value={password} onChange={(event) => setPassword(event.target.value)} type="password" autoComplete="new-password" required minLength={8} /></label><label>确认密码<input value={confirm} onChange={(event) => setConfirm(event.target.value)} type="password" autoComplete="new-password" required minLength={8} /></label>{message ? <div className="auth-message">{message}</div> : null}{error ? <div className="form-error">{error}</div> : null}<Button type="submit" variant="primary" isDisabled={pending}><KeyRound size={16} /> {pending ? "正在创建" : "注册并登录"}</Button></form><div className="auth-footer">已有账户？<Link href="/login">登录</Link></div></section>;
}
