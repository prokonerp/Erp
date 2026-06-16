export type ModuleKey =
  | "customers"
  | "products"
  | "tickets"
  | "indent"
  | "amc"
  | "gatepass"
  | "reports"
  | "quotations";

export const MODULES: { key: ModuleKey; label: string }[] = [
  { key: "customers", label: "Customers" },
  { key: "products", label: "Products" },
  { key: "tickets", label: "Tickets" },
  { key: "indent", label: "INDENT" },
  { key: "amc", label: "AMC" },
  { key: "gatepass", label: "Gatepass" },
  { key: "quotations", label: "Quotations" },
  { key: "reports", label: "Reports" },
];

export type Action = "access" | "read" | "create" | "edit" | "delete";

export type ModulePerm = {
  enable_access: boolean;
  can_read: boolean;
  can_create: boolean;
  can_edit: boolean;
  can_delete: boolean;
};

export const EMPTY_PERM: ModulePerm = {
  enable_access: false,
  can_read: false,
  can_create: false,
  can_edit: false,
  can_delete: false,
};

export const FULL_PERM: ModulePerm = {
  enable_access: true,
  can_read: true,
  can_create: true,
  can_edit: true,
  can_delete: true,
};

export function actionCol(a: Action): keyof ModulePerm {
  switch (a) {
    case "access":
      return "enable_access";
    case "read":
      return "can_read";
    case "create":
      return "can_create";
    case "edit":
      return "can_edit";
    case "delete":
      return "can_delete";
  }
}