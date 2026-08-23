/**
 * PulseRank V1 field states.
 *
 * Source of truth: docs/plans/pulserank-master-implementation-plan.md §8.2 (copied verbatim).
 *
 * PROVISIONAL contract: frozen only at G3, pending the A1 page-shape matrix and
 * real A2 collector output. See docs/handoffs/A3-contract.md.
 */

export type FieldState =
  | "present"
  | "not_published"
  | "unparseable"
  | "conflicting"
  | "not_applicable";
