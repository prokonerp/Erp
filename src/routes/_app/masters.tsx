import { createFileRoute, Link, useLocation, useNavigate } from "@tanstack/react-router";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { MasterCrud } from "@/components/MasterCrud";
import { CustomerMasterPage } from "./masters.customers";
import { ProductMasterPage } from "./masters.products";
import { useIsAdmin } from "@/lib/useRole";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ShieldCheck, ExternalLink } from "lucide-react";
import { UserRolesPanel } from "@/components/UserRolesPanel";

export const Route = createFileRoute("/_app/masters")({
  component: MastersPage,
});

function MastersPage() {
  const { isAdmin, loading, hasAnyAdmin, claimAdmin } = useIsAdmin();
  const navigate = useNavigate();
  const location = useLocation();
  const isCustomerRoute = location.pathname === "/masters/customers";
  const isProductRoute = location.pathname === "/masters/products";
  const routedTab = isCustomerRoute ? "customers" : isProductRoute ? "products" : null;
  const [tab, setTab] = useState<string>(routedTab ?? "company");
  useEffect(() => {
    if (routedTab) setTab(routedTab);
  }, [routedTab]);
  const currentTab = routedTab ?? tab;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold">Masters</h1>
          <p className="text-sm text-muted-foreground">Central data: company, customers, vendors, products, employees, inventory, accounts, AMC and tickets.</p>
        </div>
        <div className="text-xs text-muted-foreground flex items-center gap-1">
          <ShieldCheck className="h-4 w-4" />
          {loading ? "Checking role…" : isAdmin ? "Admin — full edit access" : "Read-only (admin can edit)"}
        </div>
      </div>

      {!loading && !hasAnyAdmin && (
        <Alert>
          <AlertDescription className="flex items-center justify-between gap-3">
            <span>No admin exists yet. Claim admin to manage masters.</span>
            <Button size="sm" onClick={async () => {
              const { error } = await claimAdmin();
              if (error) alert(error);
              else window.location.reload();
            }}>Claim admin</Button>
          </AlertDescription>
        </Alert>
      )}

      <Tabs
        value={currentTab}
        className="w-full"
        onValueChange={(v) => {
          setTab(v);
          if (v === "customers") navigate({ to: "/masters/customers" });
          else if (v === "products") navigate({ to: "/masters/products" });
          else if (isCustomerRoute || isProductRoute) navigate({ to: "/masters" });
        }}
      >
        <TabsList className="flex flex-wrap h-auto">
          <TabsTrigger value="company">Company</TabsTrigger>
          <TabsTrigger value="branches">Branches</TabsTrigger>
          <TabsTrigger value="warehouses">Warehouses</TabsTrigger>
          <TabsTrigger value="customers">Customers</TabsTrigger>
          <TabsTrigger value="vendors">Vendors</TabsTrigger>
          <TabsTrigger value="products">Products</TabsTrigger>
          <TabsTrigger value="service">Service / Tickets</TabsTrigger>
          <TabsTrigger value="employees">Employees</TabsTrigger>
          <TabsTrigger value="inventory">Inventory</TabsTrigger>
          <TabsTrigger value="accounts">Accounts</TabsTrigger>
          <TabsTrigger value="amc">AMC</TabsTrigger>
          <TabsTrigger value="users">Users &amp; Roles</TabsTrigger>
        </TabsList>

        <TabsContent value="company" className="mt-4">
          <MasterCrud
            table="companies"
            title="Company Master"
            canEdit={isAdmin}
            fields={[
              { key: "name", label: "Company Name", type: "title", required: true },
              { key: "gstin", label: "GSTIN", type: "upper" },
              { key: "phone", label: "Phone", type: "phone" },
              { key: "email", label: "Email", type: "email" },
              { key: "website", label: "Website", type: "text" },
              { key: "address", label: "Address", type: "textarea" },
              { key: "notes", label: "Notes", type: "textarea", showInList: false },
            ]}
          />
        </TabsContent>

        <TabsContent value="branches" className="mt-4">
          <MasterCrud
            table="branches"
            title="Branches"
            canEdit={isAdmin}
            fields={[
              { key: "name", label: "Branch Name", type: "title", required: true },
              { key: "gstin", label: "GSTIN", type: "upper" },
              { key: "phone", label: "Phone", type: "phone" },
              { key: "address", label: "Address", type: "textarea" },
            ]}
          />
        </TabsContent>

        <TabsContent value="warehouses" className="mt-4">
          <MasterCrud
            table="warehouses"
            title="Warehouse Master"
            canEdit={isAdmin}
            fields={[
              { key: "code", label: "Warehouse Code", type: "upper", required: true },
              { key: "name", label: "Warehouse Name", type: "title", required: true },
              { key: "type", label: "Type (Godown / Store / Service Center / Transit)", type: "title" },
              { key: "status", label: "Status (Active / Inactive)", type: "title" },
              { key: "contact_person", label: "Contact Person", type: "title" },
              { key: "contact_number", label: "Contact Number", type: "phone" },
              { key: "email", label: "Email", type: "email" },
              { key: "city", label: "City", type: "title" },
              { key: "state", label: "State", type: "title" },
              { key: "pincode", label: "Pincode", type: "text" },
              { key: "address", label: "Address", type: "textarea" },
              { key: "remarks", label: "Remarks", type: "textarea", showInList: false },
            ]}
          />
        </TabsContent>

        <TabsContent value="customers" className="mt-4">
          <CustomerMasterPage />
        </TabsContent>

        <TabsContent value="vendors" className="mt-4">
          <MasterCrud
            table="vendors"
            title="Vendor Master"
            canEdit={isAdmin}
            fields={[
              { key: "name", label: "Vendor Name", type: "title", required: true },
              { key: "contact_name", label: "Contact Person", type: "title" },
              { key: "phone", label: "Phone", type: "phone" },
              { key: "email", label: "Email", type: "email" },
              { key: "gstin", label: "GSTIN", type: "upper" },
              { key: "payment_terms", label: "Payment Terms", type: "text" },
              { key: "address", label: "Address", type: "textarea" },
              { key: "notes", label: "Notes", type: "textarea", showInList: false },
            ]}
          />
        </TabsContent>

        <TabsContent value="products" className="mt-4">
          <ProductMasterPage />
        </TabsContent>

        <TabsContent value="service" className="mt-4">
          <LinkOut to="/tickets" label="Service / Complaint Master is managed in Tickets." />
        </TabsContent>

        <TabsContent value="employees" className="mt-4">
          <MasterCrud
            table="employees"
            title="Employee Master"
            canEdit={isAdmin}
            fields={[
              { key: "name", label: "Name", type: "title", required: true },
              { key: "role", label: "Role / Designation", type: "title" },
              { key: "department", label: "Department", type: "title" },
              { key: "phone", label: "Phone", type: "phone" },
              { key: "email", label: "Email", type: "email" },
              { key: "joining_date", label: "Joining Date", type: "date" },
              { key: "active", label: "Active", type: "boolean" },
              { key: "notes", label: "Notes", type: "textarea", showInList: false },
            ]}
          />
        </TabsContent>

        <TabsContent value="inventory" className="mt-4">
          <MasterCrud
            table="inventory"
            title="Inventory Master"
            canEdit={isAdmin}
            fields={[
              { key: "product_name", label: "Product", type: "title", required: true },
              { key: "warehouse", label: "Warehouse", type: "title" },
              { key: "quantity", label: "Quantity", type: "number" },
              { key: "serial_no", label: "Serial No.", type: "upper" },
              { key: "location", label: "Location / Rack", type: "text" },
              { key: "notes", label: "Notes", type: "textarea", showInList: false },
            ]}
          />
        </TabsContent>

        <TabsContent value="accounts" className="mt-4">
          <MasterCrud
            table="accounts_ledger"
            title="Accounts Master (Ledger)"
            canEdit={isAdmin}
            fields={[
              { key: "name", label: "Ledger Name", type: "title", required: true },
              { key: "type", label: "Type (Asset/Liability/Income/Expense)", type: "title" },
              { key: "opening_balance", label: "Opening Balance", type: "number" },
              { key: "gst", label: "GST", type: "upper" },
              { key: "notes", label: "Notes", type: "textarea", showInList: false },
            ]}
          />
        </TabsContent>

        <TabsContent value="amc" className="mt-4">
          <LinkOut to="/amc" label="AMC / Contract Master is managed in AMC." />
        </TabsContent>

        <TabsContent value="users" className="mt-4">
          <UserRolesPanel isAdmin={isAdmin} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function LinkOut({ to, label }: { to: string; label: string }) {
  return (
    <Card>
      <CardHeader><CardTitle className="text-base">{label}</CardTitle></CardHeader>
      <CardContent>
        <Link to={to}>
          <Button><ExternalLink className="h-4 w-4 mr-1" />Open module</Button>
        </Link>
      </CardContent>
    </Card>
  );
}