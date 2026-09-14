"use client";

import { useEffect, useState } from "react";
import { Button, Checkbox, Input, Label, ListBox, Select, TextField } from "@heroui/react";
import { KeyRound, Monitor, Moon, Save, Send, Sun, UserCircle, Webhook } from "lucide-react";
import { useTheme } from "@/components/theme-provider";
import { PageHeader } from "@/components/page-header";
import { useLocale } from "@/components/locale-provider";

const themeColorKey = "certflow.themeColor";
type ThemeColor = "teal" | "blue" | "violet" | "orange";

type User = {
  email: string;
  role: "admin" | "user";
  status: string;
  mustChangePassword: boolean;
  lastLoginAt: string | null;
  createdAt: string;
};

export default function ProfilePage() {
  const { t } = useLocale();
  const { theme, setTheme } = useTheme();
  const [themeColor, setThemeColor] = useState<ThemeColor>("teal");
  const [user, setUser] = useState<User | null>(null);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [webhookURL, setWebhookURL] = useState("");
  const [webhookEnabled, setWebhookEnabled] = useState(false);
  const [webhookMessage, setWebhookMessage] = useState("");
  const [webhookError, setWebhookError] = useState("");
  const [webhookPending, setWebhookPending] = useState(false);

  useEffect(() => {
    fetch("/api/auth/me")
      .then((response) => (response.ok ? response.json() : null))
      .then(setUser)
      .catch(() => setUser(null));
  }, []);

  useEffect(() => {
    fetch("/api/profile/webhook")
      .then((response) => (response.ok ? response.json() : null))
      .then((settings: { enabled?: boolean; url?: string } | null) => {
        if (!settings) return;
        setWebhookEnabled(Boolean(settings.enabled));
        setWebhookURL(settings.url ?? "");
      })
      .catch(() => {
        // Webhook delivery is optional and must not block account management.
      });
  }, []);

  useEffect(() => {
    let timer: number | undefined;
    try {
      const stored = window.localStorage.getItem(themeColorKey);
      if (stored === "teal" || stored === "blue" || stored === "violet" || stored === "orange") {
        timer = window.setTimeout(() => setThemeColor(stored), 0);
      }
    } catch {
      // Theme color persistence is optional.
    }
    return () => {
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, []);

  function changeThemeColor(value: string) {
    if (value !== "teal" && value !== "blue" && value !== "violet" && value !== "orange") return;
    setThemeColor(value);
    document.documentElement.dataset.colorTheme = value;
    try {
      window.localStorage.setItem(themeColorKey, value);
      document.cookie = `${themeColorKey}=${value}; Path=/; Max-Age=31536000; SameSite=Lax`;
    } catch {
      // Theme color persistence is optional.
    }
  }

  async function changePassword(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setMessage("");
    if (newPassword.length < 8) {
      setError("新密码至少需要 8 个字符");
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("两次输入的密码不一致");
      return;
    }
    setPending(true);
    try {
      const response = await fetch("/api/auth/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const body = (await response.json().catch(() => null)) as { message?: string } | null;
      if (!response.ok) throw new Error(body?.message ?? "修改密码失败");
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setMessage("密码已修改。");
      if (user) setUser({ ...user, mustChangePassword: false });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "修改密码失败");
    } finally {
      setPending(false);
    }
  }

  async function saveWebhook(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setWebhookError("");
    setWebhookMessage("");
    setWebhookPending(true);
    try {
      const response = await fetch("/api/profile/webhook", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: webhookEnabled, url: webhookURL.trim() }),
      });
      const body = (await response.json().catch(() => null)) as { message?: string } | null;
      if (!response.ok) throw new Error(body?.message ?? "保存 Webhook 设置失败");
      setWebhookMessage(webhookEnabled ? "Webhook 通知已启用。" : "Webhook 通知已暂停。");
    } catch (reason) {
      setWebhookError(reason instanceof Error ? reason.message : "保存 Webhook 设置失败");
    } finally {
      setWebhookPending(false);
    }
  }

  async function testWebhook() {
    setWebhookError("");
    setWebhookMessage("");
    setWebhookPending(true);
    try {
      const response = await fetch("/api/profile/webhook/test", { method: "POST" });
      const body = (await response.json().catch(() => null)) as { message?: string } | null;
      if (!response.ok) throw new Error(body?.message ?? "发送测试 Webhook 失败");
      setWebhookMessage("测试通知已发送。");
    } catch (reason) {
      setWebhookError(reason instanceof Error ? reason.message : "发送测试 Webhook 失败");
    } finally {
      setWebhookPending(false);
    }
  }

  if (!user) {
    return (
      <>
        <PageHeader title="个人中心" description="账户信息与安全设置" />
        <div className="empty-state">正在加载账户信息...</div>
      </>
    );
  }

  const selectedTheme = theme === "light" || theme === "dark" || theme === "system" ? theme : "system";

  return (
    <>
      <PageHeader title="个人中心" description="查看当前账户并修改登录密码。" />
      <div className="profile-grid">
        <section className="panel profile-card">
          <div className="profile-avatar">
            <UserCircle size={34} />
          </div>
          <div>
            <h2>{user.email}</h2>
            <p>
              {user.role === "admin" ? "管理员" : "普通用户"} · {user.status === "active" ? "正常" : "已停用"}
            </p>
          </div>
          {user.mustChangePassword ? <div className="form-error">首次登录请立即修改密码。</div> : null}
        </section>

        <form className="form-section settings-form" onSubmit={changePassword}>
          <h2>
            <KeyRound size={17} /> 修改密码
          </h2>
          <label className="field">
            <span>当前密码</span>
            <input
              value={currentPassword}
              onChange={(event) => setCurrentPassword(event.target.value)}
              type="password"
              autoComplete="current-password"
              required
            />
          </label>
          <label className="field">
            <span>新密码</span>
            <input
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
              type="password"
              autoComplete="new-password"
              minLength={8}
              required
            />
            <span className="field-help">至少 8 个字符。</span>
          </label>
          <label className="field">
            <span>确认新密码</span>
            <input
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              type="password"
              autoComplete="new-password"
              minLength={8}
              required
            />
          </label>
          {message ? (
            <div className="auth-message" role="status">
              {message}
            </div>
          ) : null}
          {error ? (
            <div className="form-error" role="alert">
              {error}
            </div>
          ) : null}
          <div className="form-actions">
            <Button type="submit" variant="primary" isDisabled={pending}>
              {pending ? "正在保存" : "保存新密码"}
            </Button>
          </div>
        </form>

        <section className="panel profile-preferences">
          <div>
            <h2>{t("profile.appearance")}</h2>
            <p>{t("profile.appearanceDescription")}</p>
          </div>
          <TextField className="profile-theme-field">
            <Label>{t("profile.theme")}</Label>
            <Select selectedKey={selectedTheme} onSelectionChange={(key) => setTheme(String(key))}>
              <Select.Trigger>
                <Select.Value />
              </Select.Trigger>
              <Select.Popover>
                <ListBox>
                  <ListBox.Item id="system">
                    <Monitor size={16} />
                    {t("theme.system")}
                  </ListBox.Item>
                  <ListBox.Item id="light">
                    <Sun size={16} />
                    {t("theme.light")}
                  </ListBox.Item>
                  <ListBox.Item id="dark">
                    <Moon size={16} />
                    {t("theme.dark")}
                  </ListBox.Item>
                </ListBox>
              </Select.Popover>
            </Select>
          </TextField>
          <TextField className="profile-theme-field">
            <Label>{t("profile.themeColor")}</Label>
            <Select selectedKey={themeColor} onSelectionChange={(key) => changeThemeColor(String(key))}>
              <Select.Trigger>
                <Select.Value />
              </Select.Trigger>
              <Select.Popover>
                <ListBox>
                  <ListBox.Item id="teal">
                    <span className="theme-color-swatch theme-color-swatch-teal" />
                    {t("themeColor.teal")}
                  </ListBox.Item>
                  <ListBox.Item id="blue">
                    <span className="theme-color-swatch theme-color-swatch-blue" />
                    {t("themeColor.blue")}
                  </ListBox.Item>
                  <ListBox.Item id="violet">
                    <span className="theme-color-swatch theme-color-swatch-violet" />
                    {t("themeColor.violet")}
                  </ListBox.Item>
                  <ListBox.Item id="orange">
                    <span className="theme-color-swatch theme-color-swatch-orange" />
                    {t("themeColor.orange")}
                  </ListBox.Item>
                </ListBox>
              </Select.Popover>
            </Select>
          </TextField>
        </section>

        <form className="form-section settings-form profile-webhook-settings" onSubmit={saveWebhook}>
          <div className="profile-settings-heading">
            <div className="profile-settings-icon">
              <Webhook size={18} />
            </div>
            <div>
              <h2>通知投递</h2>
              <p>站内通知产生后，SMTP 已配置时会同步发送至当前邮箱；启用后也会投递至此 Webhook。</p>
            </div>
          </div>
          <TextField className="w-full" name="webhook-url" type="url">
            <Label>Webhook 地址</Label>
            <Input
              value={webhookURL}
              onChange={(event) => setWebhookURL(event.target.value)}
              placeholder="https://example.com/certflow/events"
              inputMode="url"
              disabled={webhookPending}
            />
          </TextField>
          <Checkbox isSelected={webhookEnabled} onChange={setWebhookEnabled} isDisabled={webhookPending}>
              <Checkbox.Content>
                <Checkbox.Control>
                  <Checkbox.Indicator />
                </Checkbox.Control>
                <span>启用 Webhook 通知</span>
              </Checkbox.Content>
          </Checkbox>
          <p className="field-help">仅支持 HTTPS。Webhook 会收到证书和执行状态变化的 JSON 事件。</p>
          {webhookMessage ? (
            <div className="auth-message" role="status">
              {webhookMessage}
            </div>
          ) : null}
          {webhookError ? (
            <div className="form-error" role="alert">
              {webhookError}
            </div>
          ) : null}
          <div className="form-actions">
            <Button type="button" variant="secondary" isDisabled={webhookPending || !webhookEnabled} onPress={() => void testWebhook()}>
              <Send size={16} />
              测试 Webhook
            </Button>
            <Button type="submit" variant="primary" isDisabled={webhookPending}>
              <Save size={16} />
              {webhookPending ? "正在保存" : "保存通知设置"}
            </Button>
          </div>
        </form>
      </div>
    </>
  );
}
