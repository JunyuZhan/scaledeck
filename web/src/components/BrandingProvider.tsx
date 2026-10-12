import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import {
  BRANDING_DEFAULTS,
  applyDocumentBranding,
  fetchBranding,
  type Branding,
} from "../lib/branding";

interface BrandingContextValue {
  branding: Branding;
  // Re-fetch and re-apply document branding; call after an admin saves new
  // branding in Settings so every mounted component updates immediately.
  refresh: () => Promise<void>;
}

const BrandingContext = createContext<BrandingContextValue | null>(null);

export function BrandingProvider({ children }: { children: ReactNode }) {
  const [branding, setBranding] = useState<Branding>(BRANDING_DEFAULTS);

  useEffect(() => {
    let alive = true;
    fetchBranding().then((b) => {
      if (!alive) return;
      applyDocumentBranding(b);
      setBranding(b);
    });
    return () => {
      alive = false;
    };
  }, []);

  const refresh = useCallback(async () => {
    const b = await fetchBranding(true);
    applyDocumentBranding(b);
    setBranding(b);
  }, []);

  return (
    <BrandingContext.Provider value={{ branding, refresh }}>
      {children}
    </BrandingContext.Provider>
  );
}

export function useBranding(): BrandingContextValue {
  const ctx = useContext(BrandingContext);
  if (!ctx) {
    // Used outside the provider: degrade to defaults.
    return { branding: BRANDING_DEFAULTS, refresh: async () => {} };
  }
  return ctx;
}
