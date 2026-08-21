/**
 * PulseRank V1 observation shapes.
 *
 * Source of truth: PULSERANK_MASTER_IMPLEMENTATION_PLAN.md §8.3 (NumberObservation)
 * and §8.4 (ServingObservation), copied verbatim.
 *
 * PROVISIONAL contract: frozen only at G3, pending the A1 page-shape matrix and
 * real A2 collector output. See docs/handoffs/A3-contract.md.
 */

import type { FieldState } from "./field-states";

export type NumberObservation = {
  state: FieldState;
  value: number | null;
  min: number | null;
  max: number | null;
  qualifier: "exact" | "range" | "approximate" | "estimated" | "unknown";
  rawText: string | null;
  candidates: number[];
};

export type ServingObservation = {
  state: FieldState;
  value: number | null;
  unit:
    | "ml"
    | "fl_oz"
    | "oz"
    | "g"
    | "cup"
    | "can"
    | "bottle"
    | "shot"
    | "mint"
    | "candy"
    | "gum_piece"
    | "tablet"
    | "packet"
    | "serving"
    | "item"
    | "unknown"
    | null;
  form: "drink" | "concentrate" | "mix" | "food" | "supplement" | "item" | "unknown";
  normalizedMl: number | null;
  rawText: string | null;
};
