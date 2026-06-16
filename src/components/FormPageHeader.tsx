import prokonLogo from "@/assets/prokon-logo.jpeg.asset.json";
import { getOemLogo } from "@/lib/oemLogos";

/**
 * Standardised branded page header used across "New X" forms and Import
 * screens. Prokon logo is shown prominently on the left; OEM logo (when a
 * brand is provided) appears small on the right.
 */
export function FormPageHeader({
  title,
  subtitle,
  oemBrand,
}: {
  title: string;
  subtitle?: string;
  oemBrand?: string | null;
}) {
  const oem = getOemLogo(oemBrand);
  return (
    <div className="flex items-center justify-between gap-4 rounded-lg border bg-card px-4 py-3 shadow-sm">
      <div className="flex items-center gap-4 min-w-0">
        <img
          src={prokonLogo.url}
          alt="Prokon"
          className="h-14 w-auto object-contain shrink-0"
        />
        <div className="min-w-0">
          <h1 className="text-xl font-bold leading-tight truncate">{title}</h1>
          {subtitle ? (
            <p className="text-xs text-muted-foreground truncate">{subtitle}</p>
          ) : null}
        </div>
      </div>
      {oem ? (
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
            OEM
          </span>
          <img src={oem.url} alt={oem.alt} className="h-8 w-auto object-contain" />
        </div>
      ) : null}
    </div>
  );
}