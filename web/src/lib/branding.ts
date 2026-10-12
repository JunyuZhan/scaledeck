// Site branding, configured from the admin console (Settings → Branding) and
// persisted server-side. The login page needs it before any session exists, so
// it is fetched from the public endpoint GET /ui/api/branding. Every field is
// optional server-side; empty fields fall back to the defaults below (frontend)
// or to i18n copy (login page).

export interface Branding {
  site_name: string;
  slogan: string;
  login_headline: string;
  login_subtitle: string;
  logo_url: string; // remote logo URL (http/https)
  icp: string;
  gongan: string;
  footer_text: string;
  has_uploaded_logo: boolean; // read-only, computed server-side
}

// Mirrors the backend defaults (DefaultBranding). The built-in hexagonal mesh
// mark (components/Logo.tsx) is the fallback whenever no logo is configured.
export const BRANDING_DEFAULTS: Branding = {
  site_name: "ScaleDeck",
  slogan: "",
  login_headline: "",
  login_subtitle: "",
  logo_url: "",
  icp: "",
  gongan: "",
  footer_text: "",
  has_uploaded_logo: false,
};

// Route the backend serves uploaded logo files from.
export const UPLOADED_LOGO_URL = "/ui/api/branding/logo";

let cache: Branding | null = null;
let inflight: Promise<Branding> | null = null;

// fetchBranding loads the branding once and caches it for the page's lifetime.
// Pass force=true to bypass the cache (after an admin edit).
export async function fetchBranding(force = false): Promise<Branding> {
  if (cache && !force) return cache;
  if (!inflight || force) {
    inflight = (async () => {
      let result: Branding;
      try {
        const res = await fetch("/ui/api/branding", { credentials: "include" });
        if (!res.ok) throw new Error(`${res.status}`);
        const json = await res.json();
        result = { ...BRANDING_DEFAULTS, ...json };
      } catch {
        // Offline / backend not ready yet: keep defaults so the UI still renders.
        result = { ...BRANDING_DEFAULTS };
      } finally {
        inflight = null;
      }
      cache = result;
      return result;
    })();
  }
  return inflight;
}

// brandingCached returns the last-loaded branding (or defaults) synchronously.
export function brandingCached(): Branding {
  return cache ?? BRANDING_DEFAULTS;
}

// resolveLogo picks the effective logo URL: an uploaded file wins over a
// configured remote URL; "" means "use the built-in mark".
export function resolveLogo(b: Branding): string {
  if (b.has_uploaded_logo) return UPLOADED_LOGO_URL;
  return b.logo_url || "";
}

// applyDocumentBranding drives the document title and favicon from branding.
// Called once branding loads (and again after an admin edits it).
export function applyDocumentBranding(b: Branding): void {
  const name = b.site_name || BRANDING_DEFAULTS.site_name;
  document.title = b.slogan ? `${name} · ${b.slogan}` : name;
  const logo = resolveLogo(b);
  if (logo) {
    let link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
    if (!link) {
      link = document.createElement("link");
      link.rel = "icon";
      document.head.appendChild(link);
    }
    link.href = logo;
  }
}
