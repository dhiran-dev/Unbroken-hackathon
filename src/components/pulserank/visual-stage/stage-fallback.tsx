import { STAGE_ASSET, type VisualStageVariant } from "./stage-config";

export function StageFallback({ variant }: { variant: VisualStageVariant }) {
  return (
    <div
      className={`pr-stage-fallback pr-stage-fallback-${variant}`}
      style={{ backgroundImage: `url("${STAGE_ASSET}")` }}
      aria-hidden="true"
    >
      <span className="pr-stage-fallback-ring" />
      <span className="pr-stage-fallback-signal" />
    </div>
  );
}
