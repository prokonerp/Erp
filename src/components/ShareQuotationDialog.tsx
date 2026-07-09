import { useMemo, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Copy, Download, Link2, Mail, MessageCircle, Printer, Share2 } from "lucide-react";
import { toast } from "sonner";
import { waOpen } from "@/lib/tickets";

export type ShareQuotationProps = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  customerName: string;
  customerPhone?: string | null;
  customerEmail?: string | null;
  companyName: string;
  quoteNo: string;
  subject?: string | null;
  publicUrl?: string;
  onGeneratePdf: () => void; // reuse existing print/PDF path
};

function buildMessage(customerName: string, companyName: string) {
  return `Dear ${customerName},\n\nPlease find your quotation attached.\n\nRegards\n${companyName}`;
}

export function ShareQuotationDialog(p: ShareQuotationProps) {
  const defaultMsg = useMemo(() => buildMessage(p.customerName || "Customer", p.companyName || "Team"), [p.customerName, p.companyName]);
  const [message, setMessage] = useState<string>(defaultMsg);
  const [phone, setPhone] = useState<string>(p.customerPhone || "");
  const link = p.publicUrl || (typeof window !== "undefined" ? window.location.href : "");

  // Reset when re-opening for a different quotation.
  const key = `${p.quoteNo}|${p.customerName}|${p.companyName}`;
  const [lastKey, setLastKey] = useState(key);
  if (lastKey !== key) {
    setLastKey(key);
    setMessage(defaultMsg);
    setPhone(p.customerPhone || "");
  }

  const generatePdf = () => {
    p.onGeneratePdf();
    toast.info("Use your browser's dialog to save the PDF, then attach it if needed.");
  };

  const sendWhatsApp = async () => {
    if (!phone) return toast.error("Enter a mobile number");
    // Try the native share sheet first — on mobile this opens WhatsApp with the message,
    // and the user can attach the PDF they just saved.
    const nav = navigator as Navigator & { share?: (d: ShareData) => Promise<void> };
    if (nav.share) {
      try {
        await nav.share({ title: `Quotation ${p.quoteNo}`, text: `${message}\n\n${link}` });
        toast.success("Shared");
        return;
      } catch {
        // user cancelled — fall through to wa.me
      }
    }
    const ok = await waOpen(phone, `${message}\n\n${link}`);
    if (!ok) return toast.error("Valid mobile number is required.");
    toast.success("Opening WhatsApp…");
  };

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(link);
      toast.success("Link copied");
    } catch {
      toast.error("Copy failed");
    }
  };

  const emailLater = () => {
    const sub = encodeURIComponent(`Quotation ${p.quoteNo}${p.subject ? " - " + p.subject : ""}`);
    const body = encodeURIComponent(`${message}\n\n${link}`);
    const to = p.customerEmail || "";
    window.open(`mailto:${to}?subject=${sub}&body=${body}`);
  };

  return (
    <Dialog open={p.open} onOpenChange={p.onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Share2 className="h-4 w-4" />Share Quotation {p.quoteNo}</DialogTitle>
          <DialogDescription>Generate the PDF, then share via WhatsApp, Email, or copy the link.</DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <Button variant="outline" onClick={generatePdf}>
              <Printer className="h-4 w-4 mr-1.5" />Generate PDF
            </Button>
            <Button variant="outline" onClick={generatePdf}>
              <Download className="h-4 w-4 mr-1.5" />Download PDF
            </Button>
          </div>

          <div className="space-y-1">
            <Label className="text-xs">WhatsApp number</Label>
            <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+91 90000 00000" />
          </div>

          <div className="space-y-1">
            <Label className="text-xs">Message</Label>
            <Textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={6} className="font-mono text-xs" />
            <p className="text-xs text-muted-foreground">
              Tip: on mobile, sharing opens WhatsApp with this message — attach the PDF you saved. On desktop, WhatsApp Web opens with the message prefilled; attach the PDF manually.
            </p>
          </div>

          <div className="grid grid-cols-3 gap-2">
            <Button onClick={sendWhatsApp} className="bg-emerald-600 hover:bg-emerald-700 text-white">
              <MessageCircle className="h-4 w-4 mr-1.5" />WhatsApp
            </Button>
            <Button variant="outline" onClick={emailLater}>
              <Mail className="h-4 w-4 mr-1.5" />Email later
            </Button>
            <Button variant="outline" onClick={copyLink}>
              <Link2 className="h-4 w-4 mr-1.5" />Copy Link
            </Button>
          </div>

          <div className="flex items-center gap-2 text-xs text-muted-foreground border rounded-md p-2 bg-muted/30">
            <Copy className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate font-mono">{link}</span>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}