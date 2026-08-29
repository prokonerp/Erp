import { createFileRoute } from "@tanstack/react-router";
import { SignatureSettings } from "@/components/SignatureSettings";
import { useIsAdmin } from "@/lib/useRole";

export const Route = createFileRoute("/_app/settings/signatures")({
  component: SignaturesPage,
  head: () => ({ meta: [{ title: "Signatures — Prokon" }] }),
});

function SignaturesPage() {
  const { isAdmin } = useIsAdmin();
  return <SignatureSettings isAdmin={isAdmin} />;
}
