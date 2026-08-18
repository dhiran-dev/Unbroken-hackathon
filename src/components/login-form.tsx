"use client";

import { LoaderCircle, LogIn } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { authClient } from "@/lib/auth-client";

export function LoginForm() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);

    const formData = new FormData(event.currentTarget);
    const email = String(formData.get("email") ?? "");
    const password = String(formData.get("password") ?? "");

    const result = await authClient.signIn.email({
      email,
      password,
      rememberMe: false,
    });

    if (result.error) {
      setPending(false);
      setError("We couldn’t sign you in. Check your details and try again.");
      return;
    }

    router.replace("/admin");
    router.refresh();
  }

  return (
    <form className="space-y-5" method="post" onSubmit={handleSubmit}>
      <div className="space-y-2">
        <Label htmlFor="email">Email address</Label>
        <Input autoComplete="username" id="email" name="email" required type="email" />
      </div>
      <div className="space-y-2">
        <Label htmlFor="password">Password</Label>
        <Input autoComplete="current-password" id="password" minLength={14} name="password" required type="password" />
      </div>
      {error && (
        <p aria-live="polite" className="rounded-lg border border-destructive/20 bg-destructive/8 px-3 py-2 text-sm text-destructive" role="alert">
          {error}
        </p>
      )}
      <Button className="w-full" disabled={pending} size="lg" type="submit">
        {pending ? <LoaderCircle className="animate-spin" /> : <LogIn />}
        {pending ? "Signing in…" : "Sign in"}
      </Button>
    </form>
  );
}
