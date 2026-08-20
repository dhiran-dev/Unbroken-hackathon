import type { SocialProviders } from "better-auth/social-providers";

export const GOOGLE_SCOPES = ["openid", "email", "profile"] as const;

export const GOOGLE_SOCIAL_SIGN_IN_PATH = "/sign-in/social";

export const PASSWORD_AUTH_POLICY = {
  enabled: true,
  disableSignUp: true,
} as const;

export const ACCOUNT_LINKING_POLICY = {
  enabled: false,
  disableImplicitLinking: true,
  trustedProviders: [] as string[],
} as const;

export const AUTH_ROLE_POLICY = {
  defaultRole: "rider",
  adminRoles: ["owner", "admin"] as const,
} as const;

export const GOOGLE_PROVIDER_POLICY = {
  disableDefaultScope: true,
  includeGrantedScopes: false,
  disableIdTokenSignIn: true,
  scope: [...GOOGLE_SCOPES],
} as const;

type GoogleCredentials = {
  clientId: string;
  clientSecret: string;
};

export function buildGoogleProviderOptions(credentials: GoogleCredentials) {
  if (!isGoogleProviderConfigured(credentials)) return undefined;

  return {
    clientId: credentials.clientId,
    clientSecret: credentials.clientSecret,
    ...GOOGLE_PROVIDER_POLICY,
    scope: [...GOOGLE_SCOPES],
  };
}

export function buildSocialProviders(input: {
  clientId?: unknown;
  clientSecret?: unknown;
}): SocialProviders {
  if (!isGoogleProviderConfigured(input)) return {};

  const googleOptions = buildGoogleProviderOptions({
    clientId: input.clientId as string,
    clientSecret: input.clientSecret as string,
  });

  return googleOptions ? { google: googleOptions } : {};
}

export function isGoogleProviderConfigured(input: {
  clientId?: unknown;
  clientSecret?: unknown;
}): boolean {
  return (
    typeof input.clientId === "string" &&
    input.clientId.length > 0 &&
    input.clientId === input.clientId.trim() &&
    typeof input.clientSecret === "string" &&
    input.clientSecret.length > 0 &&
    input.clientSecret === input.clientSecret.trim()
  );
}

export function isPublicGoogleSignupEnabled(value: unknown): boolean {
  return value === "true";
}

export function getPublicGoogleSignupAvailability(input: {
  flagValue?: unknown;
  providerConfigured: boolean;
}) {
  const providerSignInAvailable = input.providerConfigured;
  const newSignupAvailable =
    isPublicGoogleSignupEnabled(input.flagValue) && providerSignInAvailable;

  return {
    available: newSignupAvailable,
    newSignupAvailable,
    providerSignInAvailable,
    message: !providerSignInAvailable
      ? "Google sign-in is currently unavailable."
      : newSignupAvailable
        ? "Continue with Google to sign in or create a rider account."
        : "Continue with Google if you already have an account. New rider signup is currently unavailable.",
  } as const;
}

export function isAllowedGoogleSocialSignIn(input: {
  path?: unknown;
  body?: unknown;
}): boolean {
  if (input.path !== GOOGLE_SOCIAL_SIGN_IN_PATH) return true;
  if (!input.body || typeof input.body !== "object") return false;

  const body = input.body as Record<string, unknown>;
  return (
    body.provider === "google" &&
    !Object.prototype.hasOwnProperty.call(body, "scopes")
  );
}

export function buildAuthPolicy(input: {
  clientId?: unknown;
  clientSecret?: unknown;
  signupFlag?: unknown;
}) {
  return {
    emailAndPassword: PASSWORD_AUTH_POLICY,
    socialProviders: buildSocialProviders(input),
    account: { accountLinking: ACCOUNT_LINKING_POLICY },
    admin: AUTH_ROLE_POLICY,
    isAllowedGoogleSocialSignIn,
    shouldAllowGoogleSignup: (source: {
      action: "create-user" | "link-account" | "sign-in";
      providerId?: string;
    }) => shouldAllowGoogleSignup({ ...source, flagValue: input.signupFlag }),
  } as const;
}

export function shouldAllowGoogleSignup(input: {
  action: "create-user" | "link-account" | "sign-in";
  providerId?: string;
  flagValue?: unknown;
}): boolean {
  if (input.action !== "create-user" || input.providerId !== "google") {
    return true;
  }

  return isPublicGoogleSignupEnabled(input.flagValue);
}
