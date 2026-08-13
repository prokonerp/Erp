import { createFileRoute } from "@tanstack/react-router";
import { GeneralDcForm } from "@/components/GeneralDcForm";

export const Route = createFileRoute("/_app/sales/general-dc/new")({
  component: NewGeneralDc,
  head: () => ({
    meta: [
      { title: "New General Delivery Challan — Prokon ERP" },
      { name: "description", content: "Create a standalone dispatch challan with serial and stock tracking." },
      { property: "og:title", content: "New General Delivery Challan — Prokon ERP" },
      { property: "og:description", content: "Create a standalone dispatch challan with serial and stock tracking." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
});

function NewGeneralDc() {
  return <GeneralDcForm />;
}
