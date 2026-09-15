"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Button, Checkbox, Dropdown, Input, Label, Tabs, TextField } from "@heroui/react";
import { Eye, EyeOff, KeyRound, Languages, Mail } from "lucide-react";
import { useLocale } from "@/components/providers/locale-provider";
import { BrandLogo } from "@/components/ui/brand-logo";

type AuthMode = "password" | "code";
const lastLoginEmailKey = "certflow.lastLoginEmail";
const verificationCooldownKey = "certflow.verificationCooldownUntil";

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}
function isValidEmail(email: string) {
  // The backend accepts valid local domains such as admin@localhost.
  return /^[^\s@]+@[^\s@]+$/.test(normalizeEmail(email));
}
function sanitizeNextPath(value: string | null) {
  const path = value?.trim();
  return path && path.startsWith("/") && !path.startsWith("//") ? path : "/dashboard";
}

function useRedirectIfAuthenticated(router: ReturnType<typeof useRouter>) {
  useEffect(() => {
    let cancelled = false;
    async function checkSession() {
      try {
        let response = await fetch("/api/auth/me");
        if (response.status === 401) {
          const refreshed = await fetch("/api/auth/refresh", { method: "POST" });
          if (refreshed.ok) response = await fetch("/api/auth/me");
        }
        if (!cancelled && response.ok) {
          router.replace(sanitizeNextPath(new URLSearchParams(window.location.search).get("next")));
        }
      } catch {
        // An unavailable API must not prevent a fresh login.
      }
    }
    void checkSession();
    return () => {
      cancelled = true;
    };
  }, [router]);
}

