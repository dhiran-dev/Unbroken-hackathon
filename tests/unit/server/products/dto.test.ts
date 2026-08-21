/**
 * Unit tests for the public product DTO mapper (Agent A8).
 *
 * Coverage per the A8 spec:
 * - trusted-only mapping (the mapper consumes rows that queries.ts produced
 *   through `current_trusted_observation_id` + `status = 'trusted'`)
 * - sparse field states preserved AS STATES — never flattened to zero; an
 *   explicit zero stays 0 with state "present"
 * - range qualifier passthrough (bounds ride along, mg stays null)
 * - concentration eligible ONLY when exact caffeine AND an ml volume exist
 * - extended-fields gating on PULSERANK_PUBLIC_EXTENDED_FIELDS
 * - audit-only image suppression
 *
 * Fixtures are promoted through the REAL pipeline (normalizeRow +
 * promoteCandidate) so the mapper is exercised against the exact record
 * shape the ingestion writer persists, not a hand-rolled lookalike.
 */

import { describe, expect, it } from "vitest";

import { computeConcentration, normalizeRow } from "@/server/ingestion/normalize";
import type { NormalizedCandidate } from "@/server/ingestion/normalize";
import { promoteCandidate } from "@/server/ingestion/promote";
import {
  PUBLIC_SCHEMA_VERSION,
  SOURCE_ATTRIBUTION,
  toPublicProductDto,
  type TrustedMediaBlock,
  type TrustedObservationPayload,
  type TrustedProductRow,
} from "@/server/products/dto";

import conflictingVariant from "@/domain/product/fixtures/conflicting-variant.json";
import explicitZeroSugar from "@/domain/product/fixtures/explicit-zero-sugar.json";
import perItemMint from "@/domain/product/fixtures/per-item-mint.json";
import rangeCaffeine from "@/domain/product/fixtures/range-caffeine.json";
import standardFull from "@/domain/product/fixtures/standard-full.json";
import standardSparse from "@/domain/product/fixtures/standard-sparse.json";

// ---------------------------------------------------------------------------
// Fixture plumbing: real pipeline → trusted observation payload → row
// ---------------------------------------------------------------------------

function asScrapeRow(row: unknown): Parameters<typeof normalizeRow>[0] {
  return row as Parameters<typeof normalizeRow>[0];
}

/** Promote a fixture through the real pipeline and attach derived blocks. */
function buildPayload(
  fixture: unknown,
  media: TrustedMediaBlock = {
    imageUrl: `https://images.example/${slugOf(fixture)}.jpg`,
    publicationState: "audit_only",
  },
): TrustedObservationPayload {
  const normalized: NormalizedCandidate = normalizeRow(asScrapeRow(fixture));
  const decision = promoteCandidate(normalized);
  return {
    ...decision.record,
    concentration: computeConcentration(
      normalized.caffeineMg,
      normalized.serving,
    ),
    media,
  };
}

function slugOf(fixture: unknown): string {
  const source = (fixture as { source?: { slug?: string } }).source;
  return source?.slug ?? "unknown-product";
}

const DEFAULT_OBSERVED_AT = new Date("2026-08-01T12:00:00.000Z");

function trustedRow(payload: TrustedObservationPayload): TrustedProductRow {
  return {
    product: {
      slug: payload.slug,
      name: payload.name,
      categoryLabel: "Energy Drinks",
    },
    observation: {
      id: "11111111-1111-4111-8111-111111111111",
      observedAt: DEFAULT_OBSERVED_AT,
      status: "trusted",
    },
    payload,
  };
}

// ---------------------------------------------------------------------------
// Trusted-only mapping
// ---------------------------------------------------------------------------

describe("toPublicProductDto — trusted-only mapping", () => {
  it("maps every core field of a trusted observation", () => {
    const dto = toPublicProductDto(trustedRow(buildPayload(standardFull)));

    expect(dto.slug).toBe("red-bull");
    expect(dto.name).toBe("Red Bull");
    expect(dto.category).toBe("energy-drink");
    expect(dto.caffeine.mg).toBe(80);
    expect(dto.caffeine.qualifier).toBe("exact");
    expect(dto.sourceAttribution).toBe(SOURCE_ATTRIBUTION);
  });

  it("never leaks raw source text in any published surface", () => {
    const dto = toPublicProductDto(trustedRow(buildPayload(standardFull)));
    expect(JSON.stringify(dto)).not.toContain("rawText");
    expect(JSON.stringify(dto)).not.toContain("80 mg per can");
  });

  it("carries the current public schema version constant", () => {
    expect(PUBLIC_SCHEMA_VERSION).toBe("1.0");
  });

  it("is deterministic — identical row in, identical DTO out", () => {
    const row = trustedRow(buildPayload(rangeCaffeine));
    expect(toPublicProductDto(row)).toEqual(toPublicProductDto(row));
  });

  it("prefers the payload observedAt over the row fallback timestamp", () => {
    const row = trustedRow(buildPayload(standardFull));
    expect(toPublicProductDto(row).observedAt).toBe("2026-08-21T09:30:00Z");

    const noPayloadTime = buildPayload(standardFull);
    noPayloadTime.observedAt = "";
    expect(
      toPublicProductDto(trustedRow(noPayloadTime)).observedAt,
    ).toBe(DEFAULT_OBSERVED_AT.toISOString());
  });
});

