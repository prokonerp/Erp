import { createFileRoute } from "@tanstack/react-router";
import { useAuth } from "@/lib/useAuth";
import { useIsEngineer } from "@/lib/useIsEngineer";
import { useMyQueue } from "@/hooks/useMyQueue";
import { Card, CardContent } from "@/components/ui/card";
import { PageLoader } from "@/components/shared/skeletons";
import { User } from "lucide-react";

export const Route = createFileRoute("/eng/profile")({
  component: EngProfile,
});

function EngProfile() {
  const { session } = useAuth();
  const { isEngineer, loading: roleLoading } = useIsEngineer();
  const { data: tickets = [], isLoading: queueLoading } = useMyQueue();

  if (roleLoading || queueLoading) {
    return <PageLoader label="Loading profile…" />;
  }

  const email = session?.user?.email ?? "—";
  const waiting = tickets.filter((t) => t.status === "Waiting for Parts").length;

  return (
    <div className="max-w-2xl mx-auto space-y-4">
      <Card>
        <CardContent className="py-4 flex items-center gap-3">
          <span className="h-10 w-10 rounded-full bg-muted flex items-center justify-center">
            <User className="h-5 w-5 text-muted-foreground" />
          </span>
          <div className="min-w-0">
            <p className="font-medium truncate">{email}</p>
            <p className="text-xs text-muted-foreground">
              {isEngineer ? "Field Engineer" : "No engineer role — contact admin"}
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="py-4 grid grid-cols-2 gap-3 text-center">
          <div>
            <p className="text-2xl font-semibold">{tickets.length}</p>
            <p className="text-xs text-muted-foreground">Assigned calls</p>
          </div>
          <div>
            <p className="text-2xl font-semibold">{waiting}</p>
            <p className="text-xs text-muted-foreground">Waiting for Parts</p>
          </div>
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground text-center px-4">
        Read-only portal. Status changes, reassignment and closures are handled by Services and
        Admin.
      </p>
    </div>
  );
}
