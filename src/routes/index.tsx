import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useAuth } from "@/lib/useAuth";
import { PageLoader } from "@/components/shared/skeletons";

export const Route = createFileRoute("/")({
  component: Index,
});

function Index() {
  const { session, loading } = useAuth();
  if (loading) return <PageLoader />;
  return <Navigate to={session ? "/dashboard" : "/auth"} />;
}