// ---------------------------------------------------------------------------
// Sparse states preserved as states — never coerced to zero
// ---------------------------------------------------------------------------

describe("toPublicProductDto — sparse states are data", () => {
  it("publishes not_published calories as state, not zero", () => {
    const dto = toPublicProductDto(trustedRow(buildPayload(standardSparse)), {
      extendedFields: true,
    });

    expect(dto.calories).toEqual({ kcal: null, state: "not_published" });
  });

  it("keeps unparseable sugar as its state", () => {
    const dto = toPublicProductDto(trustedRow(buildPayload(standardSparse)), {
      extendedFields: true,
    });

    expect(dto.sugar).toEqual({ g: null, state: "unparseable" });
  });

  it("keeps an explicit published zero as 0 with state present", () => {
    const dto = toPublicProductDto(
      trustedRow(buildPayload(explicitZeroSugar)),
      { extendedFields: true },
    );

    expect(dto.sugar).toEqual({ g: 0, state: "present" });
    // Sanity: zero is not silently rewritten to sparse.
    expect(dto.sugar?.g).not.toBeNull();
  });

  it("preserves conflicting-state fields as excluded, never zeroed", () => {
    const payload = buildPayload(conflictingVariant);
    // The fixture conflicts on a variant metric; force the primary caffeine
    // into the conflicting state the promotion table defines.
    payload.caffeineMg = {
      ...payload.caffeineMg,
      state: "conflicting",
      value: null,
      min: null,
      max: null,
    };
    const dto = toPublicProductDto(trustedRow(payload));

    expect(dto.rankingEligibility.totalCaffeine).toBe(false);
    expect(dto.rankingEligibility.reasons).toContain(
      "caffeine_conflicting_excluded",
    );
  });
});

// ---------------------------------------------------------------------------
// Range qualifier passthrough
// ---------------------------------------------------------------------------

