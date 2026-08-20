import { NextResponse } from "next/server";

import {
  projectPublicSignupAvailability,
  type PublicSignupAdmissionState,
} from "@/lib/public-signup-availability";
import {
  isGoogleProviderConfigured,
  isPublicGoogleSignupEnabled,
} from "@/server/auth/policy";
import { readPublicSignupAdmissionState } from "@/server/services/public-signup-availability";

export const dynamic = "force-dynamic";

export type PublicSignupAdmissionReader =
  () => Promise<PublicSignupAdmissionState>;

export async function getPublicSignupAvailabilityResponse(
  readAdmissionState: PublicSignupAdmissionReader = readPublicSignupAdmissionState,
) {
  const providerConfigured = isGoogleProviderConfigured({
    clientId: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
  });
  const publicSignupEnabled = isPublicGoogleSignupEnabled(
    process.env.PUBLIC_GOOGLE_SIGNUP_ENABLED,
  );

  let admissionState: PublicSignupAdmissionState = "open";
  if (providerConfigured && publicSignupEnabled) {
    try {
      admissionState = await readAdmissionState();
    } catch {
      admissionState = "unavailable";
    }
  }

  const availability = projectPublicSignupAvailability({
    admissionState,
    providerConfigured,
    publicSignupEnabled,
  });

  return NextResponse.json(availability, {
    headers: { "Cache-Control": "no-store" },
  });
}

export function GET() {
  return getPublicSignupAvailabilityResponse();
}
