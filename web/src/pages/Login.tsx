import { useEffect, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { auth, type AuthConfig } from "../api/client";
import { useI18n } from "../i18n";
import TurnstileWidget from "../components/TurnstileWidget";
import BrandMark from "../components/BrandMark";
import SiteFooter from "../components/SiteFooter";
import ThemeToggle from "../components/ThemeToggle";
import { useBranding } from "../components/BrandingProvider";

export default function Login({ onLogin }: { onLogin: () => void }) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const { branding } = useBranding();

  const [cfg, setCfg] = useState<AuthConfig | null>(null);
  const [mode, setMode] = useState<"login" | "setup">("login");

  // Login form state.
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  // Setup form state (first-run default admin).
  const [setupUser, setSetupUser] = useState("admin");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [turnstileToken, setTurnstileToken] = useState("");
  const [resetSignal, setResetSignal] = useState(0);

  // Fetch the public login-page config: Turnstile params + whether a first-run
  // password setup is required. Any failure falls back to "disabled" so a
  // backend outage doesn't hard-lock the page.
  useEffect(() => {
    auth
      .config()
      .then((c) => {
        setCfg(c);
        if (c.setup_required) {
          setMode("setup");
          if (c.setup_username) setSetupUser(c.setup_username);
        }
      })
      .catch(() =>
        setCfg({
          turnstile_enabled: false,
          turnstile_site_key: "",
          turnstile_action: "login",
        }),
      );
  }, []);

  const requiresTurnstile = cfg?.turnstile_enabled === true;
  const configLoading = cfg === null;

  const failTurnstile = () => {
    setTurnstileToken("");
    setError(t("Human verification failed, please try again"));
    if (requiresTurnstile) setResetSignal((n) => n + 1);
  };

  const submitLogin = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    if (requiresTurnstile && !turnstileToken) {
      setError(t("Human verification failed, please try again"));
      return;
    }
    setBusy(true);
    try {
      await auth.login(
        username.trim(),
        password,
        requiresTurnstile ? turnstileToken : undefined,
      );
      onLogin();
      navigate("/");
    } catch (err) {
      setError((err as Error).message);
      failTurnstile();
    } finally {
      setBusy(false);
    }
  };

  const submitSetup = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    if (newPassword.length < 6) {
      setError(t("Password must be at least 6 characters"));
      return;
    }
    if (newPassword !== confirmPassword) {
      setError(t("Passwords do not match"));
      return;
    }
    if (requiresTurnstile && !turnstileToken) {
      setError(t("Human verification failed, please try again"));
      return;
    }
    setBusy(true);
    try {
      await auth.setup(
        setupUser.trim(),
        newPassword,
        requiresTurnstile ? turnstileToken : undefined,
      );
      onLogin();
      navigate("/");
    } catch (err) {
      setError((err as Error).message);
      failTurnstile();
    } finally {
      setBusy(false);
    }
  };

  const canSubmit = !busy && !configLoading;

  return (
    <div className="min-h-full flex flex-col">
      <div className="flex-1 flex">
        {/* Brand panel (Brex "carbon" surface, hidden on small screens). */}
        <div className="hidden md:flex md:w-[46%] lg:w-1/2 bg-[color:var(--auth-panel)] text-[color:var(--auth-panel-fg)] flex-col justify-between p-12 lg:p-16">
          <div className="flex items-center gap-3">
            <BrandMark size={40} />
            <span className="text-lg font-semibold tracking-heading">
              {branding.site_name}
            </span>
          </div>

          <div className="space-y-4">
            <h1 className="text-3xl lg:text-4xl font-semibold tracking-heading leading-tight text-[color:var(--auth-panel-fg)]">
              {mode === "setup"
                ? t("Welcome")
                : branding.login_headline || t("Sign in to your network console")}
            </h1>
            <p className="text-[15px] leading-relaxed text-[color:var(--auth-panel-muted)] max-w-md">
              {mode === "setup"
                ? t(
                    "This is the first launch. Set a password for the default admin account to start using the console.",
                  )
                : branding.login_subtitle ||
                  t("Secure, self-hosted Tailscale control plane")}
            </p>
          </div>

          <div className="flex items-center gap-2 text-[12px] text-[color:var(--auth-panel-muted)]">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-ember" />
            {t("Protected by Cloudflare Turnstile")}
          </div>
        </div>

        {/* Form panel. */}
        <div className="flex-1 flex items-center justify-center bg-fog p-6 relative">
          {/* Theme switch — the login page has no app shell, so it needs its own
              control (otherwise the theme is locked to system/localStorage). */}
          <div className="absolute top-5 right-5 md:top-8 md:right-8">
            <ThemeToggle />
          </div>
          {mode === "setup" ? (
          <form
            onSubmit={submitSetup}
            className="w-full max-w-[400px] bg-paper border border-mist rounded-2xl p-8 space-y-6 shadow-[var(--shadow-card)]"
          >
            <div className="space-y-1">
              <span className="text-[12px] uppercase tracking-heading text-steel">
                {t("First-run setup")}
              </span>
              <h2 className="text-xl font-semibold text-ink">
                {t("Set a password for the administrator")}
              </h2>
            </div>

            <div className="space-y-1.5">
              <label className="text-[13px] text-graphite">
                {t("Default admin account")}
              </label>
              <input
                className="focus-ring w-full bg-fog border border-mist rounded-xl px-3 py-2.5 text-sm text-ink"
                value={setupUser}
                onChange={(e) => setSetupUser(e.target.value)}
                autoFocus
                autoComplete="username"
                readOnly
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-[13px] text-graphite">
                {t("New password")}
              </label>
              <input
                type="password"
                className="focus-ring w-full bg-paper border border-mist rounded-xl px-3 py-2.5 text-sm text-ink placeholder:text-steel"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                autoComplete="new-password"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-[13px] text-graphite">
                {t("Confirm password")}
              </label>
              <input
                type="password"
                className="focus-ring w-full bg-paper border border-mist rounded-xl px-3 py-2.5 text-sm text-ink placeholder:text-steel"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                autoComplete="new-password"
              />
            </div>

            {requiresTurnstile && cfg && (
              <div className="space-y-2">
                <span className="text-[13px] text-graphite">
                  {t("Complete the security check to continue")}
                </span>
                <TurnstileWidget
                  siteKey={cfg.turnstile_site_key}
                  action={cfg.turnstile_action}
                  onVerify={setTurnstileToken}
                  onError={failTurnstile}
                  resetSignal={resetSignal}
                />
              </div>
            )}

            {error && <div className="text-sm text-[color:var(--danger)]">{error}</div>}

            <button
              type="submit"
              disabled={!canSubmit}
              className="w-full bg-ember hover:bg-ember-600 text-[color:var(--on-ember)] py-2.5 rounded-xl text-sm font-semibold disabled:opacity-50 transition-colors"
            >
              {busy ? t("Signing in…") : configLoading ? t("Loading…") : t("Create password")}
            </button>
          </form>
        ) : (
          <form
            onSubmit={submitLogin}
            className="w-full max-w-[400px] bg-paper border border-mist rounded-2xl p-8 space-y-6 shadow-[var(--shadow-card)]"
          >
            {/* Compact brand mark for small screens (panel hidden there). */}
            <div className="flex md:hidden items-center gap-3 mb-2">
              <BrandMark size={36} />
              <span className="text-base font-semibold tracking-heading">
                {branding.site_name}
                {branding.slogan ? ` · ${branding.slogan}` : ""}
              </span>
            </div>

            <div className="space-y-1.5">
              <label className="text-[13px] text-graphite">用户名</label>
              <input
                className="focus-ring w-full bg-paper border border-mist rounded-xl px-3 py-2.5 text-sm text-ink placeholder:text-steel"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoFocus
                autoComplete="username"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-[13px] text-graphite">密码</label>
              <input
                type="password"
                className="focus-ring w-full bg-paper border border-mist rounded-xl px-3 py-2.5 text-sm text-ink placeholder:text-steel"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
              />
            </div>

            {requiresTurnstile && cfg && (
              <div className="space-y-2">
                <span className="text-[13px] text-graphite">
                  {t("Complete the security check to continue")}
                </span>
                <TurnstileWidget
                  siteKey={cfg.turnstile_site_key}
                  action={cfg.turnstile_action}
                  onVerify={setTurnstileToken}
                  onError={failTurnstile}
                  resetSignal={resetSignal}
                />
              </div>
            )}

            {error && <div className="text-sm text-[color:var(--danger)]">{error}</div>}

            <button
              type="submit"
              disabled={!canSubmit}
              className="w-full bg-ember hover:bg-ember-600 text-[color:var(--on-ember)] py-2.5 rounded-xl text-sm font-semibold disabled:opacity-50 transition-colors"
            >
              {busy
                ? t("Signing in…")
                : configLoading
                  ? t("Loading…")
                  : t("Sign in")}
            </button>
          </form>
        )}
        </div>
      </div>
      <SiteFooter />
    </div>
  );
}
