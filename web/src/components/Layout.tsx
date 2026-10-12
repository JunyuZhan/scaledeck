import { useState, type FormEvent, type ReactNode } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { auth, self, type Me } from "../api/client";
import { useI18n, type Lang } from "../i18n";
import Notifications from "./Notifications";
import ThemeToggle from "./ThemeToggle";
import BrandMark from "./BrandMark";
import SiteFooter from "./SiteFooter";
import { useBranding } from "./BrandingProvider";

const baseNav = [
  { to: "/", key: "Overview", end: true, icon: "overview" },
  { to: "/nodes", key: "Nodes", end: false, icon: "nodes" },
  { to: "/myself", key: "My devices", end: false, icon: "devices" },
];

const adminNav = [
  { to: "/users", key: "Users", end: false, icon: "users" },
  { to: "/accounts", key: "Console accounts", end: false, icon: "accounts" },
  { to: "/keys", key: "Pre-auth keys", end: false, icon: "keys" },
  { to: "/policy", key: "ACL Policy", end: false, icon: "policy" },
  { to: "/events", key: "Activity log", end: false, icon: "events" },
  { to: "/settings", key: "Settings", end: false, icon: "mail" },
];

function Icon({ name, className = "w-5 h-5" }: { name: string; className?: string }) {
  const paths: Record<string, ReactNode> = {
    overview: <path d="M3 3h7v7H3zM14 3h7v4h-7zM14 10h7v11h-7zM3 13h7v8H3z" />,
    nodes: (
      <>
        <rect x="3" y="4" width="18" height="5" rx="1.5" />
        <rect x="3" y="13" width="18" height="7" rx="1.5" />
        <path d="M7 6.5h.01M7 16.5h.01" />
      </>
    ),
    devices: (
      <>
        <rect x="3" y="5" width="13" height="9" rx="1.5" />
        <path d="M16 9h3v7h-3zM3 20h11" />
      </>
    ),
    users: (
      <>
        <circle cx="9" cy="8" r="3" />
        <path d="M3 20v-1a4 4 0 014-4h4a4 4 0 014 4v1" />
        <path d="M16 11a3 3 0 100-6M21 20v-1a4 4 0 00-3-3.87" />
      </>
    ),
    keys: (
      <>
        <circle cx="8" cy="8" r="4" />
        <path d="M11 11l9 9M17 17l2-2M14 14l2 2" />
      </>
    ),
    policy: (
      <>
        <path d="M12 3l8 3v5c0 5-3.5 8-8 10-4.5-2-8-5-8-10V6z" />
        <path d="M9 12l2 2 4-4" />
      </>
    ),
    accounts: (
      <>
        <path d="M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <path d="M19 8v6M22 11h-6" />
      </>
    ),
    events: (
      <>
        <path d="M3 12h4l2 6 4-14 2 8h6" />
      </>
    ),
    mail: (
      <>
        <rect x="3" y="5" width="18" height="14" rx="2" />
        <path d="M3 7l9 6 9-6" />
      </>
    ),
    logout: (
      <path d="M16 17l5-5-5-5M21 12H9M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4" />
    ),
    lock: (
      <>
        <rect x="4" y="10" width="16" height="11" rx="2" />
        <path d="M8 10V7a4 4 0 118 0v3" />
      </>
    ),
    globe: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M3 12h18M12 3a15 15 0 010 18M12 3a15 15 0 000 18" />
      </>
    ),
  };
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name] ?? null}
    </svg>
  );
}

