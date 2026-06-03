import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { submitPublicTicket } from "@/lib/public-tickets.functions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CALL_TYPES } from "@/lib/tickets";
import { Building2, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/raise-ticket")({
  component: PublicTicketForm,
  head: () => ({
    meta: [
      { title: "Raise a Service Ticket — Prokon Hi-Tech Systems" },
      { name: "description", content: "Report an issue with your UPS / CCTV / equipment. Our service team will reach out shortly." },
    ],
  }),
});

function PublicTicketForm() {
  const submit = useServerFn(submitPublicTicket);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
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
    captcha_answer: "",
  });

  const captcha = useMemo(() => {
    const a = Math.floor(Math.random() * 8) + 2;
    const b = Math.floor(Math.random() * 8) + 2;
    return { a, b, sum: a + b };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [done]);

  const set = (p: Partial<typeof form>) => setForm((f) => ({ ...f, ...p }));

  const onSubmit = async () => {
    if (!form.customer_name.trim() || !form.customer_phone.trim() || !form.complaint.trim()) {
      return toast.error("Name, phone and complaint are required");
    }
    const ans = Number(form.captcha_answer);
    if (!Number.isInteger(ans)) return toast.error("Please solve the captcha");
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
          captcha_answer: ans,
          captcha_expected: captcha.sum,
        },
      });
      setDone(res.case_id);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Submission failed");
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <div className="min-h-screen bg-muted/20 flex items-center justify-center p-4">
        <Card className="max-w-lg w-full">
          <CardContent className="pt-8 text-center space-y-4">
            <CheckCircle2 className="h-14 w-14 text-green-600 mx-auto" />
            <h1 className="text-2xl font-bold">Ticket received</h1>
            <p className="text-muted-foreground">
              Your reference number is <span className="font-mono font-semibold text-foreground">{done}</span>.
              Our service team will contact you shortly.
            </p>
            <Button onClick={() => { setDone(null); setForm({ ...form, complaint: "", captcha_answer: "" }); }}>
              Raise another ticket
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-muted/20">
      <header className="bg-background border-b">
        <div className="max-w-2xl mx-auto px-4 py-4 flex items-center gap-2">
          <Building2 className="h-5 w-5 text-primary" />
          <div>
            <div className="font-semibold leading-tight">Prokon Hi-Tech Systems</div>
            <div className="text-xs text-muted-foreground">Customer Service Request</div>
          </div>
        </div>
      </header>

      <main className="max-w-2xl mx-auto p-4 md:p-6">
        <Card>
          <CardHeader>
            <CardTitle>Raise a Service Ticket</CardTitle>
            <p className="text-sm text-muted-foreground">
              Fill in your details and describe the issue. We'll assign an engineer and call you back.
            </p>
          </CardHeader>
          <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="md:col-span-2"><Label>Your Name *</Label><Input value={form.customer_name} onChange={(e) => set({ customer_name: e.target.value })} /></div>
            <div><Label>Phone *</Label><Input value={form.customer_phone} onChange={(e) => set({ customer_phone: e.target.value })} /></div>
            <div><Label>Email</Label><Input type="email" value={form.customer_email} onChange={(e) => set({ customer_email: e.target.value })} /></div>
            <div><Label>City / Location</Label><Input value={form.location} onChange={(e) => set({ location: e.target.value })} /></div>
            <div>
              <Label>Call Type *</Label>
              <Select value={form.call_type} onValueChange={(v) => set({ call_type: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{CALL_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div><Label>Product / Model</Label><Input value={form.product} onChange={(e) => set({ product: e.target.value })} /></div>
            <div><Label>Serial Number</Label><Input value={form.serial_no} onChange={(e) => set({ serial_no: e.target.value.toUpperCase() })} className="font-mono" /></div>
            <div className="md:col-span-2"><Label>Address</Label><Textarea rows={2} value={form.customer_address} onChange={(e) => set({ customer_address: e.target.value })} /></div>
            <div className="md:col-span-2"><Label>Describe the Issue *</Label><Textarea rows={4} value={form.complaint} onChange={(e) => set({ complaint: e.target.value })} placeholder="What's not working? When did it start?" /></div>
            <div className="md:col-span-2 border-t pt-4">
              <Label>Verify: what is {captcha.a} + {captcha.b}? *</Label>
              <Input
                inputMode="numeric"
                className="w-32 mt-1"
                value={form.captcha_answer}
                onChange={(e) => set({ captcha_answer: e.target.value.replace(/\D/g, "") })}
              />
            </div>
            <div className="md:col-span-2 flex justify-end">
              <Button size="lg" disabled={busy} onClick={onSubmit}>
                {busy ? "Submitting…" : "Submit Ticket"}
              </Button>
            </div>
          </CardContent>
        </Card>
        <p className="text-xs text-muted-foreground text-center mt-6">
          By submitting, you consent to being contacted by Prokon Hi-Tech Systems about this request.
        </p>
      </main>
    </div>
  );
}