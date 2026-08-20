import type { Metadata } from "next";
import Link from "next/link";

import { Brand } from "@/components/brand";
import { ContinueWithGoogle } from "@/components/rider-google-sign-in";
import { ThemeToggle } from "@/components/theme-toggle";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
} from "@/components/ui/card";
import {
  isGoogleProviderConfigured,
  isPublicGoogleSignupEnabled,
} from "@/server/auth/policy";
import {
  projectPublicSignupAvailability,
  publicRiderAuthCallbackMessage,
} from "@/lib/public-signup-availability";
import { readPublicSignupAdmissionState } from "@/server/services/public-signup-availability";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Rider sign in" };

type RiderSignInPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export default async function RiderSignInPage({
  searchParams,
}: RiderSignInPageProps) {
  const providerConfigured = isGoogleProviderConfigured({
    clientId: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
  });
  const publicSignupEnabled = isPublicGoogleSignupEnabled(
    process.env.PUBLIC_GOOGLE_SIGNUP_ENABLED,
  );
  const admissionState =
    providerConfigured && publicSignupEnabled
      ? await readPublicSignupAdmissionState()
      : "open";
  const availability = projectPublicSignupAvailability({
    admissionState,
    providerConfigured,
    publicSignupEnabled,
  });

  const params = searchParams ? await searchParams : {};
  const hasCallbackError = params.error !== undefined;
  const callbackMessage = hasCallbackError
    ? publicRiderAuthCallbackMessage(
        typeof params.error === "string" ? params.error : "",
      )
    : null;

  return (
    <main className="relative grid min-h-screen place-items-center overflow-hidden px-4 py-10">
      <div
        aria-hidden="true"
        className="absolute inset-0 -z-10 bg-[radial-gradient(circle_at_50%_0%,oklch(0.65_0.18_264/0.14),transparent_42%)]"
      />
      <div className="absolute left-4 top-4 sm:left-6 sm:top-6">
        <Brand />
      </div>
      <div className="absolute right-4 top-3.5 sm:right-6 sm:top-5">
        <ThemeToggle />
      </div>
      <div className="w-full max-w-md">
        <Link
          className="mb-4 inline-flex text-sm text-muted-foreground hover:text-foreground"
          href="/"
        >
          Back to UNBROKEN
        </Link>
        <Card>
          <CardHeader>
            <h1 className="text-xl font-semibold tracking-tight">
              Rider sign in
            </h1>
            <CardDescription>
              Use your Google account to continue with UNBROKEN.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ContinueWithGoogle
              available={providerConfigured}
              message={callbackMessage ?? availability.message}
            />
          </CardContent>
        </Card>
        <p className="mt-4 text-center text-xs leading-5 text-muted-foreground">
          Operators use the separate{" "}
          <Link className="underline underline-offset-2" href="/login">
            operator sign in
          </Link>
          .
        </p>
      </div>
    </main>
  );
}
