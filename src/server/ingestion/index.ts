/**
 * PulseRank ingestion server module (Agent A5).
 *
 * Deterministic pipeline stage: parsed V1 rows → run validation →
 * normalization → field-level promotion decisions → trusted-to-trusted change
 * detection. Everything here is pure: no database access, no network access,
 * no clock reads (timestamps are always parameters). Persistence and queueing
 * land in later agents.
 *
 * All future queries must be schema-qualified to `pulse.*`; legacy table reads
 * are prohibited.
 */

export {
  CANONICAL_CATEGORIES,
  computeConcentration,
  normalizeCategoryLabel,
  normalizeRow,
} from "./normalize";
export type {
  CanonicalCategory,
  ConcentrationResult,
  NormalizedCandidate,
  NormalizedFlavour,
  NormalizedMetricField,
  NormalizedServing,
  NormalizedVariant,
} from "./normalize";

export { validateRun } from "./validate-run";
export type {
  RunFinding,
  RunFindingCheck,
  RunFindingSeverity,
  RunValidationResult,
  ValidatableRow,
  ValidateRunOptions,
} from "./validate-run";

export { promoteCandidate } from "./promote";
export type {
  FieldVerdict,
  MetricFieldVerdict,
  PriorTrustedFields,
  PromotionDecision,
  PromotionIncident,
  PromoteContext,
  ServingFieldVerdict,
  TrustedFlavour,
  TrustedMetricPoint,
  TrustedProductRecord,
  TrustedServingPoint,
  TrustedVariant,
} from "./promote";

export { CHANGE_EVENT_TYPES, diffTrustedRecords } from "./change-detection";
export type {
  ChangeEvent,
  ChangeEventType,
  ChangePoint,
} from "./change-detection";
