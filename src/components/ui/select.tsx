"use client";

import * as React from "react";
import { Check, ChevronDown, ChevronUp } from "lucide-react";
import { cn } from "@/lib/utils";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";

/**
 * Searchable Select — drop-in replacement for the shadcn/Radix Select API.
 * Renders a Popover + Command (cmdk) under the hood so every dropdown in the
 * app gains real-time search, keyboard navigation and accessible focus.
 *
 * Supported usage (unchanged from prior code):
 *   <Select value={v} onValueChange={setV}>
 *     <SelectTrigger><SelectValue placeholder="…" /></SelectTrigger>
 *     <SelectContent>
 *       <SelectGroup>
 *         <SelectLabel>Group</SelectLabel>
 *         <SelectItem value="a">Label A</SelectItem>
 *         <SelectSeparator />
 *         <SelectItem value="b">Label B</SelectItem>
 *       </SelectGroup>
 *     </SelectContent>
 *   </Select>
 */

type Ctx = {
  value: string | undefined;
  setValue: (v: string) => void;
  open: boolean;
  setOpen: (o: boolean) => void;
  labelMap: Map<string, React.ReactNode>;
  disabled?: boolean;
};
const SelectCtx = React.createContext<Ctx | null>(null);
const useSelectCtx = () => {
  const c = React.useContext(SelectCtx);
  if (!c) throw new Error("Select.* must be used within <Select>");
  return c;
};

function nodeToText(node: React.ReactNode): string {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(nodeToText).join(" ");
  if (React.isValidElement(node)) return nodeToText((node.props as any).children);
  return "";
}

function buildLabelMap(
  children: React.ReactNode,
  map: Map<string, React.ReactNode> = new Map(),
): Map<string, React.ReactNode> {
  React.Children.forEach(children, (child) => {
    if (!React.isValidElement(child)) return;
    const t: any = child.type;
    const props: any = child.props;
    if (t === SelectItem) {
      map.set(String(props.value), props.children);
    } else if (props?.children) {
      buildLabelMap(props.children, map);
    }
  });
  return map;
}

type SelectProps = {
  value?: string;
  defaultValue?: string;
  onValueChange?: (v: string) => void;
  open?: boolean;
  onOpenChange?: (o: boolean) => void;
  disabled?: boolean;
  required?: boolean;
  name?: string;
  children?: React.ReactNode;
};

const Select: React.FC<SelectProps> = ({
  value,
  defaultValue,
  onValueChange,
  open,
  onOpenChange,
  disabled,
  children,
}) => {
  const [innerVal, setInnerVal] = React.useState<string | undefined>(defaultValue);
  const [innerOpen, setInnerOpen] = React.useState(false);
  const val = value !== undefined ? value : innerVal;
  const setVal = React.useCallback(
    (v: string) => {
      if (value === undefined) setInnerVal(v);
      onValueChange?.(v);
    },
    [value, onValueChange],
  );
  const isOpen = open !== undefined ? open : innerOpen;
  const setOpen = React.useCallback(
    (o: boolean) => {
      if (open === undefined) setInnerOpen(o);
      onOpenChange?.(o);
    },
    [open, onOpenChange],
  );
  const labelMap = React.useMemo(() => buildLabelMap(children), [children]);

  return (
    <SelectCtx.Provider value={{ value: val, setValue: setVal, open: isOpen, setOpen, labelMap, disabled }}>
      <Popover open={isOpen} onOpenChange={(o) => !disabled && setOpen(o)}>
        {children}
      </Popover>
    </SelectCtx.Provider>
  );
};

const SelectTrigger = React.forwardRef<HTMLButtonElement, React.ButtonHTMLAttributes<HTMLButtonElement>>(
  ({ className, children, ...props }, ref) => {
    const { disabled, value } = useSelectCtx();
    return (
      <PopoverTrigger asChild>
        <button
          ref={ref}
          type="button"
          disabled={disabled}
          data-placeholder={value === undefined || value === "" ? "" : undefined}
          className={cn(
            "flex h-9 w-full items-center justify-between whitespace-nowrap rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm ring-offset-background cursor-pointer data-[placeholder]:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50 [&>span]:line-clamp-1",
            className,
          )}
          {...props}
        >
          <span className="flex-1 text-left truncate">{children}</span>
          <ChevronDown className="h-4 w-4 opacity-50 ml-2 shrink-0" />
        </button>
      </PopoverTrigger>
    );
  },
);
SelectTrigger.displayName = "SelectTrigger";

type SelectValueProps = { placeholder?: React.ReactNode; className?: string; children?: React.ReactNode };
const SelectValue: React.FC<SelectValueProps> = ({ placeholder, className, children }) => {
  const { value, labelMap } = useSelectCtx();
  const label = value !== undefined && value !== "" ? labelMap.get(String(value)) : undefined;
  if (label !== undefined && label !== null && label !== "") {
    return <span className={cn("truncate", className)}>{label}</span>;
  }
  return <span className={cn("text-muted-foreground truncate", className)}>{children ?? placeholder}</span>;
};

