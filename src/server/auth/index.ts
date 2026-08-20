import { APIError, createAuthMiddleware } from "better-auth/api";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { betterAuth } from "better-auth/minimal";
import { admin as adminPlugin } from "better-auth/plugins";

import { getAppEnv } from "@/lib/env";
import { db } from "@/server/db/client";
import * as authSchema from "@/server/db/schema/auth";
import { authAccess, authRoles } from "./access";
import { buildAuthPolicy } from "./policy";

const env = getAppEnv();
const isProduction = process.env.NODE_ENV === "production";
const authPolicy = buildAuthPolicy({
  clientId: process.env.GOOGLE_CLIENT_ID,
  clientSecret: process.env.GOOGLE_CLIENT_SECRET,
  signupFlag: process.env.PUBLIC_GOOGLE_SIGNUP_ENABLED,
});

export const auth = betterAuth({
  appName: "UNBROKEN",
  baseURL: env.BETTER_AUTH_URL,
  secret: env.BETTER_AUTH_SECRET,
  database: drizzleAdapter(db, {
    provider: "pg",
    schema: authSchema,
  }),
  emailAndPassword: {
    ...authPolicy.emailAndPassword,
    minPasswordLength: 14,
    maxPasswordLength: 128,
    revokeSessionsOnPasswordReset: true,
  },
  socialProviders: authPolicy.socialProviders,
  account: authPolicy.account,
  hooks: {
    before: createAuthMiddleware(async (context) => {
      if (
        !authPolicy.isAllowedGoogleSocialSignIn({
          path: context.path,
          body: context.body,
        })
      ) {
        throw new APIError("BAD_REQUEST", {
          message: "Google sign-in could not be started.",
        });
      }
    }),
  },
  user: {
    validateUserInfo: ({ source }) => {
      if (
        !authPolicy.shouldAllowGoogleSignup({
          action: source.action,
          providerId: source.oauth?.providerId,
        })
      ) {
        return {
          error: "google_signup_disabled",
          errorDescription: "Google rider signup is currently unavailable.",
        };
      }
    },
  },
  session: {
    expiresIn: 60 * 60 * 12,
    updateAge: 60 * 60,
    cookieCache: {
      enabled: true,
      maxAge: 60 * 5,
    },
  },
  advanced: {
    useSecureCookies: isProduction,
    defaultCookieAttributes: {
      httpOnly: true,
      sameSite: "lax",
      secure: isProduction,
    },
  },
  rateLimit: {
    enabled: true,
    window: 60,
    max: 100,
    customRules: {
      "/sign-in/email": {
        window: 60,
        max: 5,
      },
    },
  },
  telemetry: {
    enabled: false,
  },
  plugins: [
    adminPlugin({
      ac: authAccess,
      roles: authRoles,
      defaultRole: authPolicy.admin.defaultRole,
      adminRoles: [...authPolicy.admin.adminRoles],
      impersonationSessionDuration: 60 * 15,
      bannedUserMessage: "This account cannot access UNBROKEN.",
    }),
  ],
});
