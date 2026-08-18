import { z } from "zod";

export const incidentActionSchema = z.enum([
  "acknowledge",
  "heal",
  "review",
  "approve",
  "reject",
  "verify",
]);

export type IncidentAction = z.infer<typeof incidentActionSchema>;

export const incidentActionBodySchema = z.object({
  prompt: z.string().trim().min(20).max(700).optional(),
  confirmation: z.string().trim().max(80).optional(),
});

export const brightDataHealEnvelopeSchema = z
  .object({
    collector_id: z.string().regex(/^c_[A-Za-z0-9]+$/),
    status: z.string().min(1),
    completed_steps: z.array(z.string()).default([]),
    prompt: z.string().optional(),
    view_url: z.string().url().optional(),
    next_step: z.string().optional(),
    preview_result: z.unknown().optional(),
    diff_summary: z.string().optional(),
    error: z.string().optional(),
  })
  .passthrough();

export const fireworksReviewSchema = z.object({
  recommendation: z.enum(["approve", "reject", "human_review"]),
  confidence: z.number().int().min(0).max(100),
  summary: z.string().min(1).max(800),
  risks: z.array(z.string().min(1).max(300)).max(8),
  suspected_inventions: z.array(z.string().min(1).max(300)).max(8),
  missing_stations: z.array(z.string().min(1).max(120)).max(20),
  missing_equipment: z.array(z.string().min(1).max(180)).max(60),
  format_compatible: z.boolean(),
  required_human_checks: z.array(z.string().min(1).max(300)).min(1).max(10),
});

export type FireworksReview = z.infer<typeof fireworksReviewSchema>;

export const fireworksReviewJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    recommendation: {
      type: "string",
      enum: ["approve", "reject", "human_review"],
    },
    confidence: { type: "integer", minimum: 0, maximum: 100 },
    summary: { type: "string" },
    risks: { type: "array", items: { type: "string" }, maxItems: 8 },
    suspected_inventions: {
      type: "array",
      items: { type: "string" },
      maxItems: 8,
    },
    missing_stations: {
      type: "array",
      items: { type: "string" },
      maxItems: 20,
    },
    missing_equipment: {
      type: "array",
      items: { type: "string" },
      maxItems: 60,
    },
    format_compatible: { type: "boolean" },
    required_human_checks: {
      type: "array",
      items: { type: "string" },
      minItems: 1,
      maxItems: 10,
    },
  },
  required: [
    "recommendation",
    "confidence",
    "summary",
    "risks",
    "suspected_inventions",
    "missing_stations",
    "missing_equipment",
    "format_compatible",
    "required_human_checks",
  ],
} as const;

export const APPROVAL_CONFIRMATION = "APPROVE HEALED COLLECTOR";
export const REJECTION_CONFIRMATION = "REJECT HEALED COLLECTOR";
