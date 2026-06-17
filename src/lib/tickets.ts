import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

export const CALL_TYPES = [
  "OOW",
  "Installation",
  "Warranty",
  "AMC",
  "PM Call",
  "New Sale Delivery",
  "CCTV",
] as const;

export const TICKET_STATUSES = [
  "New",
  "Call Log",
  "In Progress",
  "Under Observation",
  "Waiting for Parts",
  "Parts Received",
  "Cancelled",
  "Closed",
] as const;

export type CallType = string;

export const PRIORITIES = ["P1", "P2", "P3", "P4", "P5"] as const;
export type Priority = (typeof PRIORITIES)[number];

export const PRIORITY_COLOR: Record<string, string> = {
  P1: "bg-red-100 text-red-800",
  P2: "bg-orange-100 text-orange-800",
  P3: "bg-amber-100 text-amber-800",
  P4: "bg-blue-100 text-blue-800",
  P5: "bg-zinc-100 text-zinc-700",
};

/** Hours elapsed between two dates, EXCLUDING any time that falls on Sunday (local). */
export function hoursExcludingSundays(fromISO: string, to: Date = new Date()): number {
  const from = new Date(fromISO);
  if (isNaN(from.getTime()) || to <= from) return 0;
  let total = 0;
  // Walk segment-by-segment between day boundaries so we can skip Sundays entirely.
  let cursor = new Date(from);
  while (cursor < to) {
    const next = new Date(cursor);
    next.setHours(24, 0, 0, 0); // start of next day (local)
    const segEnd = next < to ? next : to;
    if (cursor.getDay() !== 0) {
      total += (segEnd.getTime() - cursor.getTime()) / 3_600_000;
    }
    cursor = segEnd;
  }
  return total;
}

export function timerBadgeColor(hours: number): string {
  if (hours > 24) return "bg-red-100 text-red-800 border-red-200";
  if (hours > 8) return "bg-amber-100 text-amber-800 border-amber-200";
  return "bg-green-100 text-green-800 border-green-200";
}

export function formatHours(hours: number): string {
  if (hours < 1) return `${Math.max(0, Math.round(hours * 60))}m`;
  if (hours < 100) return `${hours.toFixed(1)}h`;
  return `${Math.round(hours)}h`;
}

export type TicketStatus = (typeof TICKET_STATUSES)[number];

export type PartLine = {
  name: string;
  qty: string;
  model_no?: string;
  serial?: string;
  remarks?: string;
  confirmed?: boolean;
  confirmed_by?: string | null;
  confirmed_at?: string | null;
};

export const STATUS_COLOR: Record<string, string> = {
  New: "bg-blue-100 text-blue-800",
  "Call Log": "bg-indigo-100 text-indigo-800",
  "In Progress": "bg-amber-100 text-amber-800",
  "Under Observation": "bg-purple-100 text-purple-800",
  "Waiting for Parts": "bg-orange-100 text-orange-800",
  "Parts Received": "bg-teal-100 text-teal-800",
  Cancelled: "bg-zinc-200 text-zinc-700",
  Closed: "bg-green-100 text-green-800",
};

/** Normalise phone to international digits (defaults to India 91). Returns "" if invalid. */
export function waPhone(phone: string | null | undefined): string {
  const digits = (phone || "").replace(/\D/g, "");
  if (!digits) return "";
  if (digits.length === 10) return `91${digits}`;
  // assume already includes country code if >=11 digits
  return digits.length >= 11 ? digits : "";
}

function isMobileDevice(): boolean {
  if (typeof navigator === "undefined") return false;
  return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
}

export type WaLaunchContext = {
  module?: "ticket" | "amc" | "crm" | string;
  recordId?: string | null;
  recordNumber?: string | null;
  recipientLabel?: string | null;
};

export type WaOpenOptions = WaLaunchContext & {
  preferWeb?: boolean;
};

/** WhatsApp launch URL. Always uses WhatsApp Web direct navigation; never embed this URL. */
export function waLink(phone: string | null | undefined, text: string): string {
  const p = waPhone(phone);
  const t = encodeURIComponent(text);
  if (!p) return `https://web.whatsapp.com/send?text=${t}`;
  return `https://web.whatsapp.com/send?phone=${p}&text=${t}`;
}

/** Click handler: copy message to clipboard, then open WhatsApp in a new browser tab.
 *  Uses WhatsApp Web with target=_blank so WhatsApp is never embedded
 *  inside an iframe/modal (which browsers block with ERR_BLOCKED_BY_RESPONSE).
 *  Returns true if the phone is valid and a launch was attempted, false if the
 *  number is missing/invalid. If the browser blocks the popup, a fallback toast
 *  is shown automatically. */