function NavGroup({
  label,
  items,
  t,
}: {
  label: string;
  items: { to: string; key: string; end: boolean; icon: string }[];
  t: (s: string) => string;
}) {
  return (
    <div className="mb-5">
      <div className="px-3 mb-2 text-[11px] uppercase tracking-[0.08em] text-steel font-medium">
        {label}
      </div>
      <nav className="space-y-0.5">
        {items.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2 rounded-xl text-sm transition-colors border-l-2 ${
                isActive
                  ? "bg-fog text-ink font-medium border-ember"
                  : "text-graphite hover:bg-fog hover:text-ink border-transparent"
              }`
            }
          >
            <Icon name={item.icon} className="w-[18px] h-[18px]" />
            <span>{t(item.key)}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  );
}

export default function Layout({
  me,
  onLogout,
}: {
  me: Me;
  onLogout: () => void;
}) {
  const navigate = useNavigate();
  const { t, lang, setLang } = useI18n();
  const { branding } = useBranding();
  const isAdmin = me.role === "admin";
  const initials = (me.username || "?").slice(0, 2).toUpperCase();

  const logout = async () => {
    try {
      await auth.logout();
    } catch {
      /* ignore */
    }
    onLogout();
    navigate("/login");
  };

  const [pwOpen, setPwOpen] = useState(false);
  const [pwOld, setPwOld] = useState("");
  const [pwNew, setPwNew] = useState("");
  const [pwConfirm, setPwConfirm] = useState("");
  const [pwError, setPwError] = useState("");
  const [pwMsg, setPwMsg] = useState("");
  const [pwBusy, setPwBusy] = useState(false);
  const [langOpen, setLangOpen] = useState(false);

  const LANG_FULL: Record<Lang, string> = {
    "zh-Hans": "简体中文",
    "zh-Hant": "繁體中文",
    en: "English",
  };
  const LANG_SHORT: Record<Lang, string> = {
    "zh-Hans": "简",
    "zh-Hant": "繁",
    en: "EN",
  };

  const changePassword = async (e: FormEvent) => {
    e.preventDefault();
    setPwError("");
    setPwMsg("");
    if (pwNew.length < 6) {
      setPwError(`${t("New password")} ≥ 6`);
      return;
    }
    if (pwNew !== pwConfirm) {
      setPwError(t("Confirm password") + " ⚠");
      return;
    }
    setPwBusy(true);
    try {
      await self.changePassword(pwOld, pwNew);
      setPwMsg(t("Password changed"));
      setPwOld("");
      setPwNew("");
      setPwConfirm("");
      setTimeout(() => setPwOpen(false), 1200);
    } catch (e) {
      setPwError((e as Error).message);
    } finally {
      setPwBusy(false);
    }
  };

  return (
    <div className="flex h-full bg-paper">
      <aside className="w-64 shrink-0 bg-paper border-r border-mist flex flex-col">
        <div className="px-5 pt-6 pb-5">
          <div className="flex items-center gap-3">
            <BrandMark size={40} />
            <div>
              <div className="text-ink font-semibold leading-tight">
                {branding.site_name}
              </div>
              <div className="text-[11px] text-steel">
                {branding.slogan || "自建 VPN 控制台"}
              </div>
            </div>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-3 pb-3">
          <NavGroup label={t("Workspace")} items={baseNav} t={t} />
          {isAdmin && (
            <NavGroup label={t("Administration")} items={adminNav} t={t} />
          )}
        </div>

        <div className="border-t border-mist p-3">
          <div className="flex items-center gap-3 px-1 mb-2">
            <div className="w-9 h-9 rounded-full bg-fog border border-mist flex items-center justify-center text-sm font-medium text-ink">
              {initials}
            </div>
            <div className="min-w-0">
              <div className="text-sm text-ink truncate">{me.username}</div>
              <div className="text-[11px] text-steel">
                {t(me.role)}
                {me.role === "user" && me.headscale_user
                  ? ` · ${me.headscale_user}`
                  : ""}
              </div>
            </div>
          </div>
          <button
            className="w-full flex items-center gap-2 px-3 py-2 rounded-xl text-sm text-graphite hover:bg-fog hover:text-ink transition-colors"
            onClick={() => setPwOpen(true)}
          >
            <Icon name="lock" className="w-4 h-4" />
            {t("Change password")}
          </button>
          <button
            className="w-full flex items-center gap-2 px-3 py-2 rounded-xl text-sm text-graphite hover:bg-fog hover:text-ink transition-colors"
            onClick={logout}
          >
            <Icon name="logout" className="w-4 h-4" />
            {t("Log out")}
          </button>
        </div>
      </aside>

      {pwOpen && (
        <div
          className="fixed inset-0 bg-[color:var(--overlay)] backdrop-blur-sm flex items-center justify-center z-50"
          onClick={() => setPwOpen(false)}
        >
          <div
            className="bg-paper border border-mist rounded-xl p-5 w-80 space-y-3 shadow-[var(--shadow-modal)]"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-base font-semibold text-ink">
              {t("Change password")}
            </h3>
            {pwError && <div className="text-sm text-[color:var(--danger)]">{pwError}</div>}
            {pwMsg && <div className="text-sm text-live">{pwMsg}</div>}
            <form onSubmit={changePassword} className="space-y-2">
              <input
                type="password"
                value={pwOld}
                onChange={(e) => setPwOld(e.target.value)}
                placeholder={t("Old password")}
                className="focus-ring w-full bg-paper border border-mist rounded-xl p-2 text-sm text-ink placeholder:text-steel"
              />
              <input
                type="password"
                value={pwNew}
                onChange={(e) => setPwNew(e.target.value)}
                placeholder={t("New password")}
                className="focus-ring w-full bg-paper border border-mist rounded-xl p-2 text-sm text-ink placeholder:text-steel"
              />
              <input
                type="password"
                value={pwConfirm}
                onChange={(e) => setPwConfirm(e.target.value)}
                placeholder={t("Confirm password")}
                className="focus-ring w-full bg-paper border border-mist rounded-xl p-2 text-sm text-ink placeholder:text-steel"
              />
              <button
                type="submit"
                disabled={pwBusy}
                className="w-full bg-ember hover:bg-ember-600 text-[color:var(--on-ember)] py-2 rounded-xl text-sm font-semibold disabled:opacity-50 transition-colors"
              >
                {pwBusy ? t("Loading…") : t("Change password")}
              </button>
            </form>
          </div>
        </div>
      )}

      <main className="flex-1 min-w-0 flex flex-col overflow-hidden">
        <div className="shrink-0 bg-[color:var(--header-bg)] backdrop-blur border-b border-mist px-8 py-3 flex items-center justify-between">
          <div className="text-[13px] text-graphite">
            {t(me.role === "admin" ? "Administration" : "Workspace")}
          </div>
          <div className="flex items-center gap-2">
            <Notifications isAdmin={isAdmin} />
            <ThemeToggle />
            <div className="relative">
              <button
                onClick={() => setLangOpen((o) => !o)}
                className="flex items-center gap-1.5 text-xs text-graphite border border-mist rounded-xl px-2.5 py-1.5 hover:bg-fog hover:text-ink transition-colors"
                title="语言 / Language"
              >
                <Icon name="globe" className="w-4 h-4" />
                {LANG_SHORT[lang]}
              </button>
              {langOpen && (
                <>
                  <div
                    className="fixed inset-0 z-40"
                    onClick={() => setLangOpen(false)}
                  />
                  <div className="absolute right-0 top-full mt-1 w-36 bg-paper border border-mist rounded-xl overflow-hidden z-50">
                    {(["zh-Hans", "zh-Hant", "en"] as Lang[]).map((l) => (
                      <button
                        key={l}
                        onClick={() => {
                          setLang(l);
                          setLangOpen(false);
                        }}
                        className={`w-full text-left px-3 py-2 text-xs transition-colors hover:bg-fog ${
                          l === lang
                            ? "text-[color:var(--ember-text)] font-semibold"
                            : "text-ink"
                        }`}
                      >
                        {LANG_FULL[l]}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
        <div className="flex-1 overflow-auto">
          <div className="max-w-[1200px] mx-auto px-8 py-8">
            <Outlet context={me} />
          </div>
        </div>
        <SiteFooter />
      </main>
    </div>
  );
}
