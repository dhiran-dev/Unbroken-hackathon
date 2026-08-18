import { z } from "zod";

const serverEnvSchema = z.object({
  DATABASE_URL: z.string().url().startsWith("postgres"),
  BETTER_AUTH_SECRET: z.string().min(32),
  BETTER_AUTH_URL: z.string().url(),
  BRIGHTDATA_API_TOKEN: z.string().min(1),
  BRIGHTDATA_COLLECTOR_ID: z.string().regex(/^c_[A-Za-z0-9]+$/),
  SFMTA_SOURCE_URL: z
    .string()
    .url()
    .default(
      "https://www.sfmta.com/elevator-status/elevatorstatus.php?src=prod",
    ),
  FIREWORKS_API_KEY: z.string().min(1),
  FIREWORKS_API_BASE_URL: z
    .string()
    .url()
    .default("https://api.fireworks.ai/inference/v1"),
  FIREWORKS_MODEL: z
    .literal("accounts/fireworks/models/deepseek-v4-flash-0731")
    .default("accounts/fireworks/models/deepseek-v4-flash-0731"),
  FIREWORKS_REASONING_EFFORT: z.literal("high").default("high"),
});

const appEnvSchema = serverEnvSchema.pick({
  DATABASE_URL: true,
  BETTER_AUTH_SECRET: true,
  BETTER_AUTH_URL: true,
});

const publicEnvSchema = z.object({
  NEXT_PUBLIC_APP_URL: z.string().url().default("http://localhost:3000"),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;
export type AppEnv = z.infer<typeof appEnvSchema>;

let cachedServerEnv: ServerEnv | undefined;
let cachedAppEnv: AppEnv | undefined;

export function getServerEnv(): ServerEnv {
  cachedServerEnv ??= serverEnvSchema.parse(process.env);
  return cachedServerEnv;
}

export function getAppEnv(): AppEnv {
  cachedAppEnv ??= appEnvSchema.parse(process.env);
  return cachedAppEnv;
}

export const publicEnv = publicEnvSchema.parse({
  NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
});
