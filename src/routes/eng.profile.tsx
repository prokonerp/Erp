import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useAuth } from "@/lib/useAuth";
import { useIsEngineer } from "@/lib/useIsEngineer";
import { useMyQueue } from "@/hooks/useMyQueue";
import { supabase } from "@/integrations/supabase/client";
import { recordLogout } from "@/lib/useActivityTracker";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CardSkeleton } from "@/components/shared/skeletons";
import { User, LogOut } from "lucide-react";

export const Route = createFileRoute("/eng/profile")({
  component: EngProfile,
});

function EngProfile() {
  const { session } = useAuth();
  const { isEngineer, loading: roleLoading } = useIsEngineer();
  const { data: tickets = [], isLoading: queueLoading } = useMyQueue();
  const navigate = useNavigate();

  if (roleLoading || queueLoading) {
    return (
      <div className="max-w-2xl mx-auto space-y-3">
        <CardSkeleton />
        <CardSkeleton />
      </div>
    );
  }

  const email = session?.user?.email ?? "—";
  const waiting = tickets.filter((t) => t.status === "Waiting for Parts").length;

  const handleLogout = async () => {
    await recordLogout();
    await supabase.auth.signOut();
    navigate({ to: "/auth" });
  };

  return (
    <div className="max-w-2xl mx-auto space-y-3">
      <Card>
        <CardContent className="p-4 flex items-center gap-3">
          <span className="h-10 w-10 rounded-full bg-muted flex items-center justify-center">
            <User className="h-5 w-5 text-muted-foreground" />
          </span>
          <div className="min-w-0 space-y-1">
            <p className="text-[18px] font-semibold truncate">{email}</p>
            <p className="text-[13px] text-muted-foreground">
              {isEngineer ? "Field Engineer" : "No engineer role — contact admin"}
            </p>
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

      <Button variant="outline" onClick={handleLogout} className="w-full min-h-[44px] h-auto">
        <LogOut className="h-4 w-4" /> Log out
      </Button>
    </div>
  );
}
