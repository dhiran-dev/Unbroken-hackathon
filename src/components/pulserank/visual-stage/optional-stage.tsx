import {
  isThreeDimensionalPageEnabled,
  type ThreeDimensionalPage,
} from "@/config/pulserank-flags";

import { VisualStage } from "./VisualStage";
import type { VisualStageProps } from "./stage-config";

type OptionalVisualStageProps = VisualStageProps & {
  page: ThreeDimensionalPage;
};

/** Server-side flag gate. Disabled pages do not ship a stage element. */
export function OptionalVisualStage({ page, ...props }: OptionalVisualStageProps) {
  if (!isThreeDimensionalPageEnabled(page)) return null;
  return <VisualStage {...props} />;
}
