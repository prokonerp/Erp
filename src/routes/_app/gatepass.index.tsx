import { createFileRoute, Link } from "@tanstack/react-router";
import { GatepassRecords } from "@/components/GatepassRecords";
import {
  Breadcrumb,
  BreadcrumbList,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";

export const Route = createFileRoute("/_app/gatepass/")({
  head: () => ({
    meta: [
      { title: "Gate Pass History — Prokon" },
      { name: "description", content: "View all gate pass records." },
    ],
  }),
  component: GatepassHistoryPage,
});

function GatepassHistoryPage() {
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
            <BreadcrumbPage>View Gate Pass History</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>
      <GatepassRecords />
    </div>
  );
}
