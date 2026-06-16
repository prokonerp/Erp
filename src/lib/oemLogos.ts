import apc from "@/assets/oem-apc.png.asset.json";
import eaton from "@/assets/oem-eaton.jpg.asset.json";
import exide from "@/assets/oem-exide.png.asset.json";
import luminous from "@/assets/oem-luminous.png.asset.json";
import quanta from "@/assets/oem-quanta.gif.asset.json";
import schneider from "@/assets/oem-schneider.jpg.asset.json";

// Map of normalised OEM brand name -> logo URL.
// Keys are lowercase; the resolver also matches partial words so variants
// like "APC by Schneider", "Schneider Electric", "Amaron Quanta" still hit.
const LOGOS: Array<{ keys: string[]; url: string; alt: string }> = [
  { keys: ["apc"], url: apc.url, alt: "APC" },
  { keys: ["schneider", "se "], url: schneider.url, alt: "Schneider Electric" },
  { keys: ["eaton"], url: eaton.url, alt: "Eaton" },
  { keys: ["exide"], url: exide.url, alt: "Exide" },
  { keys: ["luminous"], url: luminous.url, alt: "Luminous" },
  { keys: ["quanta", "amaron"], url: quanta.url, alt: "Amaron Quanta" },
];

export function getOemLogo(brand?: string | null): { url: string; alt: string } | null {
  if (!brand) return null;
  const b = brand.toLowerCase().trim();
  for (const l of LOGOS) {
    if (l.keys.some((k) => b.includes(k))) return { url: l.url, alt: l.alt };
  }
  return null;
}