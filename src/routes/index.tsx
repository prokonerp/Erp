import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useAuth } from "@/lib/useAuth";

export const Route = createFileRoute("/")({
  component: Index,
});

function Index() {
  const { session, loading } = useAuth();
  if (loading) return <div className="p-8 text-muted-foreground">Loading…</div>;
  return <Navigate to={session ? "/dashboard" : "/auth"} />;
}
