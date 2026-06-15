import { createFileRoute } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { submitPublicTicket } from "@/lib/public-tickets.functions";
import {
  uploadPublicTicketAttachment,
  deletePublicTicketAttachment,
} from "@/lib/public-ticket-uploads.functions";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CALL_TYPES } from "@/lib/tickets";
import { Building2, CheckCircle2, Camera, X, Loader2, ImagePlus } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/raise-ticket")({
  component: PublicTicketForm,
  head: () => ({
    meta: [
      { title: "Raise a Service Ticket — Prokon Hi-Tech Systems" },
      { name: "description", content: "Report an issue with your UPS / CCTV / equipment. Our service team will contact you shortly." },
      { name: "viewport", content: "width=device-width, initial-scale=1, maximum-scale=1" },
    ],
  }),
});

type Attachment = { path: string; kind: "serial_photo" | "issue_photo" | "other"; preview: string };

function PublicTicketForm() {
  const submit = useServerFn(submitPublicTicket);
  const uploadFn = useServerFn(uploadPublicTicketAttachment);
  const deleteFn = useServerFn(deletePublicTicketAttachment);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const serialCamRef = useRef<HTMLInputElement>(null);
  const issueCamRef = useRef<HTMLInputElement>(null);

  const [form, setForm] = useState({
    customer_name: "",
    customer_phone: "",
    customer_email: "",
    customer_address: "",
    location: "",
    product: "",
    serial_no: "",
    call_type: "OOW" as string,
    complaint: "",
  });

  const set = (p: Partial<typeof form>) => setForm((f) => ({ ...f, ...p }));

  const uploadPhoto = async (file: File, kind: Attachment["kind"]) => {
    if (!file) return;
    if (file.size > 8 * 1024 * 1024) return toast.error("Image must be under 8 MB");
    if (attachments.length >= 5) return toast.error("Max 5 photos");
    setUploading(true);
    try {
      const buf = await file.arrayBuffer();
      let bin = "";
      const bytes = new Uint8Array(buf);
      for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
      const data_base64 = btoa(bin);
      const { path } = await uploadFn({
        data: {
          filename: file.name || "upload.jpg",
          content_type: file.type || "image/jpeg",
          kind,
          data_base64,
        },
      });
      const preview = URL.createObjectURL(file);
      setAttachments((a) => [...a, { path, kind, preview }]);
      toast.success("Photo uploaded");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  const removePhoto = async (idx: number) => {
    const a = attachments[idx];
    setAttachments((arr) => arr.filter((_, i) => i !== idx));
    try { await deleteFn({ data: { path: a.path } }); } catch { /* ignore */ }
  };

  const onSubmit = async () => {
    if (!form.customer_name.trim()) return toast.error("Please enter your name");
    if (form.customer_phone.replace(/\D/g, "").length < 7) return toast.error("Please enter a valid phone number");
    if (form.complaint.trim().length < 5) return toast.error("Please describe the issue (min 5 characters)");
    setBusy(true);
    try {
      const res = await submit({
        data: {
          customer_name: form.customer_name,
          customer_phone: form.customer_phone,
          customer_email: form.customer_email,
          customer_address: form.customer_address,
          location: form.location,
          product: form.product,
          serial_no: form.serial_no,
          call_type: form.call_type as never,
          complaint: form.complaint,
          captcha_answer: 0,
          captcha_expected: 0,
          attachments: attachments.map(({ path, kind }) => ({ path, kind })),
        },
      });
      setDone(res.case_id);
      attachments.forEach((a) => URL.revokeObjectURL(a.preview));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Submission failed");
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-primary/5 to-background flex items-center justify-center p-4">
        <Card className="max-w-lg w-full border-t-4 border-t-green-600 shadow-lg">
          <CardContent className="pt-10 pb-8 text-center space-y-4">
            <div className="mx-auto h-16 w-16 rounded-full bg-green-100 flex items-center justify-center">
              <CheckCircle2 className="h-10 w-10 text-green-600" />
            </div>
            <h1 className="text-2xl font-bold">Thank you — ticket received</h1>
            <p className="text-muted-foreground">Your reference number is</p>
            <div className="text-2xl font-mono font-bold tracking-wider text-primary bg-primary/5 py-3 rounded-lg">{done}</div>
            <p className="text-sm text-muted-foreground">Our service team will contact you shortly on the number you provided.</p>
            <Button
              variant="outline"
              onClick={() => {
                setDone(null);
                setAttachments([]);
                setForm({ ...form, complaint: "", serial_no: "" });
              }}
            >
              Raise another ticket
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-primary/5 to-background">
      {/* Forms-style header band */}
      <div className="bg-primary text-primary-foreground">
        <div className="max-w-2xl mx-auto px-4 py-6">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-primary-foreground/10 flex items-center justify-center">
              <Building2 className="h-5 w-5" />
            </div>
            <div>
              <div className="text-xs uppercase tracking-wider opacity-80">Prokon Hi-Tech Systems</div>
              <h1 className="text-xl font-semibold leading-tight">Customer Service Request</h1>
            </div>
          </div>
        </div>
      </div>

      <main className="max-w-2xl mx-auto p-4 md:p-6 -mt-4">
        <Card className="shadow-sm border-t-4 border-t-primary">
          <CardContent className="pt-6 space-y-8">
            <section className="space-y-4">
                <div>
                  <h2 className="text-lg font-semibold">Tell us about yourself</h2>
                  <p className="text-sm text-muted-foreground">So our engineer can reach you back.</p>
                </div>
                <div className="space-y-1.5">
                  <Label>Full name <span className="text-destructive">*</span></Label>
                  <Input value={form.customer_name} onChange={(e) => set({ customer_name: e.target.value })} placeholder="e.g. Rajesh Kumar" autoFocus />
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label>Phone <span className="text-destructive">*</span></Label>
                    <Input inputMode="tel" value={form.customer_phone} onChange={(e) => set({ customer_phone: e.target.value })} placeholder="10-digit mobile" />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Email <span className="text-muted-foreground text-xs">(optional)</span></Label>
                    <Input type="email" value={form.customer_email} onChange={(e) => set({ customer_email: e.target.value })} placeholder="name@example.com" />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label>City / Location</Label>
                  <Input value={form.location} onChange={(e) => set({ location: e.target.value })} placeholder="e.g. Gurgaon" />
                </div>
                <div className="space-y-1.5">
                  <Label>Address <span className="text-muted-foreground text-xs">(where service is needed)</span></Label>
                  <Textarea rows={2} value={form.customer_address} onChange={(e) => set({ customer_address: e.target.value })} />
                </div>
            </section>

            <section className="space-y-4 pt-2 border-t">
                <div>
                  <h2 className="text-lg font-semibold">Equipment details</h2>
                  <p className="text-sm text-muted-foreground">Help us prepare before the visit.</p>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label>Service type <span className="text-destructive">*</span></Label>
                    <Select value={form.call_type} onValueChange={(v) => set({ call_type: v })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>{CALL_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label>Model</Label>
                    <Input value={form.product} onChange={(e) => set({ product: e.target.value })} placeholder="e.g. APC 1.5kVA UPS" />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label>Serial number</Label>
                  <Input
                    value={form.serial_no}
                    onChange={(e) => set({ serial_no: e.target.value.toUpperCase() })}
                    placeholder="Type or capture from photo below"
                    className="font-mono"
                  />
                </div>

                {/* Serial number photo capture */}
                <div className="rounded-lg border-2 border-dashed border-primary/30 bg-primary/5 p-4 space-y-3">
                  <div className="flex items-start gap-3">
                    <Camera className="h-5 w-5 text-primary mt-0.5 shrink-0" />
                    <div className="flex-1">
                      <div className="font-medium text-sm">Photo of serial number</div>
                      <p className="text-xs text-muted-foreground">Snap a clear picture of the sticker / label on the device.</p>
                    </div>
                  </div>
                  <input
                    ref={serialCamRef}
                    type="file"
                    accept="image/*"
                    capture="environment"
                    className="hidden"
                    onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadPhoto(f, "serial_photo"); e.target.value = ""; }}
                  />
                  <Button
                    type="button"
                    variant="default"
                    className="w-full"
                    disabled={uploading}
                    onClick={() => serialCamRef.current?.click()}
                  >
                    {uploading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Camera className="h-4 w-4 mr-2" />}
                    Take / upload serial number photo
                  </Button>
                </div>
            </section>

            <section className="space-y-4 pt-2 border-t">
                <div>
                  <h2 className="text-lg font-semibold">Describe the issue</h2>
                  <p className="text-sm text-muted-foreground">More detail helps us send the right engineer.</p>
                </div>
                <div className="space-y-1.5">
                  <Label>What's wrong? <span className="text-destructive">*</span></Label>
                  <Textarea
                    rows={6}
                    value={form.complaint}
                    onChange={(e) => set({ complaint: e.target.value })}
                    placeholder="e.g. The UPS beeps continuously since this morning and does not back up the load."
                  />
                  <div className="text-xs text-muted-foreground text-right">{form.complaint.length} / 2000</div>
                </div>

                <div className="rounded-lg border-2 border-dashed border-muted-foreground/30 p-4 space-y-3">
                  <div className="flex items-start gap-3">
                    <ImagePlus className="h-5 w-5 text-muted-foreground mt-0.5 shrink-0" />
                    <div className="flex-1">
                      <div className="font-medium text-sm">Add photos of the issue <span className="text-muted-foreground text-xs">(optional)</span></div>
                      <p className="text-xs text-muted-foreground">Up to 5 images, 8 MB each.</p>
                    </div>
                  </div>
                  <input
                    ref={issueCamRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadPhoto(f, "issue_photo"); e.target.value = ""; }}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    className="w-full"
                    disabled={uploading || attachments.length >= 5}
                    onClick={() => issueCamRef.current?.click()}
                  >
                    {uploading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <ImagePlus className="h-4 w-4 mr-2" />}
                    Add photo
                  </Button>
                </div>

                {attachments.length > 0 && (
                  <div className="grid grid-cols-3 gap-2">
                    {attachments.map((a, i) => (
                      <div key={a.path} className="relative aspect-square rounded-md overflow-hidden border bg-muted">
                        <img src={a.preview} alt="upload" className="w-full h-full object-cover" />
                        <button
                          type="button"
                          onClick={() => removePhoto(i)}
                          className="absolute top-1 right-1 h-6 w-6 rounded-full bg-black/60 text-white flex items-center justify-center"
                          aria-label="Remove"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                        {a.kind === "serial_photo" && (
                          <div className="absolute bottom-0 inset-x-0 bg-primary/90 text-primary-foreground text-[10px] text-center py-0.5">
                            SERIAL
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
            </section>

            {/* Submit */}
            <div className="pt-4 border-t">
              <Button type="button" onClick={onSubmit} disabled={busy} size="lg" className="w-full">
                {busy ? <><Loader2 className="h-4 w-4 animate-spin mr-2" />Submitting…</> : "Submit ticket"}
              </Button>
            </div>
          </CardContent>
        </Card>

        <p className="text-xs text-muted-foreground text-center mt-6 px-4">
          By submitting, you consent to being contacted by Prokon Hi-Tech Systems about this request.
        </p>
      </main>
    </div>
  );
}
