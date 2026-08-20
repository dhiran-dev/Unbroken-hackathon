export const PUBLIC_RIDER_ADMISSION_FULL_COPY =
  "UNBROKEN is full for now. If you already joined, you can still continue with Google.";
export const GOOGLE_SIGNUP_UNAVAILABLE_COPY =
  "Google sign-in is currently unavailable.";
export const GOOGLE_SIGNUP_ENABLED_COPY =
  "Continue with Google to sign in or create a rider account.";
export const GOOGLE_SIGNUP_EXISTING_RIDER_COPY =
  "Continue with Google if you already have an account. New rider signup is currently unavailable.";

export type PublicSignupAdmissionState =
  "open" | "full" | "paused" | "unavailable";

export type PublicSignupAvailabilityView = {
  available: boolean;
  message: string;
};

const PUBLIC_SIGNUP_MESSAGES = new Set([
  GOOGLE_SIGNUP_ENABLED_COPY,
  GOOGLE_SIGNUP_EXISTING_RIDER_COPY,
  GOOGLE_SIGNUP_UNAVAILABLE_COPY,
  PUBLIC_RIDER_ADMISSION_FULL_COPY,
]);

export function projectPublicSignupAvailability(input: {
  admissionState: PublicSignupAdmissionState;
  providerConfigured: boolean;
  publicSignupEnabled: boolean;
}): PublicSignupAvailabilityView {
  if (!input.providerConfigured) {
    return { available: false, message: GOOGLE_SIGNUP_UNAVAILABLE_COPY };
  }

  if (!input.publicSignupEnabled) {
    return {
      available: false,
      message: GOOGLE_SIGNUP_EXISTING_RIDER_COPY,
    };
  }

  if (input.admissionState === "full") {
    return { available: false, message: PUBLIC_RIDER_ADMISSION_FULL_COPY };
  }

  if (input.admissionState !== "open") {
    return {
      available: false,
      message: GOOGLE_SIGNUP_EXISTING_RIDER_COPY,
    };
  }

  return { available: true, message: GOOGLE_SIGNUP_ENABLED_COPY };
}

export function publicRiderAuthCallbackMessage(errorCode: unknown) {
  if (errorCode === undefined || errorCode === null) return null;
  return errorCode === "rider_admission_full"
    ? PUBLIC_RIDER_ADMISSION_FULL_COPY
    : GOOGLE_SIGNUP_UNAVAILABLE_COPY;
}

export function parsePublicSignupAvailability(
  value: unknown,
): PublicSignupAvailabilityView | null {
  if (!value || typeof value !== "object") return null;

  const keys = Object.keys(value).sort();
  if (keys.length !== 2 || keys[0] !== "available" || keys[1] !== "message") {
    return null;
  }

  const candidate = value as Record<string, unknown>;
  if (
    typeof candidate.available !== "boolean" ||
    typeof candidate.message !== "string" ||
    !PUBLIC_SIGNUP_MESSAGES.has(candidate.message)
  ) {
    return null;
  }

  return {
    available: candidate.available,
    message: candidate.message,
  };
}
