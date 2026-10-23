import { useId } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { isPlaceholderSerial, sanitizeSerial } from "@/lib/serial";

/**
 * One serial input with the firm's identity rule: a value must contain a
 * letter or digit. Punctuation-only placeholders (",", ".", "..") are cleared
 * on blur and flagged inline, so they can never reach a save path. Real
 * values are upper-trimmed on blur, matching `sanitizeSerial()` / SQL.
 */
export function SerialField({
  id,
  label,
  value,
  onChange,
  onBlur,
  placeholder = "Serial no",
  disabled,
  readOnly,
  required,
  className,
  inputClassName,
  hint,
  autoFocus,
  list,
  allowPlaceholder = false,
}: {
  id?: string;
  label?: string;
  value: string;
  onChange: (v: string) => void;
  onBlur?: () => void;
  placeholder?: string;
  disabled?: boolean;
  readOnly?: boolean;
  required?: boolean;
  className?: string;
  inputClassName?: string;
  hint?: string;
  autoFocus?: boolean;
  list?: string;
  /** Correction dialogs must be able to name an existing junk value (","). */
  allowPlaceholder?: boolean;
}) {
  const autoId = useId();
  const fieldId = id ?? autoId;
  const warning = !readOnly && !allowPlaceholder && isPlaceholderSerial(value);
  const messageId = `${fieldId}-serial-message`;
  const message = warning
    ? "Not a serial — use at least one letter or digit. It will be cleared on blur."
    : hint;

  return (
    <div className={cn("space-y-1", className)}>
      {label && (
        <Label htmlFor={fieldId}>
          {label}
          {required && <span className="ml-0.5 text-destructive">*</span>}
        </Label>
      )}
      <Input
        id={fieldId}
        list={list}
        value={value}
        placeholder={placeholder}
        disabled={disabled}
        readOnly={readOnly}
        autoFocus={autoFocus}
        autoComplete="off"
        spellCheck={false}
        aria-invalid={warning || undefined}
        aria-describedby={message ? messageId : undefined}
        className={cn(
          "font-mono",
          warning && "border-amber-500 focus-visible:ring-amber-500",
          inputClassName,
        )}
        onChange={(e) => onChange(e.target.value)}
        onBlur={() => {
          if (!allowPlaceholder) {
            const clean = sanitizeSerial(value);
            if (clean !== value) onChange(clean);
          }
          onBlur?.();
        }}
      />
      {message && (
        <p
          id={messageId}
          className={cn(
            "text-[11px] leading-snug",
            warning ? "text-amber-700" : "text-muted-foreground",
          )}
        >
          {message}
        </p>
      )}
    </div>
  );
}
