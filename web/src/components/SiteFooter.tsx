import { useI18n } from "../i18n";
import { useBranding } from "./BrandingProvider";

// Site footer: optional free-form footer text, ICP filing number (links to the
// MIIT record query) and public-security filing number, plus a credit line.
// ICP / gongan are hidden automatically when left blank in the console.
export default function SiteFooter() {
  const { t } = useI18n();
  const { branding } = useBranding();

  return (
    <footer className="shrink-0 border-t border-mist px-6 py-3 text-[11px] text-steel">
      <div className="max-w-[1200px] mx-auto flex flex-wrap items-center justify-center gap-x-4 gap-y-1">
        {branding.footer_text && <span>{branding.footer_text}</span>}
        {branding.icp && (
          <a
            href="https://beian.miit.gov.cn/"
            target="_blank"
            rel="noreferrer noopener"
            className="hover:text-graphite transition-colors"
          >
            {branding.icp}
          </a>
        )}
        {branding.gongan && (
          <a
            href="https://beian.gov.cn/"
            target="_blank"
            rel="noreferrer noopener"
            className="hover:text-graphite transition-colors"
          >
            {branding.gongan}
          </a>
        )}
        <span>
          {t("Powered by")} {branding.site_name || "ScaleDeck"}
        </span>
      </div>
    </footer>
  );
}