export async function waOpen(
  phone: string | null | undefined,
  text: string,
  options: WaOpenOptions = {},
): Promise<boolean> {
  const p = waPhone(phone);
  if (!p) return false;
  ensureWhatsAppDebugListeners();
  observeWhatsAppEmbedsForDebug();
  const url = `https://web.whatsapp.com/send?phone=${p}&text=${encodeURIComponent(text)}`;
  const embedDiagnostics = getWhatsAppEmbedDiagnostics();
  let w: Window | null = null;
  let failureReason: string | null = null;
  let browserAction = "window.open(_blank)";
  let anchorFallbackAttempted = false;
  console.info("WhatsApp launch requested", {
    module: options.module || "general",
    recordNumber: options.recordNumber ?? null,
    recipientMobile: p,
    generatedUrl: url,
    browserAction,
    iframeBeingCreated: false,
    modalBeingOpened: false,
    drawerBeingOpened: false,
    existingWhatsAppIframes: embedDiagnostics.whatsAppIframeCount,
    existingWhatsAppDialogs: embedDiagnostics.whatsAppDialogCount,
    timestamp: new Date().toISOString(),
  });
  try {
    // Open synchronously before clipboard/logging awaits so popup blockers and
    // app iframe sandboxes treat this as direct browser navigation, not embed.
    w = window.open(url, "_blank");
    if (w) w.opener = null;
  } catch (error) {
    failureReason = error instanceof Error ? error.message : "window.open failed";
  }
  if (!w) {
    anchorFallbackAttempted = openWhatsAppWithAnchor(url);
    browserAction = anchorFallbackAttempted ? "anchor[target=_blank].click()" : browserAction;
  }
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    /* ignore */
  }
  const launched = !!w || anchorFallbackAttempted;
  void logWhatsAppLaunch({
    module: options.module || "general",
    recordId: options.recordId ?? null,
    recordNumber: options.recordNumber ?? null,
    recipientLabel: options.recipientLabel ?? null,
    recipientMobile: p,
    whatsappUrl: url,
    launchSuccess: launched,
    failureReason: launched
      ? null
      : failureReason || "Popup blocked or browser returned no window handle",
  });
  console.info("WhatsApp launch completed", {
    module: options.module || "general",
    recordNumber: options.recordNumber ?? null,
    recipientMobile: p,
    generatedUrl: url,
    browserAction,
    launchSuccess: launched,
    anchorFallbackAttempted,
    iframeCreated: getWhatsAppEmbedDiagnostics().whatsAppIframeCount > embedDiagnostics.whatsAppIframeCount,
    modalOpened: getWhatsAppEmbedDiagnostics().whatsAppDialogCount > embedDiagnostics.whatsAppDialogCount,
    failureReason,
    timestamp: new Date().toISOString(),
  });
  if (!launched) {
    browserAction = "fallback action window.open(_blank)";
    toast.error("Click below to open WhatsApp Web.", {
      action: {
        label: "Open WhatsApp Web",
        onClick: () => {
          console.info("WhatsApp fallback link clicked", {
            generatedUrl: url,
            browserAction,
            iframeBeingCreated: false,
            modalBeingOpened: false,
            drawerBeingOpened: false,
            timestamp: new Date().toISOString(),
          });
          const fallbackWindow = window.open(url, "_blank");
          if (fallbackWindow) fallbackWindow.opener = null;
        },
      },
      duration: 10000,
    });
  }
  return true;
}

function openWhatsAppWithAnchor(url: string): boolean {
  if (typeof document === "undefined") return false;
  try {
    const link = document.createElement("a");
    link.href = url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.setAttribute("aria-label", "Open WhatsApp Web");
    link.style.display = "none";
    document.body.appendChild(link);
    link.click();
    link.remove();
    console.info("WhatsApp anchor fallback attempted", {
      generatedUrl: url,
      browserAction: "anchor[target=_blank].click()",
      iframeBeingCreated: false,
      modalBeingOpened: false,
      drawerBeingOpened: false,
      timestamp: new Date().toISOString(),
    });
    return true;
  } catch (error) {
    console.warn("WhatsApp anchor fallback failed", {
      generatedUrl: url,
      error: error instanceof Error ? error.message : String(error),
      timestamp: new Date().toISOString(),
    });
    return false;
  }
}

let whatsAppDebugListenersAttached = false;
let whatsAppEmbedObserver: MutationObserver | null = null;

function ensureWhatsAppDebugListeners() {
  if (whatsAppDebugListenersAttached || typeof window === "undefined") return;
  whatsAppDebugListenersAttached = true;
  window.addEventListener("securitypolicyviolation", (event) => {
    const blocked = event.blockedURI || "";
    if (blocked.includes("whatsapp.com")) {
      console.warn("WhatsApp CSP violation detected", {
        blockedURI: event.blockedURI,
        violatedDirective: event.violatedDirective,
        effectiveDirective: event.effectiveDirective,
        timestamp: new Date().toISOString(),
      });
    }
  });
  window.addEventListener("error", (event) => {
    const message = String(event.message || "");
    if (/whatsapp|x-frame-options|content-security-policy|refused to connect|blocked_by_response/i.test(message)) {
      console.warn("WhatsApp browser error detected", {
        message,
        filename: event.filename,
        timestamp: new Date().toISOString(),
      });
    }
  });
}

