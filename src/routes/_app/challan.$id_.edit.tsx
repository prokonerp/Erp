import { createFileRoute } from "@tanstack/react-router";
import { ChallanForm } from "@/components/ChallanForm";

export const Route = createFileRoute("/_app/challan/$id_/edit")({
  component: ChallanEditPage,
  head: () => ({ meta: [{ title: "Edit Delivery Challan — Prokon" }] }),
});

function ChallanEditPage() {
  const { id } = Route.useParams();
  return <ChallanForm editId={id} />;
}