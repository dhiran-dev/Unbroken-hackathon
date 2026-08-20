"use client";

import { LoaderCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth-client";

type ContinueWithGoogleProps = {
  available: boolean;
  message: string;
};

export function ContinueWithGoogle({
  available,
  message,
}: ContinueWithGoogleProps) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleContinue() {
    if (!available || pending) return;

    setPending(true);
    setError(null);
    const result = await authClient.signIn.social({
      provider: "google",
      callbackURL: "/",
      errorCallbackURL: "/rider/sign-in",
    });

    if (result.error) {
      setPending(false);
      setError("Google sign-in could not be started. Please try again.");
      return;
    }

    router.refresh();
  }

  return (
    <div className="space-y-3">
      <Button
        aria-describedby="google-sign-in-help"
        aria-label="Continue with Google"
        className="w-full"
        disabled={!available || pending}
        onClick={handleContinue}
        size="lg"
        type="button"
      >
        {pending ? (
          <LoaderCircle className="animate-spin" />
        ) : (
          <span aria-hidden="true" className="text-base font-semibold">
            G
          </span>
        )}
        {pending ? "Connecting…" : "Continue with Google"}
      </Button>
      <p
        aria-live="polite"
        className="text-center text-sm leading-6 text-muted-foreground"
        id="google-sign-in-help"
        role={error ? "alert" : "status"}
      >
        {error ?? message}
      </p>
    </div>
  );
}
