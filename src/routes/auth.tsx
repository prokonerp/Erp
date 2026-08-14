import { createFileRoute, useNavigate, useLocation } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { toast } from "sonner";
import prokonLogo from "@/assets/prokon-logo.jpeg.asset.json";

export const Route = createFileRoute("/auth")({
  component: AuthPage,
  validateSearch: (s: Record<string, unknown>): { next?: string } => {
    const raw = s.next;
    const safe = typeof raw === "string" && raw.startsWith("/") && !raw.startsWith("//") ? raw : undefined;
    return safe ? { next: safe } : {};
  },
  head: () => ({ meta: [{ title: "Sign in — Prokon Gatepass" }] }),
});

function AuthPage() {
  const { session, loading } = useAuth();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { next } = Route.useSearch();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (sessionStorage.getItem("idle-session-expired")) {
      sessionStorage.removeItem("idle-session-expired");
      toast.info(
        "Your session has expired due to 30 minutes of inactivity. Please sign in again.",
        { duration: 8000 },
      );
    }
  }, []);

  useEffect(() => {
    if (!session) return;
    const target = next && next !== pathname ? next : "/dashboard";
    void navigate({ to: target, search: {} });
  }, [session, next, pathname, navigate]);

  if (loading) return <div className="p-8">Loading…</div>;


  const signIn = async () => {
    setBusy(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setBusy(false);
    if (error) return toast.error(error.message);
    if (next) {
      window.location.href = next;
      return;
    }
    navigate({ to: "/dashboard" });
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center items-center">
          <img
            src={prokonLogo.url}
            alt="Prokon Hi-Tech Systems"
            className="h-16 w-auto object-contain mx-auto mb-2"
          />
          <CardTitle className="sr-only">Prokon Hi-Tech Systems</CardTitle>
          <CardDescription>Sign in to continue</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 pt-2">
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              signIn();
            }}
          >
            <div>
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="password">Password</Label>
              <Input id="password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
            </div>
            <Button className="w-full" type="submit" disabled={busy}>Sign in</Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}