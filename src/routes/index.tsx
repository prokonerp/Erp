import { createFileRoute } from "@tanstack/react-router";
import { useAuth } from "@/lib/useAuth";
import { PageLoader } from "@/components/shared/skeletons";
import { SafeNavigate } from "@/components/SafeNavigate";

export const Route = createFileRoute("/")({
  component: Index,
});

function Index() {
  const { session, loading } = useAuth();
  if (loading) return <PageLoader />;
  return <SafeNavigate to={session ? "/dashboard" : "/auth"} replace />;
}
