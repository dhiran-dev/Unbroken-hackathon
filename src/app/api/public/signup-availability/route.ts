import { NextResponse } from "next/server";

import {
  getPublicGoogleSignupAvailability,
  isGoogleProviderConfigured,
} from "@/server/auth/policy";

export const dynamic = "force-dynamic";

export function GET() {
  const availability = getPublicGoogleSignupAvailability({
    flagValue: process.env.PUBLIC_GOOGLE_SIGNUP_ENABLED,
    providerConfigured: isGoogleProviderConfigured({
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    }),
  });

  return NextResponse.json(
    {
      available: availability.available,
      message: availability.message,
    },
    {
      headers: { "Cache-Control": "no-store" },
    },
  );
}
