// Module keys are strings — the list is loaded dynamically from
// `public.app_modules`. See `useModules()`.
export type ModuleKey = string;

// Fallback list used only when the modules registry is empty / loading.
export const FALLBACK_MODULES: { key: ModuleKey; label: string; supports_import?: boolean }[] = [
  { key: "customers", label: "Customers", supports_import: true },
  { key: "products", label: "Products", supports_import: true },
  { key: "tickets", label: "Tickets", supports_import: true },
  { key: "indent", label: "Indent" },
  { key: "amc", label: "AMC", supports_import: true },
  { key: "gatepass", label: "Gatepass" },
  { key: "quotations", label: "Quotations" },
  { key: "reports", label: "Reports" },
];

export type Action =
  | "access"
  | "read"
  | "create"
  | "edit"
  | "delete"
  | "export"
  | "import";

export type ModulePerm = {
  enable_access: boolean;
  can_read: boolean;
  can_create: boolean;
  can_edit: boolean;
  can_delete: boolean;
  can_export: boolean;
  can_import: boolean;
};

export const EMPTY_PERM: ModulePerm = {
  enable_access: false,
  can_read: false,
  can_create: false,
  can_edit: false,
  can_delete: false,
  can_export: false,
  can_import: false,
};

export const FULL_PERM: ModulePerm = {
  enable_access: true,
  can_read: true,
  can_create: true,
  can_edit: true,
  can_delete: true,
  can_export: true,
  can_import: true,
};

export function actionCol(a: Action): keyof ModulePerm {
  switch (a) {
    case "access": return "enable_access";
    case "read":   return "can_read";
    case "create": return "can_create";
    case "edit":   return "can_edit";
    case "delete": return "can_delete";
    case "export": return "can_export";
    case "import": return "can_import";
  }
}