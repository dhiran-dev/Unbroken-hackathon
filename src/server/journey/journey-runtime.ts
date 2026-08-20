import {
  createJourneyPlanner,
  type JourneyPlanner,
} from "@/domain/journey/journey";
import { createJourneyPlannerCore } from "@/domain/journey/journey-planner";

import { getAccessibilityEvidence } from "./accessibility-evidence-runtime";
import { createOtpRouteEngine } from "./otp-client";
import { getTransitCatalog } from "../transit/catalog";

let configuredPlanner: JourneyPlanner | undefined;
let plannerLoading: Promise<JourneyPlanner> | undefined;

function buildJourneyPlanner(): JourneyPlanner {
  const catalog = getTransitCatalog();
  const routeEngine = createOtpRouteEngine();
  const accessibilityEvidence = getAccessibilityEvidence();
  const core = createJourneyPlannerCore({
    routeEngine,
    accessibilityEvidence,
  });
  return createJourneyPlanner({ catalog, core, clock: () => new Date() });
}

export function getJourneyPlanner(): Promise<JourneyPlanner> {
  if (configuredPlanner) return Promise.resolve(configuredPlanner);
  if (!plannerLoading) {
    plannerLoading = Promise.resolve()
      .then(buildJourneyPlanner)
      .then((planner) => {
        configuredPlanner = planner;
        return planner;
      })
      .catch((error: unknown) => {
        plannerLoading = undefined;
        throw error;
      });
  }
  return plannerLoading;
}