function getWhatsAppEmbedDiagnostics() {
  if (typeof document === "undefined") {
    return { whatsAppIframeCount: 0, whatsAppDialogCount: 0 };
  }
  return {
    whatsAppIframeCount: document.querySelectorAll('iframe[src*="whatsapp.com"], iframe[src*="wa.me"]').length,
    whatsAppDialogCount: Array.from(document.querySelectorAll('[role="dialog"], [data-vaul-drawer]')).filter((el) =>
      /whatsapp/i.test(el.textContent || ""),
    ).length,
  };
}

function observeWhatsAppEmbedsForDebug() {
  if (whatsAppEmbedObserver || typeof document === "undefined" || typeof MutationObserver === "undefined") return;
  whatsAppEmbedObserver = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of Array.from(mutation.addedNodes)) {
        if (!(node instanceof HTMLElement)) continue;
        const html = node.outerHTML || node.textContent || "";
        const isWhatsAppFrame = node.matches?.('iframe[src*="whatsapp.com"], iframe[src*="wa.me"]') || /<iframe[^>]+(whatsapp\.com|wa\.me)/i.test(html);
        const isWhatsAppModal = (node.getAttribute("role") === "dialog" || node.hasAttribute("data-vaul-drawer")) && /whatsapp/i.test(html);
        if (isWhatsAppFrame || isWhatsAppModal) {
          console.warn("WhatsApp embedded rendering attempt detected and should be removed", {
            iframeBeingCreated: isWhatsAppFrame,
            modalBeingOpened: isWhatsAppModal,
            drawerBeingOpened: node.hasAttribute("data-vaul-drawer"),
            timestamp: new Date().toISOString(),
          });
        }
      }
    }
  });
  whatsAppEmbedObserver.observe(document.body, { childList: true, subtree: true });
}

async function logWhatsAppLaunch(entry: {
  module: string;
  recordId: string | null;
  recordNumber: string | null;
  recipientLabel: string | null;
  recipientMobile: string;
  whatsappUrl: string;
  launchSuccess: boolean;
  failureReason: string | null;
}) {
  try {
    const { data } = await supabase.auth.getUser();
    const { error } = await supabase.from("whatsapp_launch_logs").insert({
      module: entry.module,
      record_id: entry.recordId,
      record_number: entry.recordNumber,
      recipient_label: entry.recipientLabel,
      recipient_mobile: entry.recipientMobile,
      whatsapp_url: entry.whatsappUrl,
      launch_success: entry.launchSuccess,
      failure_reason: entry.failureReason,
      user_id: data.user?.id ?? null,
    });
    if (error) console.warn("WhatsApp launch log was not saved", error.message);
  } catch (error) {
    console.warn("WhatsApp launch log failed", error);
  }
}

export function engineerAssignMsg(t: {
  case_id: string;
  call_type: string;
  customer_name: string;
  customer_phone?: string | null;
  location?: string | null;
  customer_address?: string | null;
  product?: string | null;
  serial_no?: string | null;
  complaint?: string | null;
}) {
  return [
    `*New Service Call Assigned*`,
    `Case ID: ${t.case_id}`,
    `Type: ${t.call_type}`,
    `Customer: ${t.customer_name}`,
    t.customer_phone ? `Contact: ${t.customer_phone}` : "",
    t.location ? `Location: ${t.location}` : "",
    t.customer_address ? `Address: ${t.customer_address}` : "",
    t.product ? `Product: ${t.product}` : "",
    t.serial_no ? `Serial: ${t.serial_no}` : "",
    t.complaint ? `Complaint: ${t.complaint}` : "",
    ``,
    `— Prokon Hi-Tech Systems`,
  ]
    .filter(Boolean)
    .join("\n");
}

export function customerClosedMsg(t: {
  case_id: string;
  customer_name: string;
  product?: string | null;
}) {
  return [
    `Dear ${t.customer_name},`,
    ``,
    `Your service request *${t.case_id}*${t.product ? ` for ${t.product}` : ""} has been *resolved & closed*.`,
    `Thank you for choosing Prokon Hi-Tech Systems. We appreciate your business.`,
    ``,
    `For any further assistance, feel free to reach out.`,
    `— Prokon Hi-Tech Systems`,
  ].join("\n");
}

/** Replace {{key}} placeholders in a template body. */
export function renderTemplate(
  body: string,
  vars: Record<string, string | null | undefined>,
): string {
  return body.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) => {
    const v = vars[k];
    return v == null ? "" : String(v);
  });
}

export type WaTemplateId = "engineer_assign" | "oow_quotation" | "ticket_closed";

export const TEMPLATE_PLACEHOLDERS: Record<WaTemplateId, string[]> = {
  engineer_assign: [
    "case_id",
    "call_type",
    "customer_name",
    "customer_phone",
    "location",
    "customer_address",
    "product",
    "serial_no",
    "complaint",
  ],
  oow_quotation: ["customer_name", "case_id", "quote_no", "product", "product_line"],
  ticket_closed: ["customer_name", "case_id", "product", "product_line"],
};
