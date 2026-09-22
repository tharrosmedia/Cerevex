"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ApiError, login } from "@/lib/api";

export default function SignInPage() {
  const router = useRouter();
  const [email, setEmail] = useState("adam@tharrosmedia.com");
  const [password, setPassword] = useState("local-dev-only");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      await login(email, password);
      router.replace("/app");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not sign in. Is the API running?");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex min-h-screen flex-col bg-[radial-gradient(circle_at_top,oklch(0.24_0.03_55),transparent_42%)]">
      <header className="flex items-center justify-between px-6 py-5">
        <div className="flex items-baseline gap-2">
          <span className="font-heading text-xl tracking-tight">Cerevex</span>
          <span className="font-mono text-xs text-primary">ads</span>
        </div>
        <p className="hidden text-xs text-muted-foreground sm:block">M4 cockpit · mock OK</p>
      </header>

      <main className="flex flex-1 items-center justify-center px-4 pb-16">
        <Card className="w-full max-w-md border-border/80 shadow-xl">
          <CardHeader className="space-y-3">
            <p className="text-xs font-medium uppercase tracking-[0.18em] text-primary">
              Operator console
            </p>
            <CardTitle className="font-heading text-3xl font-medium tracking-tight">
              Sign in to Cerevex
            </CardTitle>
            <CardDescription className="text-sm leading-6">
              Professionally managed ads for HVAC and home-service businesses. Advertising is not
              the growth limiter.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form className="space-y-4" onSubmit={onSubmit}>
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  autoComplete="username"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
              </div>
              {error ? (
                <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                  {error}
                </p>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Local seed owner: <span className="font-mono">adam@tharrosmedia.com</span> /{" "}
                  <span className="font-mono">local-dev-only</span>
                </p>
              )}
              <Button type="submit" className="w-full" disabled={pending} size="lg">
                {pending ? "Signing in…" : "Sign in"}
              </Button>
            </form>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
