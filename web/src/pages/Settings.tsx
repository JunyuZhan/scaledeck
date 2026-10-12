import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  admin,
  type MailSettings,
  type MailSettingsResp,
} from "../api/client";
import { useI18n } from "../i18n";
import { resolveLogo, type Branding } from "../lib/branding";

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="text-sm text-graphite">{label}</span>
      {hint && <span className="ml-2 text-xs text-steel">{hint}</span>}
      <div className="mt-1">{children}</div>
    </label>
  );
}

type Tab = "mail" | "branding";

const inputCls =
  "focus-ring w-full bg-paper border border-mist rounded-xl p-2 text-sm text-ink placeholder:text-steel";

export default function Settings() {
  const { t } = useI18n();
  const [tab, setTab] = useState<Tab>("mail");

  // ---- Mail settings state ----
  const [m, setM] = useState<MailSettings>({
    enabled: true,
    smtp_host: "",
    smtp_port: "587",
    smtp_username: "resend",
    smtp_password: "",
    smtp_from: "noreply@sclink.dev",
    smtp_tls: "starttls",
    resend_api_key: "",
    resend_from: "Headscale <no-reply@sclink.dev>",
    resend_notify_to: "",
  });
  const [mailMsg, setMailMsg] = useState("");
  const [mailErr, setMailErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [testTo, setTestTo] = useState("");
  const [testMsg, setTestMsg] = useState("");

  useEffect(() => {
    admin
      .mailSettings()
      .then((r: MailSettingsResp) => setM(r.mail))
      .catch((e) => setMailErr((e as Error).message));
  }, []);

  const setMail = (k: keyof MailSettings, v: string | boolean) =>
    setM((p) => ({ ...p, [k]: v }));

  const saveMail = async (e: FormEvent) => {
    e.preventDefault();
    setMailErr("");
    setMailMsg("");
    setBusy(true);
    try {
      const r = await admin.saveMailSettings(m);
      setM(r.mail);
      setMailMsg(t("Saved"));
    } catch (e) {
      setMailErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const testMail = async () => {
    setTestMsg("");
    setMailErr("");
    if (!testTo) {
      setMailErr(t("Test recipient required"));
      return;
    }
    setBusy(true);
    try {
      const r = await admin.testMail(testTo);
      setTestMsg(r.ok ? t("Test email sent") : r.error ?? "failed");
    } catch (e) {
      setTestMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  // ---- Branding state ----
  const [b, setB] = useState<Branding>({
    site_name: "ScaleDeck",
    slogan: "",
    login_headline: "",
    login_subtitle: "",
    logo_url: "",
    icp: "",
    gongan: "",
    footer_text: "",
    has_uploaded_logo: false,
  });
  const [brandMsg, setBrandMsg] = useState("");
  const [brandErr, setBrandErr] = useState("");
  const [brandBusy, setBrandBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const loadBranding = () => {
    admin
      .branding()
      .then((r) => setB(r))
      .catch((e) => setBrandErr((e as Error).message));
  };
  useEffect(() => {
    if (tab === "branding") loadBranding();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  const setBrand = (k: keyof Branding, v: string | boolean) =>
    setB((p) => ({ ...p, [k]: v }));

  const saveBranding = async (e: FormEvent) => {
    e.preventDefault();
    setBrandErr("");
    setBrandMsg("");
    setBrandBusy(true);
    try {
      const r = await admin.saveBranding(b);
      setB(r);
      setBrandMsg(t("Saved"));
    } catch (e) {
      setBrandErr((e as Error).message);
    } finally {
      setBrandBusy(false);
    }
  };

  const onLogoPick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) await uploadLogo(file);
    e.target.value = "";
  };

  const uploadLogo = async (file: File) => {
    setBrandErr("");
    setBrandMsg("");
    setUploading(true);
    try {
      const r = await admin.uploadBrandingLogo(file);
      setB(r);
      setBrandMsg(t("Logo uploaded"));
    } catch (e) {
      setBrandErr((e as Error).message);
    } finally {
      setUploading(false);
    }
  };

  const removeLogo = async () => {
    setBrandErr("");
    setBrandMsg("");
    setBrandBusy(true);
    try {
      const r = await admin.deleteBrandingLogo();
      setB(r);
      setBrandMsg(t("Logo removed"));
    } catch (e) {
      setBrandErr((e as Error).message);
    } finally {
      setBrandBusy(false);
    }
  };

  const logoPreview = resolveLogo(b);

  return (
    <div className="max-w-3xl">
      <h1 className="text-[28px] leading-[1.3] tracking-heading font-semibold text-ink mb-1">
        {t("Settings")}
      </h1>

      {/* Tab switcher */}
      <div className="flex gap-1 mt-4 mb-6 border-b border-mist">
        <button
          onClick={() => setTab("mail")}
          className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
            tab === "mail"
              ? "border-ember text-ink"
              : "border-transparent text-graphite hover:text-ink"
          }`}
        >
          {t("Mail settings")}
        </button>
        <button
          onClick={() => setTab("branding")}
          className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
            tab === "branding"
              ? "border-ember text-ink"
              : "border-transparent text-graphite hover:text-ink"
          }`}
        >
          {t("Branding")}
        </button>
      </div>

      {tab === "mail" ? (
        <>
          {mailErr && (
            <div className="text-[color:var(--danger)] mb-4 text-sm">{mailErr}</div>
          )}
          {mailMsg && (
            <div className="text-live mb-4 text-sm">{mailMsg}</div>
          )}

          <form onSubmit={saveMail} className="space-y-6">
            <div className="card p-5">
              <label className="flex items-center justify-between">
                <span className="text-sm text-ink">{t("Enable email alerts")}</span>
                <input
                  type="checkbox"
                  checked={m.enabled}
                  onChange={(e) => setMail("enabled", e.target.checked)}
                  className="w-5 h-5 accent-ember"
                />
              </label>
              <p className="text-xs text-steel mt-2">
                关闭后将不再发送告警邮件（节点入网 / 掉线 / 密钥过期），但相关事件仍会记入活动日志。
              </p>
            </div>

            <div className="card p-5 space-y-4">
              <h2 className="text-base font-medium text-ink">
                {t("SMTP configuration")}
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Field label={t("SMTP host")}>
                  <input
                    className={inputCls}
                    value={m.smtp_host}
                    placeholder="smtp.resend.com"
                    onChange={(e) => setMail("smtp_host", e.target.value)}
                  />
                </Field>
                <Field label={t("SMTP port")}>
                  <input
                    className={inputCls}
                    value={m.smtp_port}
                    placeholder="587"
                    onChange={(e) => setMail("smtp_port", e.target.value)}
                  />
                </Field>
                <Field label={t("SMTP username")}>
                  <input
                    className={inputCls}
                    value={m.smtp_username}
                    placeholder="resend"
                    onChange={(e) => setMail("smtp_username", e.target.value)}
                  />
                </Field>
                <Field label={t("Encryption")}>
                  <select
                    className={inputCls}
                    value={m.smtp_tls}
                    onChange={(e) => setMail("smtp_tls", e.target.value)}
                  >
                    <option value="starttls">{t("STARTTLS (587)")}</option>
                    <option value="ssl">{t("Implicit TLS (465)")}</option>
                  </select>
                </Field>
                <Field label={t("SMTP password")} hint={t("Leave blank to keep unchanged")}>
                  <input
                    type="password"
                    className={inputCls}
                    value={m.smtp_password}
                    placeholder="••••••••"
                    autoComplete="new-password"
                    onChange={(e) => setMail("smtp_password", e.target.value)}
                  />
                </Field>
                <Field label={t("From address")}>
                  <input
                    className={inputCls}
                    value={m.smtp_from}
                    placeholder="noreply@sclink.dev"
                    onChange={(e) => setMail("smtp_from", e.target.value)}
                  />
                </Field>
              </div>
              <p className="text-xs text-steel">
                Resend SMTP：用户名固定为 <code className="text-graphite">resend</code>，
                密码即你的 Resend API Key；发件域名需在 Resend 中已验证。
              </p>
            </div>

            <div className="card p-5 space-y-4">
              <h2 className="text-base font-medium text-ink">
                {t("Resend API key")}（备用）
              </h2>
              <p className="text-xs text-steel">
                若不使用 SMTP，可填 Resend REST API 密钥作为回退；两者都留空则不发信。
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Field label={t("Resend API key")} hint={t("Leave blank to keep unchanged")}>
                  <input
                    type="password"
                    className={inputCls}
                    value={m.resend_api_key}
                    placeholder="re_••••••••"
                    autoComplete="new-password"
                    onChange={(e) => setMail("resend_api_key", e.target.value)}
                  />
                </Field>
                <Field label={t("Resend from")}>
                  <input
                    className={inputCls}
                    value={m.resend_from}
                    placeholder="Headscale <no-reply@sclink.dev>"
                    onChange={(e) => setMail("resend_from", e.target.value)}
                  />
                </Field>
              </div>
            </div>

            <div className="card p-5 space-y-4">
              <h2 className="text-base font-medium text-ink">
                {t("Alert recipients")}
              </h2>
              <Field label={t("Alert recipients")} hint={t("comma-separated emails")}>
                <input
                  className={inputCls}
                  value={m.resend_notify_to}
                  placeholder="ops@example.com, admin@example.com"
                  onChange={(e) => setMail("resend_notify_to", e.target.value)}
                />
              </Field>
              <p className="text-xs text-steel">
                留空时，系统会向「用户」页面中标记为管理员的邮箱发送告警。
              </p>
            </div>

            <div className="card p-5 space-y-3">
              <h2 className="text-base font-medium text-ink">发送测试邮件</h2>
              <div className="flex flex-col sm:flex-row gap-3">
                <input
                  className={inputCls}
                  value={testTo}
                  placeholder={t("Test recipient")}
                  onChange={(e) => setTestTo(e.target.value)}
                />
                <button
                  type="button"
                  onClick={testMail}
                  disabled={busy}
                  className="shrink-0 bg-fog text-ink hover:bg-mist py-2 px-4 rounded-xl text-sm font-medium disabled:opacity-50 transition-colors"
                >
                  {busy ? t("Loading…") : t("Send test email")}
                </button>
              </div>
              {testMsg && (
                <div className="text-sm text-graphite">{testMsg}</div>
              )}
            </div>

            <button
              type="submit"
              disabled={busy}
              className="w-full bg-ember hover:bg-ember-600 text-[color:var(--on-ember)] py-2.5 rounded-xl text-sm font-medium disabled:opacity-50 transition-colors"
            >
              {busy ? t("Loading…") : t("Save")}
            </button>
          </form>
        </>
      ) : (
        <>
          {brandErr && (
            <div className="text-[color:var(--danger)] mb-4 text-sm">{brandErr}</div>
          )}
          {brandMsg && (
            <div className="text-live mb-4 text-sm">{brandMsg}</div>
          )}

          <form onSubmit={saveBranding} className="space-y-6">
            <div className="card p-5 space-y-4">
              <h2 className="text-base font-medium text-ink">{t("Branding")}</h2>
              <Field
                label={t("Site name")}
                hint={t("Shown in the browser tab title and on the login page")}
              >
                <input
                  className={inputCls}
                  value={b.site_name}
                  onChange={(e) => setBrand("site_name", e.target.value)}
                />
              </Field>
              <Field label={t("Slogan")} hint={t("Shown under the site name")}>
                <input
                  className={inputCls}
                  value={b.slogan}
                  placeholder={t("Leave blank to use built-in copy")}
                  onChange={(e) => setBrand("slogan", e.target.value)}
                />
              </Field>
              <Field label={t("Login page headline")}>
                <input
                  className={inputCls}
                  value={b.login_headline}
                  placeholder={t("Leave blank to use built-in copy")}
                  onChange={(e) => setBrand("login_headline", e.target.value)}
                />
              </Field>
              <Field label={t("Login page subtitle")}>
                <input
                  className={inputCls}
                  value={b.login_subtitle}
                  placeholder={t("Leave blank to use built-in copy")}
                  onChange={(e) => setBrand("login_subtitle", e.target.value)}
                />
              </Field>
            </div>

            <div className="card p-5 space-y-4">
              <h2 className="text-base font-medium text-ink">{t("Logo")}</h2>
              <div className="flex items-center gap-4">
                <div className="w-16 h-16 rounded-xl bg-fog border border-mist flex items-center justify-center overflow-hidden shrink-0">
                  {logoPreview ? (
                    <img
                      src={logoPreview}
                      alt={b.site_name}
                      className="w-full h-full object-contain"
                    />
                  ) : (
                    <span className="text-[11px] text-steel text-center px-1">
                      {t("Built-in mark in use")}
                    </span>
                  )}
                </div>
                <div className="space-y-2">
                  <input
                    ref={fileRef}
                    type="file"
                    accept=".png,.jpg,.jpeg,.webp,.ico"
                    onChange={onLogoPick}
                    className="hidden"
                  />
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => fileRef.current?.click()}
                      disabled={uploading}
                      className="bg-fog text-ink hover:bg-mist py-2 px-4 rounded-xl text-sm font-medium disabled:opacity-50 transition-colors"
                    >
                      {uploading ? t("Loading…") : t("Upload logo")}
                    </button>
                    {b.has_uploaded_logo && (
                      <button
                        type="button"
                        onClick={removeLogo}
                        disabled={brandBusy}
                        className="bg-fog text-ink hover:bg-mist py-2 px-4 rounded-xl text-sm font-medium disabled:opacity-50 transition-colors"
                      >
                        {t("Remove logo")}
                      </button>
                    )}
                  </div>
                  <p className="text-xs text-steel max-w-sm">
                    {t(
                      "PNG, JPEG, WebP or ICO, up to 1 MiB. An uploaded logo takes precedence over the URL.",
                    )}
                  </p>
                </div>
              </div>
              <Field label={t("Logo URL")} hint={t("Remote logo address (http/https)")}>
                <input
                  className={inputCls}
                  value={b.logo_url}
                  placeholder="https://…"
                  onChange={(e) => setBrand("logo_url", e.target.value)}
                />
              </Field>
            </div>

            <div className="card p-5 space-y-4">
              <h2 className="text-base font-medium text-ink">备案信息</h2>
              <Field label={t("ICP filing number")} hint={t("Example: 京ICP备12345678号-1")}>
                <input
                  className={inputCls}
                  value={b.icp}
                  placeholder={t("Leave blank to hide")}
                  onChange={(e) => setBrand("icp", e.target.value)}
                />
              </Field>
              <Field label={t("Public security filing number")}>
                <input
                  className={inputCls}
                  value={b.gongan}
                  placeholder={t("Leave blank to hide")}
                  onChange={(e) => setBrand("gongan", e.target.value)}
                />
              </Field>
              <Field label={t("Footer text")}>
                <input
                  className={inputCls}
                  value={b.footer_text}
                  placeholder={t("Leave blank to hide")}
                  onChange={(e) => setBrand("footer_text", e.target.value)}
                />
              </Field>
            </div>

            <button
              type="submit"
              disabled={brandBusy}
              className="w-full bg-ember hover:bg-ember-600 text-[color:var(--on-ember)] py-2.5 rounded-xl text-sm font-medium disabled:opacity-50 transition-colors"
            >
              {brandBusy ? t("Loading…") : t("Save")}
            </button>
          </form>
        </>
      )}
    </div>
  );
}
