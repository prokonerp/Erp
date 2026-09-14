import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useAuth } from "@/lib/useAuth";
import { useIsEngineer } from "@/lib/useIsEngineer";
import { useMyQueue } from "@/hooks/useMyQueue";
import { useMyEmployee } from "@/hooks/useMyEmployee";
import { supabase } from "@/integrations/supabase/client";
import { recordLogout } from "@/lib/useActivityTracker";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { CardSkeleton } from "@/components/shared/skeletons";
import { Mail, Phone, LogOut } from "lucide-react";

export const Route = createFileRoute("/eng/profile")({
  component: EngProfile,
});

function EngProfile() {
  const { session } = useAuth();
  const { isEngineer, loading: roleLoading } = useIsEngineer();
  const { employee, initials, isLoading: employeeLoading, error: employeeError } = useMyEmployee();
  const { data: tickets = [], isLoading: queueLoading, isError: queueError } = useMyQueue();
  const navigate = useNavigate();
  const [loggingOut, setLoggingOut] = useState(false);

  if (roleLoading || employeeLoading || queueLoading) {
    return (
      <div className="max-w-2xl mx-auto space-y-3">
        <CardSkeleton />
        <CardSkeleton />
      </div>
    );
  }

  const email = employee?.email ?? session?.user?.email ?? "—";
  const displayName = employee?.name?.trim() ? employee.name : email;
  const phone = employee?.phone?.trim() ? employee.phone : null;
  const waiting = tickets.filter((t) => t.status === "Waiting for Parts").length;

  const handleLogout = async () => {
    setLoggingOut(true);
    try {
      await recordLogout();
      await supabase.auth.signOut();
      navigate({ to: "/auth" });
    } finally {
      setLoggingOut(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto space-y-3">
      <Card>
        <CardContent className="p-4 flex items-center gap-3">
          <span
            aria-hidden="true"
            className="h-11 w-11 shrink-0 rounded-full bg-primary flex items-center justify-center"
          >
            <span className="text-[15px] font-semibold text-primary-foreground">
              {initials || "–"}
            </span>
          </span>
          <div className="min-w-0 flex-1 space-y-1">
            <p className="text-[18px] font-semibold truncate">{displayName}</p>
            <p className="text-[13px] text-muted-foreground">
              {isEngineer ? "Field Engineer" : "No engineer role — contact admin"}
            </p>
            <p className="flex items-center gap-1.5 text-[13px] text-muted-foreground truncate">
              <Mail className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span className="truncate">{email}</span>
            </p>
            {phone ? (
              <p className="flex items-center gap-1.5 text-[13px] text-muted-foreground">
                <Phone className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                <a
                  href={`tel:${phone.replace(/\s+/g, "")}`}
                  className="min-h-[44px] inline-flex items-center underline-offset-2 hover:underline"
                >
                  {phone}
                </a>
              </p>
            ) : null}
            {employeeError || queueError ? (
              <p role="alert" className="text-[13px] text-muted-foreground">
                Some details couldn’t load — showing what’s available.
              </p>
            ) : null}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-4 grid grid-cols-2 gap-3 text-center">
          <Link
            to="/eng/queue"
            aria-label={`${tickets.length} assigned calls — view queue`}
            className="min-h-[44px] flex flex-col items-center justify-center rounded-md"
          >
            <p className="text-[20px] font-semibold tabular-nums">{tickets.length}</p>
            <p className="text-xs text-muted-foreground">Assigned calls</p>
          </Link>
          <Link
            to="/eng/queue"
            aria-label={`${waiting} waiting for parts — view queue`}
            className="min-h-[44px] flex flex-col items-center justify-center rounded-md"
          >
            <p className="text-[20px] font-semibold tabular-nums">{waiting}</p>
            <p className="text-xs text-muted-foreground">Waiting for Parts</p>
          </Link>
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground text-center px-4">
        Read-only portal. Status changes, reassignment and closures are handled by Services and
        Admin.
      </p>

      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button variant="outline" className="w-full min-h-[44px] h-auto" disabled={loggingOut}>
            <LogOut className="h-4 w-4" /> {loggingOut ? "Logging out…" : "Log out"}
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Log out?</AlertDialogTitle>
            <AlertDialogDescription>
              You’ll be signed out of the engineer portal on this device.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="min-h-[44px]">Stay signed in</AlertDialogCancel>
            <AlertDialogAction onClick={handleLogout} className="min-h-[44px]">
              Log out
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
