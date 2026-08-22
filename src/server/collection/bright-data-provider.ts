import { z } from "zod";

import { rawOutputFingerprint } from "@/server/collection/bdata-client";

const API_BASE_URL = "https://api.brightdata.com";
const REQUEST_TIMEOUT_MS = 30_000;
const MAX_RESPONSE_BYTES = 10 * 1024 * 1024;
export const DEFAULT_PROVIDER_WINDOW_MS = 60 * 60 * 1_000;
export const PULSERANK_BRIGHT_DATA_COLLECTOR_ID = "c_mt33nlnkq376z132b";

const triggerResponseSchema = z.object({
  collection_id: z.string().regex(/^j_[A-Za-z0-9]+$/),
});

const jobManifestSchema = z.object({
  status: z.string(),
  inputs: z.number().int().nonnegative(),
  dup_inputs: z.number().int().nonnegative(),
  lines: z.number().int().nonnegative(),
  fails: z.number().int().nonnegative(),
  pages: z.number().int().nonnegative(),
  pages_left: z.number().int().nonnegative(),
  success: z.number().int().nonnegative(),
  success_rate: z.number().finite().nonnegative(),
});

export type ProviderJobManifest = {
  status: string;
  inputs: number;
  duplicateInputs: number;
  lines: number;
  fails: number;
  pages: number;
  pagesLeft: number;
  success: number;
  successRate: number;
};

export type BrightDataProviderConfig = {
  apiToken: string;
  collectorId: string;
};

export type ProviderPollResult =
  | { status: "pending" }
  | {
      status: "ready";
      rows: unknown[];
      fingerprint: string;
      manifest: ProviderJobManifest;
    };

export interface BrightDataProvider {
  submit(input: { url: string }): Promise<{ collectionId: string }>;
  poll(collectionId: string): Promise<ProviderPollResult>;
}

type FetchLike = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

export class BrightDataProviderError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly retryable: boolean,
  ) {
    super(message);
    this.name = "BrightDataProviderError";
  }
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function boundedText(response: Response): Promise<string> {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_RESPONSE_BYTES) {
        throw new BrightDataProviderError(
          "provider_response_too_large",
          "Bright Data returned more data than the ingestion safety limit allows.",
          false,
        );
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(output);
}

function parsePayload(text: string, contentType: string | null): unknown {
  if (text.trim() === "") return null;
  if (
    contentType?.includes("application/jsonl") ||
    contentType?.includes("application/x-ndjson")
  ) {
    try {
      return text
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => JSON.parse(line) as unknown);
    } catch {
      throw new BrightDataProviderError(
        "provider_contract_invalid",
        "Bright Data returned invalid NDJSON.",
        false,
      );
    }
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new BrightDataProviderError(
      "provider_contract_invalid",
      "Bright Data returned a non-JSON response.",
      false,
    );
  }
}

async function requestWithRetry(
  request: () => Promise<Response>,
  attempts = 3,
): Promise<Response> {
  let last: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await request();
      if (response.ok) return response;
      const retryable = response.status === 429 || response.status >= 500;
      if (!retryable) {
        throw new BrightDataProviderError(
          `provider_http_${response.status}`,
          `Bright Data request failed with HTTP ${response.status}.`,
          false,
        );
      }
      last = new BrightDataProviderError(
        `provider_http_${response.status}`,
        `Bright Data request failed with HTTP ${response.status}.`,
        true,
      );
    } catch (error) {
      if (error instanceof BrightDataProviderError && !error.retryable) throw error;
      last = error;
    }
    if (attempt < attempts) await delay(Math.min(1_000 * 2 ** (attempt - 1), 4_000));
  }
  if (last instanceof BrightDataProviderError) throw last;
  throw new BrightDataProviderError(
    "provider_transport_failed",
    "Bright Data could not be reached after bounded retries.",
    true,
  );
}

function isPendingPayload(payload: unknown): boolean {
  if (payload === null) return true;
  if (typeof payload === "string") {
    return /pending|building|running|queued|not ready/i.test(payload);
  }
  if (typeof payload === "object" && !Array.isArray(payload)) {
    const status = (payload as { status?: unknown }).status;
    return typeof status === "string" && /pending|building|running|queued/i.test(status);
  }
  return false;
}

