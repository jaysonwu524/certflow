"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button, Checkbox, Input, Label, ListBox, Select, Tag, TagGroup, TextField } from "@heroui/react";
import { Clock3, KeyRound, Mail, Monitor, Moon, Palette, RefreshCw, Save, Send, ShieldCheck, Sun, UserCircle, Webhook } from "lucide-react";
import { ResourceEmptyState } from "@/components/ui/resource-empty-state";
import { useLocale } from "@/components/providers/locale-provider";
import { useTheme } from "@/components/providers/theme-provider";

const themeColorKey = "certflow.themeColor";
type ThemeColor = "teal" | "blue" | "violet" | "orange";

type User = { email: string; role: "admin" | "user"; status: string; mustChangePassword: boolean; lastLoginAt: string | null; createdAt: string };
type Session = { id: string; deviceLabel: string; createdAt: string; lastSeenAt: string; expiresAt: string; isCurrent: boolean };
type WebhookSettings = {
  enabled: boolean; url: string; emailConfigured: boolean;
  lastDeliveryStatus: "" | "queued" | "running" | "succeeded" | "failed";
  lastDeliveryAt: string | null; lastDeliveryError: string;
};

function withCount(template: string, count: number) { return template.replace("{count}", String(count)); }

export default function ProfilePage() {
  const { locale, t } = useLocale();
  const { theme, setTheme } = useTheme();
  const [themeColor, setThemeColor] = useState<ThemeColor>("teal");
  const [user, setUser] = useState<User | null>(null);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [webhook, setWebhook] = useState<WebhookSettings>({ enabled: false, url: "", emailConfigured: false, lastDeliveryStatus: "", lastDeliveryAt: null, lastDeliveryError: "" });
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [revokeAfterPasswordChange, setRevokeAfterPasswordChange] = useState(true);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [securityMessage, setSecurityMessage] = useState("");
  const [securityError, setSecurityError] = useState("");
  const [passwordPending, setPasswordPending] = useState(false);
  const [sessionsPending, setSessionsPending] = useState(false);
  const [webhookMessage, setWebhookMessage] = useState("");
  const [webhookError, setWebhookError] = useState("");
  const [webhookPending, setWebhookPending] = useState(false);

  const dateFormatter = useMemo(() => new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }), [locale]);
  const formatDate = useCallback((value: string | null) => (value ? dateFormatter.format(new Date(value)) : t("profile.never")), [dateFormatter, t]);

  const loadProfile = useCallback(async () => {
    setLoading(true);
    setLoadError("");
    try {
      const [userResponse, webhookResponse, sessionsResponse] = await Promise.all([fetch("/api/auth/me"), fetch("/api/profile/webhook"), fetch("/api/profile/sessions")]);
      if (!userResponse.ok) throw new Error(t("profile.loadFailed"));
      setUser((await userResponse.json()) as User);
      if (webhookResponse.ok) setWebhook((await webhookResponse.json()) as WebhookSettings);
      if (sessionsResponse.ok) setSessions((await sessionsResponse.json()) as Session[]);
    } catch (reason) {
      setLoadError(reason instanceof Error ? reason.message : t("profile.loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadProfile(), 0);
    return () => window.clearTimeout(timer);
  }, [loadProfile]);
  useEffect(() => {
    let timer: number | undefined;
    try {
      const stored = window.localStorage.getItem(themeColorKey);
      if (stored === "teal" || stored === "blue" || stored === "violet" || stored === "orange") {
        timer = window.setTimeout(() => setThemeColor(stored), 0);
      }
    } catch {
      // Browser appearance preferences must never block account management.
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
    setSecurityError("");
    setSecurityMessage("");
    if (newPassword.length < 8) { setSecurityError(t("profile.passwordHint")); return; }
    if (newPassword !== confirmPassword) { setSecurityError(t("auth.passwordMismatch")); return; }
    setPasswordPending(true);
    try {
      const response = await fetch("/api/auth/change-password", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ currentPassword, newPassword, revokeOtherSessions: revokeAfterPasswordChange }) });
      const body = (await response.json().catch(() => null)) as { message?: string; revokedSessions?: number } | null;
      if (!response.ok) throw new Error(body?.message ?? t("profile.saveFailed"));
      setCurrentPassword(""); setNewPassword(""); setConfirmPassword("");
      if (user) setUser({ ...user, mustChangePassword: false });
      setSecurityMessage(revokeAfterPasswordChange ? withCount(t("profile.passwordSavedWithSessions"), body?.revokedSessions ?? 0) : t("profile.passwordSaved"));
      if (revokeAfterPasswordChange) void loadProfile();
    } catch (reason) {
      setSecurityError(reason instanceof Error ? reason.message : t("profile.saveFailed"));
    } finally { setPasswordPending(false); }
  }

  async function revokeOtherSessions() {
    setSecurityError(""); setSecurityMessage(""); setSessionsPending(true);
    try {
      const response = await fetch("/api/profile/sessions/revoke-others", { method: "POST" });
      const body = (await response.json().catch(() => null)) as { message?: string; revokedSessions?: number } | null;
      if (!response.ok) throw new Error(body?.message ?? t("profile.saveFailed"));
      setSecurityMessage(withCount(t("profile.sessionsRevoked"), body?.revokedSessions ?? 0));
      await loadProfile();
    } catch (reason) {
      setSecurityError(reason instanceof Error ? reason.message : t("profile.saveFailed"));
    } finally { setSessionsPending(false); }
  }

  async function saveWebhook(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setWebhookError(""); setWebhookMessage(""); setWebhookPending(true);
    try {
      const response = await fetch("/api/profile/webhook", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ enabled: webhook.enabled, url: webhook.url.trim() }) });
      const body = (await response.json().catch(() => null)) as { message?: string } | null;
      if (!response.ok) throw new Error(body?.message ?? t("profile.saveFailed"));
      setWebhookMessage(webhook.enabled ? t("profile.webhookEnabled") : t("profile.webhookPaused"));
      await loadProfile();
    } catch (reason) {
      setWebhookError(reason instanceof Error ? reason.message : t("profile.saveFailed"));
    } finally { setWebhookPending(false); }
  }

  async function testWebhook() {
    setWebhookError(""); setWebhookMessage(""); setWebhookPending(true);
    try {
      const response = await fetch("/api/profile/webhook/test", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url: webhook.url.trim() }) });
      const body = (await response.json().catch(() => null)) as { message?: string } | null;
      if (!response.ok) throw new Error(body?.message ?? t("profile.saveFailed"));
      setWebhookMessage(t("profile.webhookTestSent"));
    } catch (reason) {
      setWebhookError(reason instanceof Error ? reason.message : t("profile.saveFailed"));
    } finally { setWebhookPending(false); }
  }

  if (loading) return <ResourceEmptyState icon={UserCircle} title={t("profile.loading")} size="compact" />;
  if (loadError || !user) return <ResourceEmptyState icon={ShieldCheck} title={t("profile.loadFailed")} description={loadError || t("common.apiUnavailable")} variant="error" size="compact" primaryAction={{ label: t("profile.retry"), onPress: () => void loadProfile(), icon: RefreshCw }} />;

  const selectedTheme = theme === "light" || theme === "dark" || theme === "system" ? theme : "system";
  const otherSessions = sessions.filter((session) => !session.isCurrent);
  const deliveryKey = webhook.lastDeliveryStatus === "succeeded" ? "profile.deliverySucceeded" : webhook.lastDeliveryStatus === "failed" ? "profile.deliveryFailed" : webhook.lastDeliveryStatus === "queued" || webhook.lastDeliveryStatus === "running" ? "profile.deliveryPending" : "profile.webhookNeverDelivered";

  return (
    <div className="profile-grid">
      <section className="panel profile-account-card">
          <div className="profile-section-heading"><div className="profile-avatar"><UserCircle size={30} /></div><div><h2>{t("profile.account")}</h2><p>{t("profile.accountDescription")}</p></div></div>
          <dl className="profile-details-grid">
            <div><dt>{t("profile.email")}</dt><dd>{user.email}</dd></div><div><dt>{t("profile.role")}</dt><dd>{user.role === "admin" ? t("account.admin") : t("account.user")}</dd></div>
            <div><dt>{t("profile.accountStatus")}</dt><dd>{user.status === "active" ? t("profile.accountActive") : user.status}</dd></div><div><dt>{t("profile.lastLoginAt")}</dt><dd>{formatDate(user.lastLoginAt)}</dd></div>
            <div><dt>{t("profile.createdAt")}</dt><dd>{formatDate(user.createdAt)}</dd></div>
          </dl>
          {user.mustChangePassword ? <div className="form-error" role="alert">{t("profile.passwordDescription")}</div> : null}
      </section>

      <form className="form-section settings-form profile-security-settings" onSubmit={changePassword}>
          <ProfileHeading icon={KeyRound} title={t("profile.password")} description={t("profile.passwordDescription")} />
          <div className="profile-password-fields">
            <TextField className="profile-current-password" name="current-password" type="password" isRequired><Label>{t("profile.currentPassword")}</Label><Input value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} autoComplete="current-password" /></TextField>
            <TextField name="new-password" type="password" isRequired><Label>{t("profile.newPassword")}</Label><Input value={newPassword} onChange={(event) => setNewPassword(event.target.value)} autoComplete="new-password" minLength={8} /></TextField>
            <TextField name="confirm-password" type="password" isRequired><Label>{t("profile.confirmPassword")}</Label><Input value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} autoComplete="new-password" minLength={8} /></TextField>
          </div>
          <p className="field-help">{t("profile.passwordHint")}</p>
          <Checkbox isSelected={revokeAfterPasswordChange} onChange={setRevokeAfterPasswordChange} isDisabled={passwordPending}><Checkbox.Content><Checkbox.Control><Checkbox.Indicator /></Checkbox.Control><span>{t("profile.revokeOthers")}</span></Checkbox.Content></Checkbox>
          {securityMessage ? <div className="auth-message" role="status">{securityMessage}</div> : null}{securityError ? <div className="form-error" role="alert">{securityError}</div> : null}
          <div className="form-actions"><Button type="submit" variant="primary" isDisabled={passwordPending}>{passwordPending ? t("profile.savingPassword") : t("profile.savePassword")}</Button></div>
      </form>

      <section className="panel profile-sessions-card">
          <ProfileHeading icon={Monitor} title={t("profile.sessions")} description={t("profile.sessionsDescription")} />
          <div className="profile-session-list">{sessions.map((session) => <div className="profile-session-item" key={session.id}><div><strong>{session.deviceLabel}</strong><span>{t("profile.lastActive")} {formatDate(session.lastSeenAt)}</span></div>{session.isCurrent ? <TagGroup aria-label={t("profile.currentSession")} size="sm"><TagGroup.List><Tag id={`current-session-${session.id}`}>{t("profile.currentSession")}</Tag></TagGroup.List></TagGroup> : null}</div>)}</div>
          <div className="profile-session-footer"><span>{otherSessions.length === 0 ? t("profile.noOtherSessions") : `${otherSessions.length} ${t("profile.sessions")}`}</span><Button type="button" size="sm" variant="secondary" isDisabled={sessionsPending || otherSessions.length === 0} onPress={() => void revokeOtherSessions()}>{t("profile.revokeOtherSessions")}</Button></div>
      </section>

      <section className="panel profile-preferences">
          <ProfileHeading icon={Palette} title={t("profile.appearance")} description={t("profile.appearanceDescription")} />
          <div className="profile-preference-fields">
            <TextField className="profile-theme-field"><Label>{t("profile.theme")}</Label><Select selectedKey={selectedTheme} onSelectionChange={(key) => setTheme(String(key))}><Select.Trigger><Select.Value /></Select.Trigger><Select.Popover><ListBox><ListBox.Item id="system"><Monitor size={16} />{t("theme.system")}</ListBox.Item><ListBox.Item id="light"><Sun size={16} />{t("theme.light")}</ListBox.Item><ListBox.Item id="dark"><Moon size={16} />{t("theme.dark")}</ListBox.Item></ListBox></Select.Popover></Select></TextField>
            <TextField className="profile-theme-field"><Label>{t("profile.themeColor")}</Label><Select selectedKey={themeColor} onSelectionChange={(key) => changeThemeColor(String(key))}><Select.Trigger><Select.Value /></Select.Trigger><Select.Popover><ListBox><ListBox.Item id="teal"><span className="theme-color-swatch theme-color-swatch-teal" />{t("themeColor.teal")}</ListBox.Item><ListBox.Item id="blue"><span className="theme-color-swatch theme-color-swatch-blue" />{t("themeColor.blue")}</ListBox.Item><ListBox.Item id="violet"><span className="theme-color-swatch theme-color-swatch-violet" />{t("themeColor.violet")}</ListBox.Item><ListBox.Item id="orange"><span className="theme-color-swatch theme-color-swatch-orange" />{t("themeColor.orange")}</ListBox.Item></ListBox></Select.Popover></Select></TextField>
          </div>
      </section>

      <form className="form-section settings-form profile-webhook-settings" onSubmit={saveWebhook}>
          <ProfileHeading icon={Webhook} title={t("profile.notifications")} description={t("profile.notificationsDescription")} />
          <div className="profile-delivery-health"><div><Mail size={16} /><span>{t("profile.emailDelivery")}</span><strong className={webhook.emailConfigured ? "is-success" : ""}>{webhook.emailConfigured ? t("profile.emailAvailable") : t("profile.emailUnavailable")}</strong></div><div><Clock3 size={16} /><span>{t("profile.webhookDelivery")}</span><strong className={webhook.lastDeliveryStatus === "succeeded" ? "is-success" : webhook.lastDeliveryStatus === "failed" ? "is-error" : ""}>{t(deliveryKey)}{webhook.lastDeliveryAt ? ` · ${formatDate(webhook.lastDeliveryAt)}` : ""}</strong></div>{webhook.lastDeliveryError ? <p className="profile-delivery-error">{webhook.lastDeliveryError}</p> : null}</div>
          <TextField className="w-full" name="webhook-url" type="url"><Label>{t("profile.webhookURL")}</Label><Input value={webhook.url} onChange={(event) => setWebhook((current) => ({ ...current, url: event.target.value }))} placeholder="https://example.com/certflow/events" inputMode="url" disabled={webhookPending} /></TextField>
          <Checkbox isSelected={webhook.enabled} onChange={(enabled) => setWebhook((current) => ({ ...current, enabled }))} isDisabled={webhookPending}><Checkbox.Content><Checkbox.Control><Checkbox.Indicator /></Checkbox.Control><span>{t("profile.enableWebhook")}</span></Checkbox.Content></Checkbox><p className="field-help">{t("profile.webhookHint")}</p>
          {webhookMessage ? <div className="auth-message" role="status">{webhookMessage}</div> : null}{webhookError ? <div className="form-error" role="alert">{webhookError}</div> : null}
          <div className="form-actions"><Button type="button" variant="secondary" isDisabled={webhookPending || !webhook.url.trim()} onPress={() => void testWebhook()}><Send size={16} />{t("profile.testWebhook")}</Button><Button type="submit" variant="primary" isDisabled={webhookPending}><Save size={16} />{webhookPending ? t("profile.savingNotifications") : t("profile.saveNotifications")}</Button></div>
      </form>
    </div>
  );
}

function ProfileHeading({ icon: Icon, title, description }: { icon: typeof KeyRound; title: string; description: string }) {
  return <div className="profile-section-heading"><div className="profile-settings-icon"><Icon size={18} /></div><div><h2>{title}</h2><p>{description}</p></div></div>;
}
