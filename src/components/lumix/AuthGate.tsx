import { useState } from "react";
import { toast } from "sonner";
import { LockKeyhole, ShieldCheck } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { GlassPanel } from "./GlassPanel";

export function AuthGate({ notAdmin }: { notAdmin?: boolean }) {
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    try {
      if (mode === "signup") {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: window.location.origin },
        });
        if (error) throw error;
        toast.success("Account created. You can sign in now.");
        setMode("signin");
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        toast.success("Welcome back to LumiX Control.");
      }
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto flex min-h-[70vh] w-full max-w-md items-center px-4">
      <GlassPanel raised className="w-full p-6 sm:p-8">
        <div className="mb-6 flex items-center gap-3">
          <span className="bg-gradient-cyan glow-cyan grid size-11 place-items-center rounded-2xl">
            {notAdmin ? (
              <ShieldCheck className="size-5 text-primary-foreground" />
            ) : (
              <LockKeyhole className="size-5 text-primary-foreground" />
            )}
          </span>
          <div>
            <h1 className="text-xl font-semibold">
              {notAdmin ? "Admin access required" : "LumiX Control"}
            </h1>
            <p className="text-muted-foreground text-xs">
              {notAdmin
                ? "This account is signed in but has no admin role."
                : "Sign in to manage the media library."}
            </p>
          </div>
        </div>

        {notAdmin ? (
          <Button variant="outline" className="w-full" onClick={() => supabase.auth.signOut()}>
            Sign out
          </Button>
        ) : (
          <form onSubmit={submit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="admin@lumix.io"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                required
                minLength={6}
                autoComplete={mode === "signup" ? "new-password" : "current-password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
              />
            </div>
            <Button
              type="submit"
              disabled={busy}
              className="bg-gradient-cyan glow-cyan spring-press text-primary-foreground w-full font-semibold"
            >
              {busy ? "Working…" : mode === "signup" ? "Create admin account" : "Enter control room"}
            </Button>
            <button
              type="button"
              className="text-muted-foreground hover:text-primary w-full text-center text-xs transition-colors"
              onClick={() => setMode(mode === "signin" ? "signup" : "signin")}
            >
              {mode === "signin"
                ? "First time here? Create the first account (becomes admin)"
                : "Already have an account? Sign in"}
            </button>
          </form>
        )}
      </GlassPanel>
    </div>
  );
}
