import Logo from "./Logo";
import { resolveLogo } from "../lib/branding";
import { useBranding } from "./BrandingProvider";

// The brand mark shown in the login page brand panel, the small-screen brand
// row and the sidebar. Uses the admin-configured logo (uploaded file or remote
// URL) when set, otherwise the built-in hexagonal mesh mark.
export default function BrandMark({ size = 40 }: { size?: number }) {
  const { branding } = useBranding();
  const logo = resolveLogo(branding);
  if (logo) {
    return (
      <img
        src={logo}
        alt={branding.site_name}
        width={size}
        height={size}
        className="rounded-[22%] object-cover shrink-0"
        style={{ width: size, height: size }}
      />
    );
  }
  return <Logo tile size={size} />;
}