// ---- Marker components (rendered via extraction inside SelectContent) ----
type SelectItemProps = {
  value: string;
  children?: React.ReactNode;
  disabled?: boolean;
  className?: string;
};
const SelectItem: React.FC<SelectItemProps> = () => null;
SelectItem.displayName = "SelectItem";

const SelectGroup: React.FC<{ children?: React.ReactNode }> = ({ children }) => <>{children}</>;
SelectGroup.displayName = "SelectGroup";

const SelectLabel: React.FC<{ children?: React.ReactNode; className?: string }> = () => null;
SelectLabel.displayName = "SelectLabel";

const SelectSeparator: React.FC<{ className?: string }> = () => null;
SelectSeparator.displayName = "SelectSeparator";

const SelectScrollUpButton: React.FC<{ className?: string }> = () => null;
const SelectScrollDownButton: React.FC<{ className?: string }> = () => null;

// ---- SelectContent (renders Command with extracted items) ----
type ExtractedItem =
  | { kind: "item"; value: string; node: React.ReactNode; text: string; disabled?: boolean }
  | { kind: "label"; node: React.ReactNode }
  | { kind: "separator" };

function extractItems(children: React.ReactNode, into: ExtractedItem[] = []): ExtractedItem[] {
  React.Children.forEach(children, (child) => {
    if (!React.isValidElement(child)) return;
    const t: any = child.type;
    const props: any = child.props;
    if (t === SelectItem) {
      into.push({
        kind: "item",
        value: String(props.value),
        node: props.children,
        text: nodeToText(props.children),
        disabled: props.disabled,
      });
    } else if (t === SelectLabel) {
      into.push({ kind: "label", node: props.children });
    } else if (t === SelectSeparator) {
      into.push({ kind: "separator" });
    } else if (t === SelectGroup || t === React.Fragment) {
      extractItems(props.children, into);
    } else if (props?.children) {
      // Permissive recurse so wrapped items still register
      extractItems(props.children, into);
    }
  });
  return into;
}

const SelectContent: React.FC<{
  className?: string;
  children?: React.ReactNode;
  position?: string;
  searchable?: boolean;
  searchPlaceholder?: string;
  align?: "start" | "center" | "end";
}> = ({ className, children, searchable, searchPlaceholder = "Search…", align = "start" }) => {
  const { value, setValue, setOpen } = useSelectCtx();
  const items = React.useMemo(() => extractItems(children), [children]);
  const itemCount = items.filter((i) => i.kind === "item").length;
  const showSearch = searchable ?? itemCount > 5;

  return (
    <PopoverContent
      align={align}
      sideOffset={4}
      className={cn(
        "p-0 w-[var(--radix-popover-trigger-width)] min-w-[var(--radix-popover-trigger-width)] max-h-[min(360px,var(--radix-popover-content-available-height))]",
        className,
      )}
      onOpenAutoFocus={(e) => {
        // Let cmdk's input take focus naturally when searchable; otherwise focus the list
        if (!showSearch) e.preventDefault();
      }}
    >
      <Command
        loop
        filter={(val, search) => {
          const s = search.toLowerCase().trim();
          if (!s) return 1;
          return val.toLowerCase().includes(s) ? 1 : 0;
        }}
      >
        {showSearch && <CommandInput placeholder={searchPlaceholder} className="h-9" />}
        <CommandList className="max-h-[300px]">
          <CommandEmpty>No results.</CommandEmpty>
          {items.map((it, idx) => {
            if (it.kind === "label") {
              return (
                <div key={`l-${idx}`} className="px-2 py-1.5 text-xs font-semibold text-muted-foreground">
                  {it.node}
                </div>
              );
            }
            if (it.kind === "separator") return <CommandSeparator key={`s-${idx}`} />;
            return (
              <CommandItem
                key={`i-${it.value}-${idx}`}
                value={`${it.text} ${it.value}`}
                disabled={it.disabled}
                onSelect={() => {
                  setValue(it.value);
                  setOpen(false);
                }}
                className="cursor-pointer"
              >
                <Check className={cn("mr-2 h-4 w-4 shrink-0", value === it.value ? "opacity-100" : "opacity-0")} />
                <span className="flex-1 truncate">{it.node}</span>
              </CommandItem>
            );
          })}
        </CommandList>
      </Command>
    </PopoverContent>
  );
};
SelectContent.displayName = "SelectContent";

// Suppress unused-import warning for ChevronUp (kept for API parity with shadcn imports)
void ChevronUp;

export {
  Select,
  SelectGroup,
  SelectValue,
  SelectTrigger,
  SelectContent,
  SelectLabel,
  SelectItem,
  SelectSeparator,
  SelectScrollUpButton,
  SelectScrollDownButton,
};
