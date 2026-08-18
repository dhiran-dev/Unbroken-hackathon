import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { betterAuth } from "better-auth/minimal";
import { admin as adminPlugin } from "better-auth/plugins";

import { getAppEnv } from "@/lib/env";
import { db } from "@/server/db/client";
import * as authSchema from "@/server/db/schema/auth";
import { authAccess, authRoles } from "./access";

const env = getAppEnv();
const isProduction = process.env.NODE_ENV === "production";

export const auth = betterAuth({
  appName: "UNBROKEN",
  baseURL: env.BETTER_AUTH_URL,
  secret: env.BETTER_AUTH_SECRET,
  database: drizzleAdapter(db, {
    provider: "pg",
    schema: authSchema,
  }),
  emailAndPassword: {
    enabled: true,
    disableSignUp: true,
    minPasswordLength: 14,
    maxPasswordLength: 128,
    revokeSessionsOnPasswordReset: true,
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
      defaultRole: "admin",
      adminRoles: ["owner", "admin"],
      impersonationSessionDuration: 60 * 15,
      bannedUserMessage: "This account cannot access UNBROKEN.",
    }),
  ],
});
