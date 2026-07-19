import { supabase } from "@/integrations/supabase/client";

export type OemLogo = {
  id: string;
  oem_name: string;
  logo_path: string;
  position: "left" | "center" | "right";
  size: "small" | "medium" | "large";
  is_active: boolean;
  sort_order: number;
  created_at?: string;
  updated_at?: string;
};

export type OemLogoWithUrl = OemLogo & { url: string };

export const OEM_BUCKET = "oem-logos";

export const SIZE_PX: Record<OemLogo["size"], number> = {
  small: 28,
  medium: 44,
  large: 64,
};

export async function listOemLogos(activeOnly = false): Promise<OemLogo[]> {
  let q = supabase.from("oem_logos").select("*").order("sort_order", { ascending: true });
  if (activeOnly) q = q.eq("is_active", true);
  const { data, error } = await q;
  if (error) throw error;
  return (data || []) as unknown as OemLogo[];
}

export async function signLogoUrl(path: string): Promise<string | null> {
  const { data } = await supabase.storage.from(OEM_BUCKET).createSignedUrl(path, 60 * 60 * 24 * 7);
  return data?.signedUrl || null;
}

export async function withSignedUrls(rows: OemLogo[]): Promise<OemLogoWithUrl[]> {
  const out: OemLogoWithUrl[] = [];
  for (const r of rows) {
    const url = await signLogoUrl(r.logo_path);
    if (url) out.push({ ...r, url });
  }
  return out;
}

export async function uploadLogoFile(file: File): Promise<string> {
  if (!/^image\/(png|jpe?g)$/i.test(file.type)) throw new Error("Only PNG or JPG images are allowed");
  if (file.size > 2 * 1024 * 1024) throw new Error("Max file size is 2 MB");
  const ext = (file.name.split(".").pop() || "png").toLowerCase();
  const path = `${crypto.randomUUID()}.${ext}`;
  const { error } = await supabase.storage.from(OEM_BUCKET).upload(path, file, {
    contentType: file.type,
    cacheControl: "3600",
    upsert: false,
  });
  if (error) throw error;
  return path;
}

export async function deleteLogoFile(path: string) {
  await supabase.storage.from(OEM_BUCKET).remove([path]);
}

/** Filter logos to those whose oem_name appears in any item description/product name. */
export function filterLogosForItems<T extends { oem_name: string }>(
  logos: T[],
  items: Array<{ description?: string; product_name?: string }>,
): T[] {
  const hay = items
    .map((it) => `${it.description || ""} ${it.product_name || ""}`.toLowerCase())
    .join(" | ");
  if (!hay.trim()) return [];
  return logos.filter((l) => hay.includes(l.oem_name.toLowerCase().trim()));
}