import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Download, FileSpreadsheet, FileText, Sheet } from "lucide-react";
import { exportCSV, exportExcel, exportPDF, type ExportColumn } from "@/lib/exports";

type Props<T> = {
  name: string;
  title?: string;
  rows: T[];
  columns: ExportColumn<T>[];
  disabled?: boolean;
};

export function ExportButtons<T>({ name, title, rows, columns, disabled }: Props<T>) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" disabled={disabled || rows.length === 0}>
          <Download className="h-4 w-4 mr-1" />Export
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => exportExcel(name, columns, rows)}>
          <FileSpreadsheet className="h-4 w-4 mr-2" />Excel (.xlsx)
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => exportCSV(name, columns, rows)}>
          <Sheet className="h-4 w-4 mr-2" />CSV (.csv)
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => exportPDF(name, columns, rows, title)}>
          <FileText className="h-4 w-4 mr-2" />PDF (.pdf)
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}