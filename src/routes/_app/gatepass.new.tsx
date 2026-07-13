import { createFileRoute, Link } from "@tanstack/react-router";
import { GatepassNewForm } from "@/components/GatepassNewForm";
import {
  Breadcrumb,
  BreadcrumbList,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";

export const Route = createFileRoute("/_app/gatepass/new")({
  head: () => ({
    meta: [
      { title: "Create New Gate Pass — Prokon" },
      { name: "description", content: "Create a new gate pass record." },
    ],
  }),
  component: GatepassNewPage,
});

function GatepassNewPage() {
  return (
    <div className="space-y-4">
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink asChild>
              <Link to="/gatepass">Gate Passes</Link>
            </BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>Create New Gate Pass</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>
      <GatepassNewForm />
    </div>
  );
}
