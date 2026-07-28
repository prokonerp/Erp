import { AlertTriangle } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import type { DuplicateHit } from "@/lib/customerDuplicates";

type Props = {
  hit: DuplicateHit | null;
  onCancel: () => void;
  onView: (id: string) => void;
};

/** Hard duplicate block — shown when GSTIN / mobile already exists. */
export function DuplicateCustomerDialog({ hit, onCancel, onView }: Props) {
  return (
    <Dialog open={!!hit} onOpenChange={(o) => { if (!o) onCancel(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-destructive">
            <AlertTriangle className="h-5 w-5" /> Duplicate Customer Found
          </DialogTitle>
        </DialogHeader>
        {hit && (
          <div className="space-y-2 text-sm">
            <p className="text-muted-foreground">
              This {hit.matched_field === "gstin" ? "GSTIN" : "mobile number"} is already registered to an existing customer.
            </p>
            <div className="rounded-md border p-3 space-y-1">
              <Row label="Customer Name" value={hit.company} />
              <Row label="Customer Code" value={hit.customer_code || "—"} />
              <Row label={hit.matched_field === "gstin" ? "GSTIN" : "Mobile Number"} value={hit.matched_value || "—"} />
            </div>
          </div>
        )}
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onCancel}>Cancel</Button>
          <Button onClick={() => hit && onView(hit.existing_customer_id)}>View Existing Customer</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium text-right break-all">{value}</span>
    </div>
  );
}
