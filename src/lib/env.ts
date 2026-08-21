import { z } from "zod";

/**
 * The only Bright Data collector permitted in PulseRank runtime code.
 * The retired UNBROKEN collector identity lives only in docs/ and AGENTS.md
 * (audit history); it must never appear in runtime configuration.
 */
export const PULSERANK_COLLECTOR_ID = "c_mt2yacvcyvyvim56d";

const booleanFlag = z
  .enum(["true", "false"])
  .default("false")
  .transform((value) => value === "true");

export const FIREWORKS_API_BASE_URL = "https://api.fireworks.ai/inference/v1";
const SECURE_DATABASE_MODES = new Set(["require", "verify-ca", "verify-full"]);
const OWNER_AUTHORIZED_LEGACY_DATABASE = {
  hostname: "46.225.216.222",
  port: "5432",
  pathname: "/unbroken_staging",
} as const;

export const serverEnvSchema = z.object({
  DATABASE_URL: z.string().url().startsWith("postgres"),
  BRIGHTDATA_API_TOKEN: z.string().min(1),
  BRIGHTDATA_COLLECTOR_ID: z.literal(PULSERANK_COLLECTOR_ID),
  FIREWORKS_API_KEY: z.string().min(1).optional(),
  FIREWORKS_API_BASE_URL: z
    .literal(FIREWORKS_API_BASE_URL)
    .default(FIREWORKS_API_BASE_URL),
  FIREWORKS_MODEL: z
    .literal("accounts/fireworks/models/deepseek-v4-flash-0731")
    .default("accounts/fireworks/models/deepseek-v4-flash-0731"),
  FIREWORKS_REASONING_EFFORT: z.literal("high").default("high"),
  INCIDENT_ARTIFACTS_DIR: z.string().min(1).default("artifacts/incidents"),
  // PulseRank surfaces are inert unless explicitly enabled (fail-closed).
  PULSERANK_APP_ENABLED: booleanFlag,
  PULSERANK_COLLECTION_ENABLED: booleanFlag,
  PULSERANK_DISCOVERY_ENABLED: booleanFlag,
});

export const publicEnvSchema = z.object({
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

function assertProductionTransport(env: Pick<ServerEnv, "DATABASE_URL">) {
  if (process.env.NODE_ENV !== "production") return;
  if (!isAllowedProductionDatabaseUrl(env.DATABASE_URL)) {
    throw new Error(
      "DATABASE_URL must use sslmode=require or stronger unless it is the exact owner-authorized legacy endpoint.",
    );
  }
}

export type ServerEnv = z.infer<typeof serverEnvSchema>;
export type PublicEnv = z.infer<typeof publicEnvSchema>;

let cachedServerEnv: ServerEnv | undefined;

export function getServerEnv(): ServerEnv {
  cachedServerEnv ??= serverEnvSchema.parse(process.env);
  assertProductionTransport(cachedServerEnv);
  return cachedServerEnv;
}

export const publicEnv = publicEnvSchema.parse({
  NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
});
