import { createFileRoute, Link } from "@tanstack/react-router";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { MasterCrud } from "@/components/MasterCrud";
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

      <Tabs defaultValue="company" className="w-full">
        <TabsList className="flex flex-wrap h-auto">
          <TabsTrigger value="company">Company</TabsTrigger>
          <TabsTrigger value="branches">Branches</TabsTrigger>
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

        <TabsContent value="customers" className="mt-4">
          <LinkOut to="/masters/customers" label="Open the dedicated Customer Master screen for full create / edit / import." />
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
          <LinkOut to="/products" label="Product / Item Master is managed in Products." />
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