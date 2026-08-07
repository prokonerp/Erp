import { Input } from "@/components/ui/input";

/**
 * Serial entry for a GRN material row.
 * Qty 1 → a single serial field. Qty > 1 → one field per unit, so inventory
 * can create one stock row per serial (never a comma-joined bundle).
 */
export function GrnSerialInputs({
  qty,
  serials,
  serialNo,
  readOnly,
  onChange,
}: {
  qty: number;
  serials?: string[];
  serialNo?: string;
  readOnly?: boolean;
  onChange: (patch: { serials: string[]; serial_no: string }) => void;
}) {
  const count = Math.max(1, Math.floor(qty) || 1);
  const base =
    serials && serials.length
      ? serials
      : (serialNo || "").split(",").map((s) => s.trim()).filter(Boolean);
  const list = Array.from({ length: count }, (_, i) => base[i] ?? "");

  const set = (i: number, v: string) => {
    const next = [...list];
    next[i] = v;
    onChange({ serials: next, serial_no: next.map((s) => s.trim()).filter(Boolean).join(", ") });
  };

  return (
    <div className="space-y-1">
      {list.map((v, i) => (
        <Input
          key={i}
          value={v}
          readOnly={readOnly}
          className={readOnly ? "bg-muted/40" : ""}
          placeholder={count > 1 ? `Serial ${i + 1} of ${count}` : "Serial no"}
          onChange={(e) => set(i, e.target.value)}
        />
      ))}
      {count > 1 && !readOnly && (
        <p className="text-[10px] text-muted-foreground">One serial per unit (qty {count})</p>
      )}
    </div>
  );
}
