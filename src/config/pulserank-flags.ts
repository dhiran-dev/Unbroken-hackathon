/**
 * PulseRank runtime feature flags.
 *
 * Agent A0 (repo-safety) freeze scaffold. Every flag defaults to `false` so the
 * frozen UNBROKEN tree stays inert until PulseRank explicitly enables a surface.
 *
 * Server flags are read from `process.env` at module load. Public flags use the
 * `NEXT_PUBLIC_*` prefix and are referenced as direct member expressions so the
 * Next.js compiler can inline them into client bundles.
 *
 * Precedence (master plan §15.1): the global 3D flag
 * (`NEXT_PUBLIC_PULSERANK_3D_ENABLED`) overrides every per-page 3D flag — when
 * it is false, no page renders the Three.js stage even if its own flag is true.
 */

const TRUTHY = new Set(["true", "1"]);

function readServerFlag(name: string): boolean {
  return TRUTHY.has((process.env[name] ?? "").trim().toLowerCase());
}

function readPublicFlag(value: string | undefined): boolean {
  return TRUTHY.has((value ?? "").trim().toLowerCase());
}

/** Pages that may carry the optional Checkpoint 2 Three.js enhancement stage. */
export type ThreeDimensionalPage =
  | "home"
  | "explore"
  | "leaderboards"
  | "compare"
  | "changes"
  | "product"
  | "live-data"
  | "judge";

export interface PulserankServerFlags {
  /** Master switch for serving any PulseRank surface. */
  readonly appEnabled: boolean;
  /** Enables Bright Data collection runs against the PulseRank collector. */
  readonly collectionEnabled: boolean;
  /** Enables product discovery runs (off until direct-page mode is stable). */
  readonly discoveryEnabled: boolean;
  /** Exposes extended public API fields gated on source permission. */
  readonly publicExtendedFields: boolean;
  /** Allows state-mutating judge actions (approve/heal/verify). */
  readonly judgeMutationsEnabled: boolean;
}

export interface PulserankThreeDimensionalFlags {
  /** Global kill switch; overrides every per-page flag when false. */
  readonly enabled: boolean;
  readonly home: boolean;
  readonly explore: boolean;
  readonly leaderboards: boolean;
  readonly compare: boolean;
  readonly changes: boolean;
  readonly product: boolean;
  readonly liveData: boolean;
  readonly judge: boolean;
}

export interface PulserankFlags {
  readonly server: PulserankServerFlags;
  readonly threeDimensional: PulserankThreeDimensionalFlags;
}

// NEXT_PUBLIC_* values are read through direct member expressions (never via a
// dynamic key) so Next.js can statically inline them into client bundles.
const globalThreeEnabled = readPublicFlag(process.env.NEXT_PUBLIC_PULSERANK_3D_ENABLED);

export const pulserankFlags: PulserankFlags = Object.freeze({
  server: Object.freeze({
    appEnabled: readServerFlag("PULSERANK_APP_ENABLED"),
    collectionEnabled: readServerFlag("PULSERANK_COLLECTION_ENABLED"),
    discoveryEnabled: readServerFlag("PULSERANK_DISCOVERY_ENABLED"),
    publicExtendedFields: readServerFlag("PULSERANK_PUBLIC_EXTENDED_FIELDS"),
    judgeMutationsEnabled: readServerFlag("PULSERANK_JUDGE_MUTATIONS_ENABLED"),
  }),
  threeDimensional: Object.freeze({
    enabled: globalThreeEnabled,
    // Per-page flags only matter when the global flag is enabled.
    home: globalThreeEnabled && readPublicFlag(process.env.NEXT_PUBLIC_PULSERANK_3D_HOME),
    explore: globalThreeEnabled && readPublicFlag(process.env.NEXT_PUBLIC_PULSERANK_3D_EXPLORE),
    leaderboards:
      globalThreeEnabled && readPublicFlag(process.env.NEXT_PUBLIC_PULSERANK_3D_LEADERBOARDS),
    compare: globalThreeEnabled && readPublicFlag(process.env.NEXT_PUBLIC_PULSERANK_3D_COMPARE),
    changes: globalThreeEnabled && readPublicFlag(process.env.NEXT_PUBLIC_PULSERANK_3D_CHANGES),
    product: globalThreeEnabled && readPublicFlag(process.env.NEXT_PUBLIC_PULSERANK_3D_PRODUCT),
    liveData: globalThreeEnabled && readPublicFlag(process.env.NEXT_PUBLIC_PULSERANK_3D_LIVE_DATA),
    judge: globalThreeEnabled && readPublicFlag(process.env.NEXT_PUBLIC_PULSERANK_3D_JUDGE),
  }),
});

export const pulserankServerFlags = pulserankFlags.server;
export const pulserankThreeDimensionalFlags = pulserankFlags.threeDimensional;

/** Effective 3D enablement for one page, applying the global override. */
export function isThreeDimensionalPageEnabled(page: ThreeDimensionalPage): boolean {
  if (!pulserankFlags.threeDimensional.enabled) return false;
  switch (page) {
    case "home":
      return pulserankFlags.threeDimensional.home;
    case "explore":
      return pulserankFlags.threeDimensional.explore;
    case "leaderboards":
      return pulserankFlags.threeDimensional.leaderboards;
    case "compare":
      return pulserankFlags.threeDimensional.compare;
    case "changes":
      return pulserankFlags.threeDimensional.changes;
    case "product":
      return pulserankFlags.threeDimensional.product;
    case "live-data":
      return pulserankFlags.threeDimensional.liveData;
    case "judge":
      return pulserankFlags.threeDimensional.judge;
  }
}
