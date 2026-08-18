import { z } from "zod";

import {
  fireworksReviewJsonSchema,
  fireworksReviewSchema,
} from "@/domain/incidents/contract";
import { getServerEnv } from "@/lib/env";

const fireworksResponseSchema = z.object({
  model: z.string(),
  choices: z
    .array(
      z.object({
        finish_reason: z.string().nullable().optional(),
        message: z.object({
          content: z.string().nullable(),
        }),
      }),
    )
    .min(1),
});

export class FireworksReviewError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "FireworksReviewError";
  }
}

export async function requestFireworksReview(
  evidence: Record<string, unknown>,
  fetchImplementation: typeof fetch = fetch,
) {
  const env = getServerEnv();
  const endpoint = `${env.FIREWORKS_API_BASE_URL.replace(/\/$/, "")}/chat/completions`;
  const response = await fetchImplementation(
    endpoint,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.FIREWORKS_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: env.FIREWORKS_MODEL,
        reasoning_effort: env.FIREWORKS_REASONING_EFFORT,
        temperature: 0,
        max_tokens: 1_600,
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "unbroken_healing_review",
            strict: true,
            schema: fireworksReviewJsonSchema,
          },
        },
        messages: [
          {
            role: "system",
            content:
              "You are an advisory reviewer for an accessibility-data scraper repair. Return JSON only. Never approve deployment yourself. Treat missing values and invented station or elevator records as critical risks.",
          },
          {
            role: "user",
            content:
              "Review this deterministic preview evidence. Recommend approve, reject, or human_review. The recommendation is advisory and a human must make the final decision. JSON evidence:\n" +
              JSON.stringify(evidence),
          },
        ],
      }),
      signal: AbortSignal.timeout(60_000),
    },
  );

  if (!response.ok) {
    throw new FireworksReviewError(
      `FIREWORKS_HTTP_${response.status}`,
      "Fireworks could not complete the advisory review.",
    );
  }

  const envelope = fireworksResponseSchema.safeParse(await response.json());
  if (!envelope.success) {
    throw new FireworksReviewError(
      "FIREWORKS_RESPONSE_INVALID",
      "Fireworks returned an unexpected response envelope.",
    );
  }
  if (envelope.data.model !== env.FIREWORKS_MODEL) {
    throw new FireworksReviewError(
      "FIREWORKS_MODEL_MISMATCH",
      "Fireworks did not return the exact configured review model.",
    );
  }

  const choice = envelope.data.choices[0];
  if (!choice || choice.finish_reason === "length" || !choice.message.content) {
    throw new FireworksReviewError(
      "FIREWORKS_OUTPUT_INCOMPLETE",
      "Fireworks returned an incomplete advisory review.",
    );
  }

  let candidate: unknown;
  try {
    candidate = JSON.parse(choice.message.content);
  } catch {
    throw new FireworksReviewError(
      "FIREWORKS_OUTPUT_NOT_JSON",
      "Fireworks did not return parseable structured JSON.",
    );
  }

  const review = fireworksReviewSchema.safeParse(candidate);
  if (!review.success) {
    throw new FireworksReviewError(
      "FIREWORKS_OUTPUT_SCHEMA_INVALID",
      "Fireworks returned JSON that failed the review contract.",
    );
  }

  return {
    review: review.data,
    model: envelope.data.model,
    reasoningEffort: env.FIREWORKS_REASONING_EFFORT,
  };
}
