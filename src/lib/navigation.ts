/**
 * Single source of truth for sidebar navigation + command palette.
 * Pure data — no React, no hooks — so both the layout and the palette
 * can import it without circular deps.
 */

import {
  LayoutDashboard,
  Building2,
  Store,
  Warehouse,
  Users,
  Truck,
  Package,
  MonitorCheck,
  IdCard,
  Wallet,
  Boxes,
  Ticket,
  ShieldCheck,
  Briefcase,
  Receipt,
  FileSpreadsheet,
  PackageCheck,
  FileText,
  ClipboardList,
  BarChart3,
  Search,
  Upload,
  Archive,
  type LucideIcon,
} from "lucide-react";
import type { ModuleKey } from "./permissions";

export type NavItem = {
  to: string;
  label: string;
  icon: LucideIcon;
  search?: Record<string, string>;
  module?: ModuleKey;
  adminOnly?: boolean;
  group?: string;
  matchSearchTab?: string;
};

export const NAV_ITEMS: NavItem[] = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  {
    to: "/masters",
    label: "Company",
    icon: Building2,
    module: "customers",
    group: "Masters",
    search: { tab: "company" },
    matchSearchTab: "company",
  },
  {
    to: "/masters",
    label: "Branches",
    icon: Store,
    module: "customers",
    group: "Masters",
    search: { tab: "branches" },
    matchSearchTab: "branches",
  },
  {
    to: "/masters",
    label: "Warehouses",
    icon: Warehouse,
    module: "customers",
    group: "Masters",
    search: { tab: "warehouses" },
    matchSearchTab: "warehouses",
  },
  {
    to: "/masters/customers",
    label: "Customers",
    icon: Users,
    module: "customers",
    group: "Masters",
  },
  {
    to: "/masters",
    label: "Vendors",
    icon: Truck,
    module: "customers",
    group: "Masters",
    search: { tab: "vendors" },
    matchSearchTab: "vendors",
  },
  {
    to: "/masters/products",
    label: "Products",
    icon: Package,
    module: "customers",
    group: "Masters",
  },
  {
    to: "/installed-equipment",
    label: "Installed Equipment",
    icon: MonitorCheck,
    module: "customers",
    group: "Masters",
  },
  {
    to: "/masters",
    label: "Employees",
    icon: IdCard,
    module: "employees",
    group: "Masters",
    search: { tab: "employees" },
    matchSearchTab: "employees",
  },
  {
    to: "/payroll",
    label: "Salary & Attendance",
    icon: Wallet,
    module: "payroll",
    group: "Masters",
  },
  {
    to: "/masters",
    label: "Inventory",
    icon: Boxes,
    module: "customers",
    group: "Masters",
    search: { tab: "inventory" },
    matchSearchTab: "inventory",
  },
  {
    to: "/masters",
    label: "Accounts",
    icon: Wallet,
    module: "customers",
    group: "Masters",
    search: { tab: "accounts" },
    matchSearchTab: "accounts",
  },
  {
    to: "/masters",
    label: "Users & Roles",
    icon: IdCard,
    module: "customers",
    group: "Masters",
    search: { tab: "users" },
    matchSearchTab: "users",
  },
  {
    to: "/tickets",
    label: "Service Desk (Tickets)",
    icon: Ticket,
    module: "tickets",
    group: "Service Desk",
  },
  { to: "/amc", label: "Contracts (AMC)", icon: ShieldCheck, module: "amc", group: "Service Desk" },
  {
    to: "/crm",
    label: "Customers (Sales & CRM)",
    icon: Briefcase,
    module: "quotations",
    group: "Customers",
  },
  { to: "/sales", label: "Head Sales", icon: Receipt, module: "sales", group: "Sales" },
  {
    to: "/sales/quotations",
    label: "Quotations",
    icon: FileSpreadsheet,
    module: "quotations",
    group: "Sales",
  },
  {
    to: "/sales/general-dc",
    label: "General DC",
    icon: PackageCheck,
    module: "general_dc",
    group: "Sales",
  },
  { to: "/sales/invoices", label: "Invoices", icon: FileText, module: "sales", group: "Sales" },
  { to: "/sales/payments", label: "Payments", icon: Wallet, module: "sales", group: "Sales" },
  { to: "/sales/eway", label: "e-Way Bills", icon: Truck, module: "sales", group: "Sales" },
  {
    to: "/sales/settings",
    label: "Sales Settings",
    icon: IdCard,
    module: "sales",
    group: "Sales",
    adminOnly: true,
  },
  {
    to: "/indent",
    label: "Purchase Requests (Indent)",
    icon: ClipboardList,
    module: "indent",
    group: "Procurement",
  },
  { to: "/po", label: "Purchase Orders", icon: FileText, module: "po", group: "Procurement" },
  { to: "/ims", label: "Inventory (IMS)", icon: Warehouse, module: "ims", group: "Inventory" },
  {
    to: "/ims/defective-tags",
    label: "Defective Tags",
    icon: Truck,
    module: "ims",
    group: "Inventory",
  },
  { to: "/reports", label: "Reports", icon: BarChart3, module: "reports", group: "Intelligence" },
  {
    to: "/ims/serial-track",
    label: "Serial Track",
    icon: Search,
    module: "ims",
    group: "Intelligence",
  },
  { to: "/import", label: "Data Import", icon: Upload, adminOnly: true, group: "System" },
  {
    to: "/archive",
    label: "Archive (Deleted Records)",
    icon: Archive,
    adminOnly: true,
    group: "System",
  },
];

/** Quick-create actions used by the command palette and dashboard. */
export type QuickAction = {
  label: string;
  to: string;
  module: ModuleKey | "*";
  icon: LucideIcon;
  adminOnly?: boolean;
  search?: Record<string, string>;
};

export const QUICK_ACTIONS: QuickAction[] = [
  { label: "New Ticket", to: "/tickets/new", module: "tickets", icon: Ticket },
  { label: "New AMC", to: "/amc/new", module: "amc", icon: ShieldCheck },
  { label: "New Indent", to: "/indent/new", module: "indent", icon: ClipboardList },
  { label: "New Quotation", to: "/crm/quotations", module: "quotations", icon: Briefcase },
  { label: "New Gatepass", to: "/gatepass/new", module: "gatepass", icon: FileText },
  { label: "New Delivery Challan", to: "/challan/new", module: "gatepass", icon: PackageCheck },
  { label: "New GRN", to: "/grn/new", module: "gatepass", icon: PackageCheck },
  { label: "New Invoice", to: "/sales/invoices/new", module: "sales", icon: Receipt },
  { label: "New Customer", to: "/masters/customers", module: "customers", icon: Users },
  { label: "New Product", to: "/masters/products", module: "customers", icon: Package },
];

export const GROUP_ORDER = [
  "Masters",
  "Service Desk",
  "Customers",
  "Sales",
  "Procurement",
  "Material Movement",
  "Inventory",
  "Intelligence",
  "System",
];

/** Returns the group name that the given pathname belongs to, or null. */
export function groupForPath(pathname: string): string | null {
  for (const item of NAV_ITEMS) {
    if (pathname === item.to || pathname.startsWith(item.to + "/")) {
      return item.group ?? null;
    }
  }
  return null;
}