async function request(path: string, body: unknown, timeoutMessage: string, fallbackMessage: string) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 20_000);
  try {
    const response = await fetch(`/api/auth/${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const payload = (await response.json().catch(() => null)) as { message?: string } | null;
    if (!response.ok) throw new Error(payload?.message ?? fallbackMessage);
    return payload;
  } catch (reason) {
    if (reason instanceof DOMException && reason.name === "AbortError") throw new Error(timeoutMessage);
    throw reason;
  } finally {
    window.clearTimeout(timeout);
  }
}

function useLastLoginEmail() {
  const [email, setEmail] = useState("");
  useEffect(() => {
    let timer: number | undefined;
    try {
      const stored = window.localStorage.getItem(lastLoginEmailKey);
      if (stored) timer = window.setTimeout(() => setEmail(stored), 0);
    } catch {
      /* Storage is optional. */
    }
    return () => {
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, []);
  const remember = (value: string) => {
    try {
      window.localStorage.setItem(lastLoginEmailKey, value);
    } catch {
      /* Storage is optional. */
    }
  };
  return { email, setEmail, remember };
}

function useVerificationCooldown() {
  const [cooldown, setCooldown] = useState(0);
  useEffect(() => {
    let timer: number | undefined;
    try {
      const until = Number(window.sessionStorage.getItem(verificationCooldownKey));
      const remaining = Math.max(0, Math.ceil((until - Date.now()) / 1000));
      if (remaining > 0) timer = window.setTimeout(() => setCooldown(remaining), 0);
    } catch {
      /* Session storage is optional. */
    }
    return () => {
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, []);
  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = window.setInterval(
      () =>
        setCooldown((value) => {
          const next = Math.max(0, value - 1);
          if (next === 0) {
            try {
              window.sessionStorage.removeItem(verificationCooldownKey);
            } catch {
              /* Ignore storage failures. */
            }
          }
          return next;
        }),
      1000,
    );
    return () => window.clearInterval(timer);
  }, [cooldown]);
  const startCooldown = () => {
    setCooldown(60);
    try {
      window.sessionStorage.setItem(verificationCooldownKey, String(Date.now() + 60_000));
    } catch {
      /* Backend still rate-limits. */
    }
  };
  return { cooldown, startCooldown };
}

function AuthBrand() {
  return (
    <div className="auth-brand">
      <BrandLogo variant="auth" priority />
    </div>
  );
}

export function AuthPage({ children }: { children: ReactNode }) {
  const { locale, setLocale, t } = useLocale();
  return (
    <main className="auth-page">
      <div className="auth-locale-control">
        <Dropdown>
          <Dropdown.Trigger className="locale-trigger auth-locale-trigger" aria-label={t("language.change")}>
            <Languages size={16} aria-hidden="true" />
            <span>{locale === "zh-CN" ? "中" : "EN"}</span>
          </Dropdown.Trigger>
          <Dropdown.Popover placement="bottom end">
            <Dropdown.Menu
              selectedKeys={[locale]}
              selectionMode="single"
              onAction={(key) => setLocale(key as "zh-CN" | "en")}
            >
              <Dropdown.Item id="zh-CN">{t("language.zh-CN")}</Dropdown.Item>
              <Dropdown.Item id="en">{t("language.en")}</Dropdown.Item>
            </Dropdown.Menu>
          </Dropdown.Popover>
        </Dropdown>
      </div>
      <aside className="auth-aside" aria-label={t("auth.asideEyebrow")}>
        <div className="auth-aside-content">
          <AuthBrand />
          <div className="auth-aside-copy">
            <span className="auth-eyebrow">{t("auth.asideEyebrow")}</span>
            <h1>{t("auth.asideTitle")}</h1>
            <p>{t("auth.asideBody")}</p>
          </div>
          <p className="auth-aside-footer">{t("auth.asideFooter")}</p>
        </div>
      </aside>
      <div className="auth-stage">{children}</div>
    </main>
  );
}

function AuthFeedback({ message, error }: { message: string; error: string }) {
  return (
    <>
      {message ? (
        <div className="auth-message" role="status" aria-live="polite">
          {message}
        </div>
      ) : null}
      {error ? (
        <div className="form-error" role="alert" aria-live="assertive">
          {error}
        </div>
      ) : null}
    </>
  );
}

function PasswordField({
  label,
  value,
  onChange,
  autoComplete,
  placeholder,
  showLabel,
  minLength,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete: "current-password" | "new-password";
  placeholder: string;
  showLabel: string;
  minLength?: number;
}) {
  const { t } = useLocale();
  const [visible, setVisible] = useState(false);
  return (
    <TextField className="auth-field" name={autoComplete} value={value} onChange={onChange} isRequired>
      <Label>{label}</Label>
      <div className="auth-input-with-action">
        <Input
          type={visible ? "text" : "password"}
          autoComplete={autoComplete}
          minLength={minLength}
          placeholder={placeholder}
          aria-label={label}
        />
        <Button
          type="button"
          variant="ghost"
          isIconOnly
          className="auth-password-toggle"
          aria-label={visible ? t("auth.hidePassword") : showLabel}
          onPress={() => setVisible((current) => !current)}
        >
          {visible ? <EyeOff size={17} /> : <Eye size={17} />}
        </Button>
      </div>
    </TextField>
  );
}

function VerificationField({
  email,
  code,
  setCode,
  pending,
  cooldown,
  sendCode,
}: {
  email: string;
  code: string;
  setCode: (value: string) => void;
  pending: boolean;
  cooldown: number;
  sendCode: () => void;
}) {
  const { t, locale } = useLocale();
  const retryLabel =
    locale === "zh-CN" ? `${cooldown} ${t("auth.retryCode")}` : `${cooldown}${t("auth.retryCode")}`;
  return (
    <TextField
      className="auth-field"
      name="code"
      value={code}
      onChange={(value) => setCode(value.replace(/\D/g, "").slice(0, 6))}
      isRequired
    >
      <Label>{t("auth.code")}</Label>
      <div className="code-row">
        <Input
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9]{6}"
          maxLength={6}
          placeholder={t("auth.codePlaceholder")}
          aria-label={t("auth.code")}
        />
        <Button
          type="button"
          variant="secondary"
          isDisabled={pending || cooldown > 0 || !isValidEmail(email)}
          onPress={sendCode}
        >
          <Mail size={15} aria-hidden="true" /> {cooldown > 0 ? retryLabel : t("auth.sendCode")}
        </Button>
      </div>
    </TextField>
  );
}

function RememberMe({ value, onChange }: { value: boolean; onChange: (value: boolean) => void }) {
  const { t } = useLocale();
  return (
    <Checkbox className="remember-me" isSelected={value} onChange={onChange}>
      <Checkbox.Content>
        <Checkbox.Control>
          <Checkbox.Indicator />
        </Checkbox.Control>
        <span>
          <span className="remember-label">{t("auth.rememberMe")}</span>
          <small>{t("auth.rememberHint")}</small>
        </span>
      </Checkbox.Content>
    </Checkbox>
  );
}

export function LoginForm() {
  const router = useRouter();
  const { t } = useLocale();
  const { email, setEmail, remember } = useLastLoginEmail();
  const [mode, setMode] = useState<AuthMode>("password");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [rememberMe, setRememberMe] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [sendingCode, setSendingCode] = useState(false);
  const { cooldown, startCooldown } = useVerificationCooldown();
  useRedirectIfAuthenticated(router);
  const clearFeedback = () => {
    if (error) setError("");
    if (message) setMessage("");
  };

  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalizedEmail = normalizeEmail(email);
    if (!isValidEmail(normalizedEmail)) {
      setError(t("auth.invalidEmail"));
      return;
    }
    if (mode === "code" && code.length !== 6) {
      setError(t("auth.invalidCode"));
      return;
    }
    setError("");
    setMessage("");
    setPending(true);
    try {
      await request(
        mode === "password" ? "login/password" : "login/code",
        mode === "password"
          ? { email: normalizedEmail, password, rememberMe }
          : { email: normalizedEmail, code, rememberMe },
        t("auth.loginTimeout"),
        t("auth.requestFailed"),
      );
      remember(normalizedEmail);
      router.replace(sanitizeNextPath(new URLSearchParams(window.location.search).get("next")));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t("auth.loginFailed"));
    } finally {
      setPending(false);
    }
  }

  async function sendCode() {
    const normalizedEmail = normalizeEmail(email);
    if (!isValidEmail(normalizedEmail)) {
      setError(t("auth.invalidEmailForCode"));
      return;
    }
    if (cooldown > 0 || sendingCode) return;
    setError("");
    setMessage("");
    setSendingCode(true);
    try {
      await request(
        "login/request-code",
        { email: normalizedEmail },
        t("auth.codeTimeout"),
        t("auth.requestFailed"),
      );
      setMessage(t("auth.codeSent"));
      startCooldown();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t("auth.sendFailed"));
    } finally {
      setSendingCode(false);
    }
  }

  return (
    <section className="auth-panel" aria-labelledby="login-title">
      <h1 id="login-title">{t("auth.loginTitle")}</h1>
      <p>{t("auth.loginSubtitle")}</p>
      <Tabs
        className="auth-tabs"
        selectedKey={mode}
        onSelectionChange={(key) => {
          setMode(String(key) as AuthMode);
          clearFeedback();
        }}
      >
        <Tabs.ListContainer>
          <Tabs.List aria-label={t("auth.methodLabel")}>
            <Tabs.Tab id="password">{t("auth.passwordLogin")}</Tabs.Tab>
            <Tabs.Tab id="code">{t("auth.codeLogin")}</Tabs.Tab>
          </Tabs.List>
        </Tabs.ListContainer>
      </Tabs>
      <form className="auth-form" onSubmit={login} noValidate>
        <TextField
          className="auth-field"
          name="email"
          type="email"
          value={email}
          onChange={(value) => {
            setEmail(value);
            clearFeedback();
          }}
          isRequired
        >
          <Label>{t("auth.email")}</Label>
          <Input
            autoFocus
            autoComplete="email"
            inputMode="email"
            autoCapitalize="none"
            spellCheck={false}
            placeholder={t("auth.emailPlaceholder")}
          />
        </TextField>
        {mode === "password" ? (
          <PasswordField
            label={t("auth.password")}
            value={password}
            onChange={(value) => {
              setPassword(value);
              clearFeedback();
            }}
            autoComplete="current-password"
            placeholder={t("auth.passwordPlaceholder")}
            showLabel={t("auth.showPassword")}
          />
        ) : (
          <VerificationField
            email={email}
            code={code}
            setCode={(value) => {
              setCode(value);
              clearFeedback();
            }}
            pending={sendingCode || pending}
            cooldown={cooldown}
            sendCode={sendCode}
          />
        )}
        <RememberMe value={rememberMe} onChange={setRememberMe} />
        <AuthFeedback message={message} error={error} />
        <Button type="submit" variant="primary" isDisabled={pending} aria-busy={pending}>
          <KeyRound size={16} aria-hidden="true" /> {pending ? t("auth.loggingIn") : t("auth.login")}
        </Button>
      </form>
      <div className="auth-footer">
        {t("auth.noAccount")} <Link href="/register">{t("auth.registerLink")}</Link>
      </div>
    </section>
  );
}

export function RegisterForm() {
  const router = useRouter();
  const { t } = useLocale();
  const { email, setEmail, remember } = useLastLoginEmail();
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [sendingCode, setSendingCode] = useState(false);
  const { cooldown, startCooldown } = useVerificationCooldown();
  useRedirectIfAuthenticated(router);
  const clearFeedback = () => {
    if (error) setError("");
    if (message) setMessage("");
  };
  async function sendCode() {
    const normalizedEmail = normalizeEmail(email);
    if (!isValidEmail(normalizedEmail)) {
      setError(t("auth.invalidEmailForCode"));
      return;
    }
    if (cooldown > 0 || sendingCode) return;
    setError("");
    setMessage("");
    setSendingCode(true);
    try {
      await request(
        "register/request-code",
        { email: normalizedEmail },
        t("auth.codeTimeout"),
        t("auth.requestFailed"),
      );
      setMessage(t("auth.codeSent"));
      startCooldown();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t("auth.sendFailed"));
    } finally {
      setSendingCode(false);
    }
  }
  async function register(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalizedEmail = normalizeEmail(email);
    if (!isValidEmail(normalizedEmail)) {
      setError(t("auth.invalidEmail"));
      return;
    }
    if (code.length !== 6) {
      setError(t("auth.invalidCode"));
      return;
    }
    if (password !== confirm) {
      setError(t("auth.passwordMismatch"));
      return;
    }
    setError("");
    setMessage("");
    setPending(true);
    try {
      await request(
        "register",
        { email: normalizedEmail, code, password },
        t("auth.registerTimeout"),
        t("auth.requestFailed"),
      );
      remember(normalizedEmail);
      router.replace("/dashboard");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t("auth.registerFailed"));
    } finally {
      setPending(false);
    }
  }
  return (
    <section className="auth-panel" aria-labelledby="register-title">
      <h1 id="register-title">{t("auth.registerTitle")}</h1>
      <p>{t("auth.registerSubtitle")}</p>
      <form className="auth-form" onSubmit={register} noValidate>
        <TextField
          className="auth-field"
          name="email"
          type="email"
          value={email}
          onChange={(value) => {
            setEmail(value);
            clearFeedback();
          }}
          isRequired
        >
          <Label>{t("auth.email")}</Label>
          <Input
            autoFocus
            autoComplete="email"
            inputMode="email"
            autoCapitalize="none"
            spellCheck={false}
            placeholder={t("auth.emailPlaceholder")}
          />
        </TextField>
        <VerificationField
          email={email}
          code={code}
          setCode={(value) => {
            setCode(value);
            clearFeedback();
          }}
          pending={sendingCode || pending}
          cooldown={cooldown}
          sendCode={sendCode}
        />
        <PasswordField
          label={t("auth.password")}
          value={password}
          onChange={(value) => {
            setPassword(value);
            clearFeedback();
          }}
          autoComplete="new-password"
          minLength={8}
          placeholder={t("auth.passwordPlaceholder")}
          showLabel={t("auth.showPassword")}
        />
        <PasswordField
          label={t("auth.confirmPassword")}
          value={confirm}
          onChange={(value) => {
            setConfirm(value);
            clearFeedback();
          }}
          autoComplete="new-password"
          minLength={8}
          placeholder={t("auth.passwordPlaceholder")}
          showLabel={t("auth.showPassword")}
        />
        <AuthFeedback message={message} error={error} />
        <Button type="submit" variant="primary" isDisabled={pending} aria-busy={pending}>
          <KeyRound size={16} aria-hidden="true" /> {pending ? t("auth.registering") : t("auth.register")}
        </Button>
      </form>
      <div className="auth-footer">
        {t("auth.hasAccount")} <Link href="/login">{t("auth.loginLink")}</Link>
      </div>
    </section>
  );
}
