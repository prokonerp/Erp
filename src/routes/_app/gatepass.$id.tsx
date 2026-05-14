import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Printer, ArrowLeft } from "lucide-react";

export const Route = createFileRoute("/_app/gatepass/$id")({
  component: GatepassView,
  head: () => ({ meta: [{ title: "Gatepass Challan — Prokon" }] }),
});

type Item = { product: string; serial_no?: string; quantity?: string; unit?: string; remarks?: string };
type Gatepass = {
  id: string; challan_no: string; gatepass_date: string; gatepass_time: string;
  person_name: string; person_company: string | null; vehicle_no: string | null;
  destination: string | null; purpose: string | null; return_type: string;
  items: Item[]; remarks: string | null; prepared_by: string | null; authorised_by: string | null;
  contact_no: string | null;
};

function GatepassView() {
  const { id } = Route.useParams();
  const [g, setG] = useState<Gatepass | null>(null);

  useEffect(() => {
    supabase.from("gatepasses").select("*").eq("id", id).single()
      .then(({ data }) => setG(data as unknown as Gatepass));
  }, [id]);

  if (!g) return <div className="text-muted-foreground">Loading…</div>;

  return (
    <div>
      <div className="flex justify-between mb-4 print:hidden">
        <Link to="/records"><Button variant="outline" size="sm"><ArrowLeft className="h-4 w-4 mr-1" />Back</Button></Link>
        <Button onClick={() => window.print()}><Printer className="h-4 w-4 mr-1" />Print Challan</Button>
      </div>

      <div className="bg-white text-black mx-auto max-w-3xl p-8 border print:border-0 print:shadow-none print:p-6 shadow-sm" id="challan">
        <div className="text-center border-b-2 border-black pb-3 mb-4">
          <h1 className="text-2xl font-bold tracking-tight">PROKON HI-TECH SYSTEMS</h1>
          <div className="text-sm">Picasso Centre, Sector-61, Gurgaon</div>
          <div className="mt-2 inline-block px-4 py-1 border-2 border-black font-bold tracking-widest">MATERIAL GATEPASS / CHALLAN</div>
        </div>

        <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm mb-3">
          <div><b>Challan No:</b> <span className="font-mono">{g.challan_no}</span></div>
          <div className="text-right"><b>Type:</b> {g.return_type}</div>
          <div><b>Date:</b> {g.gatepass_date}</div>
          <div className="text-right"><b>Time:</b> {g.gatepass_time}</div>
        </div>

        <table className="w-full text-sm border border-black border-collapse mb-3">
          <tbody>
            <tr><td className="border border-black p-1.5 w-1/4 font-semibold">Person</td><td className="border border-black p-1.5">{g.person_name}</td>
              <td className="border border-black p-1.5 w-1/4 font-semibold">Company/Dept</td><td className="border border-black p-1.5">{g.person_company}</td></tr>
            <tr><td className="border border-black p-1.5 font-semibold">Contact</td><td className="border border-black p-1.5">{g.contact_no}</td>
              <td className="border border-black p-1.5 font-semibold">Vehicle No.</td><td className="border border-black p-1.5">{g.vehicle_no}</td></tr>
            <tr><td className="border border-black p-1.5 font-semibold">Destination</td><td className="border border-black p-1.5" colSpan={3}>{g.destination}</td></tr>
            <tr><td className="border border-black p-1.5 font-semibold">Purpose</td><td className="border border-black p-1.5" colSpan={3}>{g.purpose}</td></tr>
          </tbody>
        </table>

        <table className="w-full text-sm border border-black border-collapse mb-3">
          <thead className="bg-gray-100">
            <tr>
              <th className="border border-black p-1.5 w-10">#</th>
              <th className="border border-black p-1.5 text-left">Product / Description</th>
              <th className="border border-black p-1.5 text-left">Serial No.</th>
              <th className="border border-black p-1.5 w-16">Qty</th>
              <th className="border border-black p-1.5 w-16">Unit</th>
              <th className="border border-black p-1.5 text-left">Remarks</th>
            </tr>
          </thead>
          <tbody>
            {(g.items || []).map((it, i) => (
              <tr key={i}>
                <td className="border border-black p-1.5 text-center">{i + 1}</td>
                <td className="border border-black p-1.5">{it.product}</td>
                <td className="border border-black p-1.5">{it.serial_no}</td>
                <td className="border border-black p-1.5 text-center">{it.quantity}</td>
                <td className="border border-black p-1.5 text-center">{it.unit}</td>
                <td className="border border-black p-1.5">{it.remarks}</td>
              </tr>
            ))}
            {Array.from({ length: Math.max(0, 4 - (g.items?.length || 0)) }).map((_, i) => (
              <tr key={`e${i}`}><td className="border border-black p-1.5">&nbsp;</td><td className="border border-black p-1.5"></td><td className="border border-black p-1.5"></td><td className="border border-black p-1.5"></td><td className="border border-black p-1.5"></td><td className="border border-black p-1.5"></td></tr>
            ))}
          </tbody>
        </table>

        {g.remarks && <div className="text-sm mb-4"><b>Remarks:</b> {g.remarks}</div>}

        <div className="grid grid-cols-3 gap-4 mt-12 text-sm">
          {[
            { label: "Prepared By", val: g.prepared_by },
            { label: "Authorised By", val: g.authorised_by },
            { label: "Security / Gate", val: "" },
          ].map((s) => (
            <div key={s.label} className="text-center">
              <div className="border-t border-black pt-1">
                <div className="font-semibold">{s.label}</div>
                <div className="text-xs h-4">{s.val}</div>
              </div>
            </div>
          ))}
        </div>

        <div className="mt-6 text-[10px] text-center text-gray-600 border-t pt-2">
          This is a system-generated gatepass from Prokon Hi-Tech Systems · Picasso Centre, Sector-61, Gurgaon.
        </div>
      </div>

      <style>{`
        @media print {
          @page { size: A4; margin: 12mm; }
          body { background: white !important; }
          header, nav, .print\\:hidden { display: none !important; }
        }
      `}</style>
    </div>
  );
}