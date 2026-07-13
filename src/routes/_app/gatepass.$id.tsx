import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import {
  Breadcrumb,
  BreadcrumbList,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
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

  const Copy = ({ label }: { label: string }) => (
    <div className="bg-white text-black mx-auto max-w-3xl p-6 border print:border-0 print:shadow-none print:p-2 shadow-sm copy-block">
      <div className="text-center border-b-2 border-[#1e40af] pb-2 mb-3 relative">
        <div className="absolute right-0 top-0 text-[10px] font-bold border border-black px-2 py-0.5">{label}</div>
        <h1 className="text-3xl font-extrabold tracking-tight bg-gradient-to-r from-[#1e3a8a] via-[#2563eb] to-[#dc2626] bg-clip-text text-transparent">PROKON HI-TECH SYSTEMS</h1>
        <div className="text-sm">B-505, Picasso Centre, Sector-61, Gurgaon</div>
        <div className="mt-1 inline-block px-3 py-0.5 border-2 border-black font-bold tracking-widest text-sm">MATERIAL GATEPASS / CHALLAN</div>
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
          {Array.from({ length: Math.max(0, 3 - (g.items?.length || 0)) }).map((_, i) => (
            <tr key={`e${i}`}><td className="border border-black p-1.5">&nbsp;</td><td className="border border-black p-1.5"></td><td className="border border-black p-1.5"></td><td className="border border-black p-1.5"></td><td className="border border-black p-1.5"></td><td className="border border-black p-1.5"></td></tr>
          ))}
        </tbody>
      </table>

      {g.remarks && <div className="text-sm mb-3"><b>Remarks:</b> {g.remarks}</div>}

      <div className="grid grid-cols-3 gap-4 mt-6 text-sm">
        {[
          { label: "Prepared By", val: g.prepared_by },
          { label: "Authorised By", val: g.authorised_by },
          { label: "Security / Gate", val: "" },
        ].map((s) => (
          <div key={s.label} className="text-center">
            <div className="h-7 print:h-6"></div>
            <div className="border-t border-black pt-1">
              <div className="font-semibold">{s.label}</div>
              <div className="text-xs h-4">{s.val}</div>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-3 text-[10px] text-center text-gray-600 border-t pt-1">
        System-generated gatepass · Prokon Hi-Tech Systems · Picasso Centre, Sector-61, Gurgaon.
      </div>
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-4 print:hidden">
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink asChild>
                <Link to="/gatepass">Gate Passes</Link>
              </BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbLink asChild>
                <Link to="/gatepass">View Gate Pass History</Link>
              </BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage>Gate Pass {g.challan_no}</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
        <div className="flex justify-between">
          <Link to="/gatepass"><Button variant="outline" size="sm"><ArrowLeft className="h-4 w-4 mr-1" />Back</Button></Link>
          <Button onClick={() => window.print()}><Printer className="h-4 w-4 mr-1" />Print Challan</Button>
        </div>
      </div>

      <div id="challan" className="space-y-4 print:space-y-0">
        <Copy label="ORIGINAL" />
        <div className="text-center text-xs text-gray-500 my-2 print:my-1 cut-line">— — — — — — — — — — — cut here — — — — — — — — — — —</div>
        <Copy label="DUPLICATE (Office Copy)" />
      </div>

      <style>{`
        @media print {
          @page { size: A4 portrait; margin: 5mm; }
          body { background: white !important; }
          html, body { height: auto !important; }
          header, nav, .print\\:hidden { display: none !important; }
          #challan { display: block; height: 287mm; overflow: hidden; }
          #challan > * { margin: 0 !important; }
          .copy-block {
            font-size: 9px; line-height: 1.2;
            page-break-inside: avoid; break-inside: avoid;
            max-width: 100% !important;
            height: 141mm; box-sizing: border-box;
            padding: 3mm !important; margin: 0 !important;
            border: 0 !important;
          }
          .copy-block h1 { font-size: 17px; margin: 0; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          .copy-block table td, .copy-block table th { padding: 1.5px 3px !important; }
          .copy-block .mt-6 { margin-top: 3mm !important; }
          .cut-line { margin: 0 !important; font-size: 7px; line-height: 1; page-break-after: avoid; page-break-before: avoid; }
        }
      `}</style>
    </div>
  );
}