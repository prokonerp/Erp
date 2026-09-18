import { useMemo, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { FileText, MessageCircle, Share2 } from "lucide-react";
import { toast } from "sonner";
import { waOpen } from "@/lib/tickets";
import { useFieldServiceReport } from "@/hooks/useFieldServiceReport";
import { FsrPrintButton } from "@/components/fsr/FsrPrintButton";

export type ShareFsrProps = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  ticketId: string;
  caseId: string;
  customerName: string;
  customerPhone?: string | null;
};

function buildMessage(customerName: string, caseId: string) {
  return `Dear ${customerName},\n\nPlease find your Field Service Report for visit ${caseId} attached.\n\nRegards\nProkon Service Team`;
}

/**
 * ShareFsrDialog — Completed-tab share sheet for one closed visit.
 * The engineer reads the report via Print (on-screen preview) or saves the
 * PDF with Download (both from the shared FsrPrintButton pipeline), then
 * sends it to the customer on WhatsApp: native share sheet on mobile, else
 * WhatsApp Web with the message prefilled. The customer number comes from
 * the ticket and is only an editable starting value. When no FSR was
 * submitted for the visit there is nothing to send, so only a note shows.
 */
export function ShareFsrDialog(p: ShareFsrProps) {
  // Fetch only while open; closed dialogs must not issue queries.
  const { data: rows, isLoading: fsrLoading } = useFieldServiceReport(
    p.open && p.ticketId ? p.ticketId : null,
  );
  const hasFsr = (rows?.length ?? 0) > 0;

  const defaultMsg = useMemo(
    () => buildMessage(p.customerName || "Customer", p.caseId || "your visit"),
    [p.customerName, p.caseId],
  );
  const [message, setMessage] = useState<string>(defaultMsg);
  const [phone, setPhone] = useState<string>(p.customerPhone || "");

  // Reset when re-opening for a different ticket.
  const key = `${p.ticketId}|${p.caseId}|${p.customerName}`;
  const [lastKey, setLastKey] = useState(key);
  if (lastKey !== key) {
    setLastKey(key);
    setMessage(defaultMsg);
    setPhone(p.customerPhone || "");
  }

  const sendWhatsApp = async () => {
    if (!phone || phone.trim() === "") return toast.error("Enter a mobile number");
    // Native share sheet first — on mobile this opens WhatsApp with the
    // message, and the engineer attaches the downloaded PDF there.
    const nav = navigator as Navigator & { share?: (d: ShareData) => Promise<void> };
    if (nav.share) {
      try {
        await nav.share({ title: `FSR ${p.caseId}`, text: message });
        toast.success("Shared");
        return;
      } catch {
        // user cancelled — fall through to WhatsApp Web
      }
    }
    const ok = await waOpen(phone, message);
    if (!ok) return toast.error("Valid mobile number is required.");
    toast.success("Opening WhatsApp…");
  };

  return (
    <Dialog open={p.open} onOpenChange={p.onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Share2 className="h-4 w-4" />
            Share FSR{p.caseId ? ` ${p.caseId}` : ""}
          </DialogTitle>
          <DialogDescription>
            Read or download the report, then send it to the customer on WhatsApp.
          </DialogDescription>
        </DialogHeader>

        {fsrLoading ? (
          <p className="py-6 text-center text-sm text-muted-foreground">Loading report…</p>
        ) : !hasFsr ? (
          <p className="flex items-start gap-2 rounded-md border border-border bg-muted/30 p-3 text-sm text-muted-foreground">
            <FileText className="h-4 w-4 mt-0.5 shrink-0" aria-hidden />
            No report was submitted for this visit yet — there is nothing to send.
          </p>
        ) : (
          <div className="space-y-3">
            <div>
              <Label className="text-xs">Report (read or save the PDF first)</Label>
              <div className="mt-1">
                <FsrPrintButton ticketId={p.ticketId} />
              </div>
            </div>

            <div className="space-y-1">
              <Label className="text-xs">WhatsApp number</Label>
              <Input
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+91 90000 00000"
                className="min-h-[44px]"
                inputMode="tel"
              />
            </div>

            <div className="space-y-1">
              <Label className="text-xs">Message</Label>
              <Textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                rows={5}
                className="font-mono text-xs"
              />
              <p className="text-xs text-muted-foreground">
                Tip: on mobile, sharing opens WhatsApp with this message — attach the PDF you saved.
                On desktop, WhatsApp Web opens with the message prefilled; attach the PDF manually.
              </p>
            </div>

            <Button
              onClick={sendWhatsApp}
              className="min-h-[44px] w-full bg-emerald-600 hover:bg-emerald-700 text-white"
            >
              <MessageCircle className="h-4 w-4 mr-1.5" />
              Send on WhatsApp
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