describe("toPublicProductDto — ranges stay ranges", () => {
  it("passes bounds through verbatim and keeps mg null for a range", () => {
    const dto = toPublicProductDto(trustedRow(buildPayload(rangeCaffeine)));

    expect(dto.caffeine.qualifier).toBe("range");
    expect(dto.caffeine.mg).toBeNull();
    expect(dto.caffeine.min).toBe(95);
    expect(dto.caffeine.max).toBe(200);
    // Well-formed ranges remain total-caffeine board material.
    expect(dto.rankingEligibility.totalCaffeine).toBe(true);
  });

  it("never collapses a malformed range into a point value", () => {
    const payload = buildPayload(rangeCaffeine);
    payload.caffeineMg = {
      ...payload.caffeineMg,
      min: 300,
      max: 100, // inverted
    };
    const dto = toPublicProductDto(trustedRow(payload));

    expect(dto.caffeine.mg).toBeNull();
    expect(dto.caffeine.min).toBeNull();
    expect(dto.caffeine.max).toBeNull();
    expect(dto.rankingEligibility.totalCaffeine).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Concentration eligibility
// ---------------------------------------------------------------------------

describe("toPublicProductDto — concentration needs EXACT caffeine + ml volume", () => {
  it("is eligible for exact caffeine over an ml serving", () => {
    const dto = toPublicProductDto(trustedRow(buildPayload(standardFull)));

    expect(dto.concentration.mgPer100Ml).toBeCloseTo(32, 5); // 80 / 250 * 100
    expect(dto.rankingEligibility.concentration).toBe(true);
  });

  it("is ineligible for exact caffeine WITHOUT an ml volume (per item)", () => {
    const dto = toPublicProductDto(trustedRow(buildPayload(perItemMint)));

    expect(dto.concentration.mgPer100Ml).toBeNull();
    expect(dto.rankingEligibility.concentration).toBe(false);
    expect(dto.rankingEligibility.reasons).toContain(
      "concentration_requires_ml_volume",
    );
  });

  it("is ineligible for a RANGE even when an ml volume exists", () => {
    const dto = toPublicProductDto(trustedRow(buildPayload(rangeCaffeine)));

    expect(dto.concentration.mgPer100Ml).toBeNull();
    expect(dto.rankingEligibility.concentration).toBe(false);
    expect(dto.rankingEligibility.reasons).toContain(
      "concentration_requires_exact_caffeine",
    );
  });

  it("suppresses a bogus stored concentration number when inputs do not qualify", () => {
    const payload = buildPayload(rangeCaffeine);
    // A buggy writer persisted a number for a range+ml record.
    payload.concentration = { mgPer100Ml: 99.9, basis: "computed" };
    const dto = toPublicProductDto(trustedRow(payload));

    expect(dto.concentration.mgPer100Ml).toBeNull();
  });

  it("derives concentration when a legacy row lacks its stored block", () => {
    const payload = buildPayload(standardFull);
    payload.concentration = null as unknown as TrustedObservationPayload["concentration"];
    const dto = toPublicProductDto(trustedRow(payload));

    expect(dto.concentration.mgPer100Ml).toBeCloseTo(32, 5);
  });
});

// ---------------------------------------------------------------------------
// Extended-fields gating
// ---------------------------------------------------------------------------

describe("toPublicProductDto — extended nutrition fields are gated", () => {
  it("omits calories and sugar keys entirely when extended fields are off", () => {
    const dto = toPublicProductDto(trustedRow(buildPayload(standardFull)), {
      extendedFields: false,
    });

    expect("calories" in dto).toBe(false);
    expect("sugar" in dto).toBe(false);
  });

  it("emits calories and sugar values when extended fields are on", () => {
    const dto = toPublicProductDto(trustedRow(buildPayload(standardFull)), {
      extendedFields: true,
    });

    expect(dto.calories).toEqual({ kcal: 110, state: "present" });
    expect(dto.sugar).toEqual({ g: 27, state: "present" });
  });

  it("defaults to the server flag decision (off in this environment)", () => {
    const dto = toPublicProductDto(trustedRow(buildPayload(standardFull)));
    expect("calories" in dto).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Image publication policy
// ---------------------------------------------------------------------------

describe("toPublicProductDto — images follow the publication policy", () => {
  const url = "https://images.example/red-bull.jpg";

  it("suppresses audit_only media even though the URL exists", () => {
    const dto = toPublicProductDto(
      trustedRow(buildPayload(standardFull, { imageUrl: url, publicationState: "audit_only" })),
    );

    expect(dto.image).toBeNull();
  });

  it("publishes the URL only when the state is allowed", () => {
    const dto = toPublicProductDto(
      trustedRow(buildPayload(standardFull, { imageUrl: url, publicationState: "allowed" })),
    );

    expect(dto.image).toBe(url);
  });

  it("suppresses blocked media", () => {
    const dto = toPublicProductDto(
      trustedRow(buildPayload(standardFull, { imageUrl: url, publicationState: "blocked" })),
    );

    expect(dto.image).toBeNull();
  });

  it("treats a legacy trusted payload without media as image-less", () => {
    const payload = buildPayload(standardFull) as unknown as Record<string, unknown>;
    delete payload.media;

    const dto = toPublicProductDto(
      trustedRow(payload as unknown as TrustedObservationPayload),
    );

    expect(dto.image).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// DB integration (skipped until a seed harness exists)
// ---------------------------------------------------------------------------

// TODO-DB-SEED: these tests require a seeded Postgres instance carrying the
// pulse schema with: one product whose current_trusted_observation_id points
// at a trusted observation, sibling candidate/quarantined observations for the
// same product, aliases, change events, a leaderboard snapshot + entries,
// incidents (open + resolved), collection runs, and active/inactive
// collectors. Skipped until the DB seed harness lands.
describe.skip("public product queries against a seeded pulse database (TODO-DB-SEED)", () => {
  it.todo(
    "listProducts returns ONLY products reachable through " +
      "current_trusted_observation_id with status='trusted'",
  );

  it.todo(
    "listProducts applies search/category/caffeine/serving/exactOnly/" +
      "hasSugar/hasCalories/sourceLevel filters",
  );

  it.todo("listProducts keyset cursor pages are stable across inserts");

  it.todo("getLiveDataStats reports real counts matching seeded row counts");
});
