import { createFileRoute } from "@tanstack/react-router";
import { GrnForm } from "@/components/GrnForm";

export const Route = createFileRoute("/_app/grn/$id_/edit")({
  component: GrnEditPage,
  head: () => ({ meta: [{ title: "Edit GRN — Prokon" }] }),
});

function GrnEditPage() {
  const { id } = Route.useParams();
  return <GrnForm editId={id} />;
}