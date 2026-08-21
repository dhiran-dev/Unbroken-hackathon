/**
 * User preferences persisted in localStorage under `pulserank:v1:preferences`.
 *
 * All functions are SSR-safe: on the server, loads return the defaults and
 * saves are no-ops. Corrupt or unexpected payloads parse back to the defaults
 * instead of throwing.
 */

import { PREFERENCES_STORAGE_KEY } from "./keys";
import {
  getLocalStorage,
  readJsonStorage,
  removeStorageKey,
  writeJsonStorage,
} from "./storage";

export type ThemePreference = "dark" | "light" | "system";

export type ReducedMotionOverride = "auto" | "on" | "off";

export interface PulsePreferences {
  /** UI color scheme. `"system"` follows the OS setting. */
  theme: ThemePreference;
  /** User override for reduced-motion; `"auto"` defers to the OS preference. */
  reducedMotionOverride?: ReducedMotionOverride;
  /** Category preselected on first paint (e.g. `"energy-drinks"`). */
  defaultCategory?: string;
}

/** Preferences used when nothing (or something corrupt) is stored. */
export const DEFAULT_PREFERENCES: Readonly<PulsePreferences> = {
  theme: "system",
};

/**
 * Coerces an unknown parsed value into valid preferences, dropping anything
 * unrecognized. Never throws: non-objects and missing fields fall back to
 * {@link DEFAULT_PREFERENCES}.
 */
export function sanitizePreferences(value: unknown): PulsePreferences {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { ...DEFAULT_PREFERENCES };
  }
  const record = value as Record<string, unknown>;
  const preferences: PulsePreferences = { ...DEFAULT_PREFERENCES };

  const theme = record["theme"];
  if (theme === "dark" || theme === "light" || theme === "system") {
    preferences.theme = theme;
  }

  const motionOverride = record["reducedMotionOverride"];
  if (
    motionOverride === "auto" ||
    motionOverride === "on" ||
    motionOverride === "off"
  ) {
    preferences.reducedMotionOverride = motionOverride;
  }

  const defaultCategory = record["defaultCategory"];
  if (typeof defaultCategory === "string" && defaultCategory.trim().length > 0) {
    preferences.defaultCategory = defaultCategory;
  }

  return preferences;
}

/** Parses a raw JSON string into preferences; corrupt JSON yields the defaults. */
export function parsePreferences(raw: string): PulsePreferences {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return { ...DEFAULT_PREFERENCES };
  }
  return sanitizePreferences(parsed);
}

/**
 * Loads stored preferences. Missing, corrupt, or unreadable data returns the
 * defaults; the stored value is never mutated by a load.
 */
export function loadPreferences(): PulsePreferences {
  return sanitizePreferences(readJsonStorage(PREFERENCES_STORAGE_KEY));
}

/**
 * Validates and persists preferences. Unknown fields are dropped and missing
 * fields fall back to defaults before writing. Returns false when storage is
 * unavailable (server) or the write fails.
 */
export function savePreferences(preferences: PulsePreferences): boolean {
  const next = sanitizePreferences({ ...DEFAULT_PREFERENCES, ...preferences });
  return writeJsonStorage(PREFERENCES_STORAGE_KEY, next);
}

/**
 * Loads, merges a partial patch, and saves in one step. Returns the merged
 * preferences, or `null` when storage is unavailable (server).
 */
export function updatePreferences(patch: Partial<PulsePreferences>): PulsePreferences | null {
  if (!getLocalStorage()) return null;
  const merged = sanitizePreferences({ ...loadPreferences(), ...patch });
  return savePreferences(merged) ? merged : null;
}

/** Removes stored preferences. Returns false when storage is unavailable. */
export function clearPreferences(): boolean {
  return removeStorageKey(PREFERENCES_STORAGE_KEY);
}