export function createBrightDataProvider(
  config: BrightDataProviderConfig,
  fetchImpl: FetchLike = fetch,
): BrightDataProvider {
  if (config.collectorId !== PULSERANK_BRIGHT_DATA_COLLECTOR_ID) {
    throw new BrightDataProviderError(
      "provider_collector_not_allowed",
      "The configured Bright Data collector is not permitted for PulseRank.",
      false,
    );
  }
  const authorization = `Bearer ${config.apiToken}`;
  return {
    async submit(input) {
      const url = new URL("/dca/trigger", API_BASE_URL);
      url.searchParams.set("collector", config.collectorId);
      url.searchParams.set("queue_next", "1");
      url.searchParams.set("confirm_cancel", "0");
      url.searchParams.set("no_downloads", "1");
      url.searchParams.set("deadline", "60m");

      const response = await requestWithRetry(() =>
        fetchImpl(url, {
          method: "POST",
          headers: {
            Authorization: authorization,
            "Content-Type": "application/json",
          },
          body: JSON.stringify([{ url: input.url }]),
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        }),
      );
      const payload = parsePayload(
        await boundedText(response),
        response.headers.get("content-type"),
      );
      const parsed = triggerResponseSchema.safeParse(payload);
      if (!parsed.success) {
        throw new BrightDataProviderError(
          "provider_trigger_contract_invalid",
          "Bright Data did not return a valid collection ID.",
          false,
        );
      }
      return { collectionId: parsed.data.collection_id };
    },

    async poll(collectionId) {
      if (!/^j_[A-Za-z0-9]+$/.test(collectionId)) {
        throw new BrightDataProviderError(
          "provider_collection_id_invalid",
          "The persisted Bright Data collection ID is invalid.",
          false,
        );
      }
      const url = new URL("/dca/dataset", API_BASE_URL);
      url.searchParams.set("id", collectionId);
      const response = await requestWithRetry(() =>
        fetchImpl(url, {
          headers: { Authorization: authorization },
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        }),
      );
      if (response.status === 202 || response.status === 204) return { status: "pending" };
      const payload = parsePayload(
        await boundedText(response),
        response.headers.get("content-type"),
      );
      if (isPendingPayload(payload)) return { status: "pending" };
      if (!Array.isArray(payload)) {
        throw new BrightDataProviderError(
          "provider_dataset_contract_invalid",
          "Bright Data dataset was neither pending nor a JSON array.",
          false,
        );
      }
      const logUrl = new URL(`/dca/log/${collectionId}`, API_BASE_URL);
      const logResponse = await requestWithRetry(() =>
        fetchImpl(logUrl, {
          headers: { Authorization: authorization },
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        }),
      );
      const logPayload = parsePayload(
        await boundedText(logResponse),
        logResponse.headers.get("content-type"),
      );
      const log = jobManifestSchema.safeParse(logPayload);
      if (!log.success) {
        throw new BrightDataProviderError(
          "provider_manifest_contract_invalid",
          "Bright Data returned an invalid sanitized job manifest.",
          false,
        );
      }
      return {
        status: "ready",
        rows: payload,
        fingerprint: rawOutputFingerprint(payload),
        manifest: {
          status: log.data.status,
          inputs: log.data.inputs,
          duplicateInputs: log.data.dup_inputs,
          lines: log.data.lines,
          fails: log.data.fails,
          pages: log.data.pages,
          pagesLeft: log.data.pages_left,
          success: log.data.success,
          successRate: log.data.success_rate,
        },
      };
    },
  };
}

/** Lazy production adapter; importing this module never reads credentials. */
export async function createDefaultBrightDataProvider(): Promise<BrightDataProvider> {
  const { getServerEnv } = await import("@/lib/env");
  const env = getServerEnv();
  return createBrightDataProvider({
    apiToken: env.BRIGHTDATA_API_TOKEN,
    collectorId: env.BRIGHTDATA_COLLECTOR_ID,
  });
}
