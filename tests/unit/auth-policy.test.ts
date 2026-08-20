import { describe, expect, it } from "vitest";

import {
  ACCOUNT_LINKING_POLICY,
  AUTH_ROLE_POLICY,
  GOOGLE_SCOPES,
  PASSWORD_AUTH_POLICY,
  buildAuthPolicy,
  buildGoogleProviderOptions,
  isAllowedGoogleSocialSignIn,
  isGoogleProviderConfigured,
  buildSocialProviders,
  getPublicGoogleSignupAvailability,
  isPublicGoogleSignupEnabled,
  shouldAllowGoogleSignup,
} from "@/server/auth/policy";

describe("rider authentication policy", () => {
  it("omits Google when either server credential is absent", () => {
    expect(
      buildSocialProviders({ clientId: "", clientSecret: "secret" }),
    ).toEqual({});
    expect(
      buildSocialProviders({ clientId: "client", clientSecret: undefined }),
    ).toEqual({});
    expect(
      buildSocialProviders({ clientId: " client", clientSecret: "secret" }),
    ).toEqual({});
    expect(
      buildSocialProviders({ clientId: "client", clientSecret: "secret " }),
    ).toEqual({});
    expect(
      buildGoogleProviderOptions({
        clientId: " client",
        clientSecret: "secret",
      }),
    ).toBeUndefined();
    expect(
      isGoogleProviderConfigured({
        clientId: " client",
        clientSecret: "secret",
      }),
    ).toBe(false);
  });

  it("assembles the Better Auth policy with rider defaults and guarded signup", () => {
    const policy = buildAuthPolicy({
      clientId: "client-id",
      clientSecret: "server-secret",
      signupFlag: "false",
    });

    expect(policy.emailAndPassword).toEqual({
      enabled: true,
      disableSignUp: true,
    });
    expect(policy.socialProviders.google).toEqual({
      clientId: "client-id",
      clientSecret: "server-secret",
      disableDefaultScope: true,
      includeGrantedScopes: false,
      disableIdTokenSignIn: true,
      scope: ["openid", "email", "profile"],
    });
    expect(policy.account.accountLinking).toEqual(ACCOUNT_LINKING_POLICY);
    expect(policy.admin).toEqual(AUTH_ROLE_POLICY);
    expect(
      policy.shouldAllowGoogleSignup({
        action: "create-user",
        providerId: "google",
      }),
    ).toBe(false);
    expect(
      policy.shouldAllowGoogleSignup({
        action: "sign-in",
        providerId: "google",
      }),
    ).toBe(true);
    expect(
      policy.isAllowedGoogleSocialSignIn({
        path: "/sign-in/social",
        body: { provider: "google" },
      }),
    ).toBe(true);
    expect(
      policy.isAllowedGoogleSocialSignIn({
        path: "/sign-in/social",
        body: { provider: "google", scopes: ["email"] },
      }),
    ).toBe(false);
  });

  it("uses the exact Google OIDC scopes and server-only provider options", () => {
    expect(GOOGLE_SCOPES).toEqual(["openid", "email", "profile"]);
    expect(
      buildGoogleProviderOptions({
        clientId: "client-id",
        clientSecret: "server-secret",
      }),
    ).toEqual({
      clientId: "client-id",
      clientSecret: "server-secret",
      disableDefaultScope: true,
      includeGrantedScopes: false,
      disableIdTokenSignIn: true,
      scope: ["openid", "email", "profile"],
    });
  });

  it("keeps password operators enabled but signup disabled", () => {
    expect(PASSWORD_AUTH_POLICY).toEqual({
      enabled: true,
      disableSignUp: true,
    });
  });

  it("disables every implicit account link", () => {
    expect(ACCOUNT_LINKING_POLICY).toEqual({
      enabled: false,
      disableImplicitLinking: true,
      trustedProviders: [],
    });
  });

  it("treats only the exact true flag as public signup enabled", () => {
    expect(isPublicGoogleSignupEnabled("true")).toBe(true);
    expect(isPublicGoogleSignupEnabled("TRUE")).toBe(false);
    expect(isPublicGoogleSignupEnabled(true)).toBe(false);
    expect(isPublicGoogleSignupEnabled(undefined)).toBe(false);
  });

  it("fails closed for missing provider configuration or an off flag", () => {
    expect(
      getPublicGoogleSignupAvailability({
        flagValue: "true",
        providerConfigured: true,
      }),
    ).toEqual({
      available: true,
      newSignupAvailable: true,
      providerSignInAvailable: true,
      message: "Continue with Google to sign in or create a rider account.",
    });
    expect(
      getPublicGoogleSignupAvailability({
        flagValue: "false",
        providerConfigured: true,
      }),
    ).toEqual({
      available: false,
      newSignupAvailable: false,
      providerSignInAvailable: true,
      message:
        "Continue with Google if you already have an account. New rider signup is currently unavailable.",
    });
    expect(
      getPublicGoogleSignupAvailability({
        flagValue: "true",
        providerConfigured: false,
      }).providerSignInAvailable,
    ).toBe(false);
  });

  it("rejects scope overrides and non-Google social requests at the public hook seam", () => {
    expect(
      isAllowedGoogleSocialSignIn({
        path: "/sign-in/social",
        body: { provider: "github" },
      }),
    ).toBe(false);
    expect(
      isAllowedGoogleSocialSignIn({
        path: "/sign-in/social",
        body: { provider: "google", scopes: [] },
      }),
    ).toBe(false);
    expect(
      isAllowedGoogleSocialSignIn({
        path: "/sign-in/email",
        body: { provider: "github", scopes: ["admin"] },
      }),
    ).toBe(true);
  });

  it("gates only new Google user creation when the public flag is off", () => {
    expect(
      shouldAllowGoogleSignup({
        action: "create-user",
        providerId: "google",
        flagValue: "false",
      }),
    ).toBe(false);
    expect(
      shouldAllowGoogleSignup({
        action: "sign-in",
        providerId: "google",
        flagValue: "false",
      }),
    ).toBe(true);
    expect(
      shouldAllowGoogleSignup({
        action: "create-user",
        providerId: "google",
        flagValue: "true",
      }),
    ).toBe(true);
    expect(
      shouldAllowGoogleSignup({
        action: "create-user",
        providerId: "other",
        flagValue: "false",
      }),
    ).toBe(true);
  });
});
