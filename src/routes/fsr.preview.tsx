import { createFileRoute, redirect } from "@tanstack/react-router";
import { FsrPrintView } from "@/components/fsr/FsrPrintView";
import { buildFsrPrintModel, type FsrPrintInput } from "@/lib/fsrPrint";
import { DEFAULT_COMPANY_PROFILE } from "@/lib/companyProfile";
import apcLogo from "@/assets/oem-apc.png.asset.json";

export const Route = createFileRoute("/fsr/preview")({
  beforeLoad: () => {
    if (!import.meta.env.DEV) {
      throw redirect({ to: "/" });
    }
  },
  component: FsrPreviewPage,
});

/* ── Rich showroom sample: 16+16 battery cells, 5 parts, long texts ── */

const chargingValues = [
  13.8, 13.7, 13.8, 13.6, 13.7, 13.8, 13.7, 13.6, 13.8, 13.7, 13.5, 13.8, 13.7, 13.6, 13.8, 13.7,
];

const dischargingValues = [
  12.9, 12.8, 12.9, 12.7, 12.8, 12.9, 12.8, 12.7, 12.9, 12.8, 12.6, 12.9, 12.8, 12.7, 12.9, 12.8,
];

const sampleInput: FsrPrintInput = {
  fsr: {
    id: "SMPL-FSR-0001",
    submitted_at: "2026-09-15T11:30:00Z",
    mains_voltage_ln: 228,
    mains_voltage_ne: 4,
    battery_bank_make: "Exide",
    battery_bank_ah: "12V 100Ah",
    battery_bank_qty: 16,
    charging_readings: chargingValues.map((volts) => ({ volts })),
    discharging_readings: dischargingValues.map((volts) => ({ volts })),
    rating: 9,
    ac_provided: true,
    dg_provided: false,
    environment_duty: true,
    ups_location: "Server Room — 2nd Floor",
    pc_details: [
      { monitor_size_in: 21, qty: 4 },
      { monitor_size_in: 19, qty: 2 },
    ],
    printer_details: [{ rating_w: 300, qty: 1 }],
    scanner_details: [{ rating_w: 200, qty: 1 }],
    power_failures_count: 6,
    power_failures_duration_min: 45,
    load_on_dg_percent: 0,
    dg_set: false,
    dg_set_capacity_kva: null,
    amf_panel: true,
    operate_non_business_hours: true,
    operate_holidays: false,
    part_replacements: [
      {
        item: "Battery 12V 100Ah",
        old_sr_no: "EXD22A001",
        new_sr_no: "EXD26I101",
        charges: 12500,
        qty: 2,
      },
      {
        item: "DC Capacitor 4700uF",
        old_sr_no: "CAP-8812",
        new_sr_no: "CAP-9031",
        charges: 1800,
        qty: 1,
      },
      {
        item: "Cooling Fan 120mm",
        old_sr_no: "FAN-4410",
        new_sr_no: "FAN-5523",
        charges: 950,
        qty: 2,
      },
      { item: "Control Card", old_sr_no: "CTL-1102", new_sr_no: "CTL-1187", charges: 6400, qty: 1 },
      { item: "Fuse Kit 63A", old_sr_no: "FUS-0063", new_sr_no: "FUS-0071", charges: 450, qty: 4 },
    ],
    engineer_name: "Amit Kumar",
    engineer_phone: "+91-98111-22334",
    engineer_remarks:
      "Battery bank healthy; two cells (B11 charging, B11 discharging) read marginally low — advised replacement within 90 days. Mains wiring tightened at the input MCB and load wiring verified.",
    customer_remarks:
      "Engineer explained the battery readings and the AMC renewal options. Site left clean; UPS running normally on mains at departure. Satisfied with the visit.",
  },
  ticket: {
    case_id: "CS-2026-0915-0042",
    call_type: "Warranty",
    product: "APC Smart-UPS SRT10KXLI",
    serial_no: "210924H95V",
    customer_name: "7Minion Technology Pvt. Ltd.",
    customer_address: "WDWFEFWGRG, Tower B, 9th Floor, Sector 62, Gurugram, Haryana - 122011",
    customer_email: "accounts@7minion.com",
    customer_phone: "+91-98765-43210",
    complaint:
      "UPS beeping in battery mode with intermittent output voltage fluctuation during office hours",
    remarks: "Check battery bank health and mains input wiring",
    status: "Closed",
    oem_brand: "APC",
    oem_call: true,
    preferred_visit_datetime: "2026-09-14T16:30:00Z",
    created_at: "2026-09-13T10:00:00Z",
    closed_at: "2026-09-15T12:00:00Z",
  },
  customer: {
    company: "7Minion Technology Pvt. Ltd.",
    contact_name: "Rahul Sharma",
    phone: "+91-98765-43210",
    email: "accounts@7minion.com",
    billing_address: "WDWFEFWGRG, Tower B, 9th Floor, Sector 62, Gurugram, Haryana - 122011",
    city: "Gurugram",
    state: "Haryana",
    gst: "06AAACZ8266C1Z9",
  },
  visits: {
    arrival_at: "2026-09-15T09:40:00Z",
    departure_at: "2026-09-15T11:20:00Z",
  },
};

const sampleCompany = {
  ...DEFAULT_COMPANY_PROFILE,
  name: "PROKON HI-TECH SYSTEMS",
  phone: "0129-4059682 +91-9818112270",
  email: "sales@prokonhitech.com",
  gstin: "06AEHPA2697G1ZL",
  registered_office_address: "Picasso Centre, Sector-61, Gurgaon, Haryana - 122011",
};

const signatureDataUrl =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="160" height="44"><path d="M10 32 C 30 8, 45 40, 70 14 S 110 36, 150 10" stroke="#14201A" stroke-width="2.5" fill="none" stroke-linecap="round"/></svg>',
  );

function FsrPreviewPage() {
  const model = buildFsrPrintModel(sampleInput);
  return (
    <div className="min-h-screen bg-gray-200 py-4 flex justify-center print:bg-white print:py-0 print:min-h-0 print:block">
      <style>{`@media print { html, body { margin: 0 !important; padding: 0 !important; background: #fff !important; } }`}</style>
      <FsrPrintView
        model={model}
        company={sampleCompany}
        oem={{ url: apcLogo.url, alt: "APC" }}
        signatureDataUrl={signatureDataUrl}
      />
    </div>
  );
}
