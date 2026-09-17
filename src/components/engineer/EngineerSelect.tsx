import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export function EngineerSelect({
  id,
  label,
  value,
  onChange,
  engineers,
  allowAll,
  allLabel,
  placeholder,
  disabled,
}: {
  id: string;
  label?: string;
  value: string;
  onChange: (id: string) => void;
  engineers: { employee_id: string; name: string | null }[];
  allowAll?: boolean;
  allLabel?: string;
  placeholder?: string;
  disabled?: boolean;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label ?? "Engineer"}</Label>
      <Select value={value} onValueChange={onChange} disabled={disabled}>
        <SelectTrigger id={id}>
          <SelectValue placeholder={placeholder ?? "All engineers"} />
        </SelectTrigger>
        <SelectContent>
          {allowAll && <SelectItem value="all">{allLabel ?? "All engineers"}</SelectItem>}
          {engineers.map((e) => (
            <SelectItem key={e.employee_id} value={e.employee_id}>
              {e.name && e.name.trim() !== "" ? e.name : e.employee_id}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
