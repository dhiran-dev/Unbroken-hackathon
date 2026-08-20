import {
  createAccessibilityEvidence,
  type ExactAccessibilityAdvisory,
  type ExactStopRelocation,
} from "@/domain/journey/accessibility-evidence";
import { PostgresAccessibilityAdvisoryStore } from "@/server/transit/accessibility-advisory-store";
import { readAccessibilityAdvisories } from "@/server/transit/accessibility-advisories";
import { PostgresRealtimeSnapshotStore } from "@/server/transit/realtime-store";
import { PostgresStopAccessibilityGuideStore } from "@/server/transit/stop-accessibility-guide-store";
import { readStopAccessibilityGuides } from "@/server/transit/stop-accessibility-guides";
import { PostgresStopRelocationStore } from "@/server/transit/stop-relocation-store";
import { readStopRelocations } from "@/server/transit/stop-relocations";

import {
  createTrustedAccessibilityEvidenceSource,
  type TrustedAccessibilityReadDependencies,
} from "./accessibility-evidence-source";

import {
  exactAccessibilityResolvers,
  readAccessibilityElevators,
} from "./accessibility-evidence-production";
type ExactAdvisoryResolver = NonNullable<
  TrustedAccessibilityReadDependencies["resolveAdvisories"]
>;
type ExactRelocationResolver = NonNullable<
  TrustedAccessibilityReadDependencies["resolveRelocations"]
>;

let configuredEvidence:
  ReturnType<typeof createAccessibilityEvidence> | undefined;

export function createConfiguredAccessibilityEvidence(
  options: {
    resolveAdvisories?: ExactAdvisoryResolver;
    resolveRelocations?: ExactRelocationResolver;
  } = {},
) {
  const advisoryStore = new PostgresAccessibilityAdvisoryStore();
  const relocationStore = new PostgresStopRelocationStore();
  const guideStore = new PostgresStopAccessibilityGuideStore();
  const realtimeStore = new PostgresRealtimeSnapshotStore();

  const source = createTrustedAccessibilityEvidenceSource({
    readElevators: readAccessibilityElevators,
    readAdvisories: (at) =>
      readAccessibilityAdvisories({ at }, { store: advisoryStore }),
    readRelocations: (at) =>
      readStopRelocations({ at }, { store: relocationStore }),
    readGuides: (at) =>
      readStopAccessibilityGuides({ at }, { store: guideStore }),
    realtimeStore,
    resolveAdvisories:
      options.resolveAdvisories ??
      exactAccessibilityResolvers.resolveAdvisories,
    resolveRelocations:
      options.resolveRelocations ??
      exactAccessibilityResolvers.resolveRelocations,
  });

  return createAccessibilityEvidence(source);
}

export function getAccessibilityEvidence() {
  configuredEvidence ??= createConfiguredAccessibilityEvidence();
  return configuredEvidence;
}

export type { ExactAccessibilityAdvisory, ExactStopRelocation };
