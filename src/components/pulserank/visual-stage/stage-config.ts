/**
 * Shared configuration for the optional image-based PulseRank stage.
 *
 * The stage is deliberately generic: it never turns a source product image
 * into a model and it never carries essential product copy. The HTML/CSS page
 * remains the source of truth underneath it.
 */

export const STAGE_ASSET = "/pulserank/observatory-atlas-512.webp";

export type VisualStageVariant =
  | "home"
  | "explore"
  | "leaderboards"
  | "compare"
  | "changes"
  | "product"
  | "live-data"
  | "judge";

export type VisualStageProps = {
  variant: VisualStageVariant;
  className?: string;
  compact?: boolean;
};

export type StageVariantConfig = {
  planeScale: number;
  opacity: number;
  tint: number;
  rotation: number;
  speed: number;
};

export const STAGE_VARIANTS: Record<VisualStageVariant, StageVariantConfig> = {
  home: { planeScale: 1, opacity: 0.38, tint: 0x8b5cf6, rotation: 0.03, speed: 0.16 },
  explore: { planeScale: 0.82, opacity: 0.3, tint: 0x22d3ee, rotation: -0.05, speed: 0.12 },
  leaderboards: { planeScale: 0.76, opacity: 0.32, tint: 0xfbbf24, rotation: 0.06, speed: 0.1 },
  compare: { planeScale: 0.78, opacity: 0.3, tint: 0x34d399, rotation: -0.04, speed: 0.11 },
  changes: { planeScale: 0.72, opacity: 0.29, tint: 0xfb7185, rotation: 0.05, speed: 0.09 },
  product: { planeScale: 0.86, opacity: 0.24, tint: 0xc4b5fd, rotation: -0.03, speed: 0.08 },
  "live-data": { planeScale: 0.74, opacity: 0.28, tint: 0x22d3ee, rotation: 0.04, speed: 0.1 },
  judge: { planeScale: 0.72, opacity: 0.27, tint: 0x34d399, rotation: -0.06, speed: 0.08 },
};
