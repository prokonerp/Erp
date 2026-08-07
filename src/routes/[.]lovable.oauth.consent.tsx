import { createFileRoute, redirect } from "@tanstack/react-router";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

type OAuthClient = { name?: string; client_name?: string; redirect_uri?: string } | null;
type AuthorizationDetails = {
  client?: OAuthClient;
  scope?: string;
  redirect_url?: string;
  redirect_to?: string;
} | null;

type OAuthApi = {
  getAuthorizationDetails: (id: string) => Promise<{ data: AuthorizationDetails; error: { message: string } | null }>;
  approveAuthorization: (id: string) => Promise<{ data: AuthorizationDetails; error: { message: string } | null }>;
  denyAuthorization: (id: string) => Promise<{ data: AuthorizationDetails; error: { message: string } | null }>;
};

const oauthApi = () => (supabase.auth as unknown as { oauth: OAuthApi }).oauth;

export const Route = createFileRoute("/.lovable/oauth/consent")({
  ssr: false,
  validateSearch: (s: Record<string, unknown>) => ({
    authorization_id: typeof s.authorization_id === "string" ? s.authorization_id : "",
  }),
  beforeLoad: async ({ search, location }) => {
    if (!search.authorization_id) throw new Error("Missing authorization_id");
    const { data } = await supabase.auth.getSession();
    const next = location.pathname + location.searchStr;
    if (!data.session) throw redirect({ to: "/auth", search: { next } });
  },
  loaderDeps: ({ search }) => ({ authorizationId: search.authorization_id }),
  loader: async ({ deps }) => {
    const authorizationId = deps.authorizationId;
    const { data, error } = await oauthApi().getAuthorizationDetails(authorizationId);
    if (error) throw new Error(error.message);
    const immediate = data?.redirect_url ?? data?.redirect_to;
    if (immediate && !data?.client) throw redirect({ href: immediate });
    return data;
  },
  component: Consent,
  errorComponent: ({ error }) => (
    <main className="min-h-screen flex items-center justify-center p-6 text-sm">
      Could not load this authorization request: {String((error as Error)?.message ?? error)}
    </main>
  ),
  head: () => ({
    meta: [
      { title: "Authorize access — Prokon ERP" },
      { name: "description", content: "Approve or deny an external app's request to access your Prokon ERP account." },
    ],
  }),
});

function Consent() {
  const details = Route.useLoaderData();
  const { authorization_id } = Route.useSearch();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const clientName = details?.client?.name ?? details?.client?.client_name ?? "an app";

  async function decide(approve: boolean) {
    setBusy(true);
    setError(null);
    const { data, error: err } = approve
      ? await oauthApi().approveAuthorization(authorization_id)
      : await oauthApi().denyAuthorization(authorization_id);
    if (err) {
      setBusy(false);
      setError(err.message);
      return;
    }
    const target = data?.redirect_url ?? data?.redirect_to;
    if (!target) {
      setBusy(false);
      setError("No redirect returned by the authorization server.");
      return;
    }
    window.location.href = target;
  }

  return (
    <main className="min-h-screen flex items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="text-lg">Connect {clientName} to Prokon ERP</CardTitle>
          <CardDescription>
            {clientName} will be able to call Prokon ERP's enabled tools as you.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          {details?.client?.redirect_uri ? (
            <p className="text-muted-foreground break-all">
              Redirects to <span className="font-mono text-xs">{details.client.redirect_uri}</span>
            </p>
          ) : null}
          {details?.scope ? (
            <p className="text-muted-foreground">Requested access: {details.scope}</p>
          ) : null}
          <p className="text-muted-foreground">
            This does not bypass Prokon ERP's permissions or data access rules.
          </p>
          {error ? <p role="alert" className="text-destructive">{error}</p> : null}
          <div className="flex gap-2 pt-1">
            <Button className="flex-1" disabled={busy} onClick={() => decide(true)}>
              Approve
            </Button>
            <Button className="flex-1" variant="outline" disabled={busy} onClick={() => decide(false)}>
              Cancel connection
            </Button>
          </div>
        </CardContent>
      </Card>
    </main>
  );
}