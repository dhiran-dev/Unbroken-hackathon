import { z } from "zod";

export const PRODUCTION_COLLECTOR_ID = "c_msyjsllt1r9ej5tdub";
export const PRODUCTION_SOURCE_URL =
  "https://www.sfmta.com/elevator-status/elevatorstatus.php?src=prod";
export const FIREWORKS_API_BASE_URL = "https://api.fireworks.ai/inference/v1";
const SECURE_DATABASE_MODES = new Set(["require", "verify-ca", "verify-full"]);
const OWNER_AUTHORIZED_LEGACY_DATABASE = {
  hostname: "46.225.216.222",
  port: "5432",
  pathname: "/unbroken_staging",
} as const;

const serverEnvSchema = z.object({
  DATABASE_URL: z.string().url().startsWith("postgres"),
  BETTER_AUTH_SECRET: z.string().min(32),
  BETTER_AUTH_URL: z.string().url(),
  BRIGHTDATA_API_TOKEN: z.string().min(1),
  BRIGHTDATA_COLLECTOR_ID: z.literal(PRODUCTION_COLLECTOR_ID),
  FIREWORKS_API_KEY: z.string().min(1),
  FIREWORKS_API_BASE_URL: z
    .literal(FIREWORKS_API_BASE_URL)
    .default(FIREWORKS_API_BASE_URL),
  SFMTA_SOURCE_URL: z
    .literal(PRODUCTION_SOURCE_URL)
    .default(PRODUCTION_SOURCE_URL),
  FIREWORKS_MODEL: z
    .literal("accounts/fireworks/models/deepseek-v4-flash-0731")
    .default("accounts/fireworks/models/deepseek-v4-flash-0731"),
  FIREWORKS_REASONING_EFFORT: z.literal("high").default("high"),
  INCIDENT_ARTIFACTS_DIR: z.string().min(1).default("artifacts/incidents"),
});

const appEnvSchema = serverEnvSchema.pick({
  DATABASE_URL: true,
  BETTER_AUTH_SECRET: true,
  BETTER_AUTH_URL: true,
});

const publicEnvSchema = z.object({
  NEXT_PUBLIC_APP_URL: z.string().url().default("http://localhost:3000"),
});

export function isAllowedProductionDatabaseUrl(value: string) {
  try {
    const url = new URL(value);
    if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
      return false;
    }

    const sslMode = url.searchParams.get("sslmode")?.toLowerCase();
    if (sslMode !== undefined) return SECURE_DATABASE_MODES.has(sslMode);

    return (
      url.hostname === OWNER_AUTHORIZED_LEGACY_DATABASE.hostname &&
      url.port === OWNER_AUTHORIZED_LEGACY_DATABASE.port &&
      url.pathname === OWNER_AUTHORIZED_LEGACY_DATABASE.pathname
    );
  } catch {
    return false;
  }
}

export function isSecureProductionAuthUrl(value: string) {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

function assertProductionTransport(
  env: Pick<ServerEnv, "DATABASE_URL" | "BETTER_AUTH_URL">,
) {
  if (process.env.NODE_ENV !== "production") return;
  if (!isAllowedProductionDatabaseUrl(env.DATABASE_URL)) {
    throw new Error(
      "DATABASE_URL must use sslmode=require or stronger unless it is the exact owner-authorized legacy endpoint.",
    );
  }
  if (!isSecureProductionAuthUrl(env.BETTER_AUTH_URL)) {
    throw new Error("BETTER_AUTH_URL must use HTTPS in production.");
  }
}

export type ServerEnv = z.infer<typeof serverEnvSchema>;
export type AppEnv = z.infer<typeof appEnvSchema>;

let cachedServerEnv: ServerEnv | undefined;
let cachedAppEnv: AppEnv | undefined;

export function getServerEnv(): ServerEnv {
  cachedServerEnv ??= serverEnvSchema.parse(process.env);
  if (cachedServerEnv) assertProductionTransport(cachedServerEnv);
  return cachedServerEnv;
}

export function getAppEnv(): AppEnv {
  cachedAppEnv ??= appEnvSchema.parse(process.env);
  if (cachedAppEnv) assertProductionTransport(cachedAppEnv);
  return cachedAppEnv;
}

export const publicEnv = publicEnvSchema.parse({
  NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
});
