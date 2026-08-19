import { z } from "zod";

import type { ServerEnv } from "@/lib/env";

const triggerResponseSchema = z.object({
  collection_id: z.string().regex(/^j_[A-Za-z0-9]+$/),
});

const API_BASE_URL = "https://api.brightdata.com";
const POLL_INTERVAL_MS = 5_000;
const COLLECTION_TIMEOUT_MS = 4 * 60 * 1_000 + 30_000;
const REQUEST_TIMEOUT_MS = 30_000;

export class BrightDataError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly retryable: boolean,
  ) {
    super(message);
    this.name = "BrightDataError";
  }
}

type BrightDataConfig = {
  BRIGHTDATA_API_TOKEN: ServerEnv["BRIGHTDATA_API_TOKEN"];
  BRIGHTDATA_COLLECTOR_ID: string;
  SFMTA_SOURCE_URL: string;
};

function delay(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

const MAX_RESPONSE_BYTES = 5 * 1024 * 1024;

async function boundedResponseText(response: Response) {
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
        throw new BrightDataError(
          "BRIGHT_DATA_RESPONSE_TOO_LARGE",
          "Bright Data returned a response larger than the safety limit.",
          false,
        );
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(body);
}

async function responsePayload(response: Response) {
  const text = await boundedResponseText(response);
  const contentType = response.headers
    .get("content-type")
    ?.split(";", 1)[0]
    ?.trim()
    .toLowerCase();

  if (
    contentType === "application/jsonl" ||
    contentType === "application/x-ndjson"
  ) {
    try {
      const lines = text
        .split(/\r?\n/)
        .filter((line) => line.trim().length > 0);
      if (lines.length === 0) return [];
      return lines.map((line) => JSON.parse(line) as unknown);
    } catch {
      try {
        const parsed = JSON.parse(text) as unknown;
        if (Array.isArray(parsed)) return parsed;
        if (parsed !== null && typeof parsed === "object") return [parsed];
      } catch {
        // The safe error below deliberately omits source content.
      }
      throw new BrightDataError(
        "BRIGHT_DATA_NON_JSON_RESPONSE",
        `Bright Data returned a non-JSON response with HTTP ${response.status}.`,
        response.status >= 500,
      );
    }
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new BrightDataError(
      "BRIGHT_DATA_NON_JSON_RESPONSE",
      `Bright Data returned a non-JSON response with HTTP ${response.status}.`,
      response.status >= 500,
    );
  }
}

async function requestWithRetry(
  request: () => Promise<Response>,
  attempts = 3,
) {
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await request();
      if (response.ok) return response;

      const retryable = response.status === 429 || response.status >= 500;
      if (!retryable || attempt === attempts) {
        throw new BrightDataError(
          `BRIGHT_DATA_HTTP_${response.status}`,
          `Bright Data request failed with HTTP ${response.status}.`,
          retryable,
        );
      }
      lastError = new BrightDataError(
        `BRIGHT_DATA_HTTP_${response.status}`,
        `Bright Data request failed with HTTP ${response.status}.`,
        true,
      );
    } catch (error) {
      if (error instanceof BrightDataError && !error.retryable) throw error;
      lastError = error;
      if (attempt === attempts) break;
    }

    const backoff =
      1_000 * 2 ** (attempt - 1) + Math.floor(Math.random() * 250);
    await delay(backoff);
  }

  if (lastError instanceof BrightDataError) throw lastError;
  throw new BrightDataError(
    "BRIGHT_DATA_TRANSPORT_FAILED",
    "Bright Data could not be reached after bounded retries.",
    true,
  );
}

export async function triggerBrightDataCollection(config: BrightDataConfig) {
  const triggerUrl = new URL("/dca/trigger", API_BASE_URL);
  triggerUrl.searchParams.set("collector", config.BRIGHTDATA_COLLECTOR_ID);
  triggerUrl.searchParams.set("queue_next", "1");
  triggerUrl.searchParams.set("confirm_cancel", "0");
  triggerUrl.searchParams.set("no_downloads", "1");
  triggerUrl.searchParams.set("deadline", "4m");

  const response = await requestWithRetry(() =>
    fetch(triggerUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.BRIGHTDATA_API_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify([{ url: config.SFMTA_SOURCE_URL }]),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    }),
  );
  const parsed = triggerResponseSchema.safeParse(
    await responsePayload(response),
  );
  if (!parsed.success) {
    throw new BrightDataError(
      "BRIGHT_DATA_TRIGGER_CONTRACT_INVALID",
      "Bright Data did not return a valid collection ID.",
      false,
    );
  }

  return parsed.data.collection_id;
}

export function normalizeCollectorPayload(payload: unknown) {
  if (Array.isArray(payload)) return payload;
  if (
    payload &&
    typeof payload === "object" &&
    "elevators" in payload &&
    Array.isArray(payload.elevators)
  ) {
    return [payload];
  }
  return null;
}

export async function downloadBrightDataDataset(
  config: BrightDataConfig,
  collectionId: string,
) {
  const datasetUrl = new URL("/dca/dataset", API_BASE_URL);
  datasetUrl.searchParams.set("id", collectionId);
  const deadline = Date.now() + COLLECTION_TIMEOUT_MS;

  while (Date.now() < deadline) {
    const response = await requestWithRetry(() =>
      fetch(datasetUrl, {
        headers: {
          Authorization: `Bearer ${config.BRIGHTDATA_API_TOKEN}`,
        },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      }),
    );
    const payload = await responsePayload(response);
    const normalized = normalizeCollectorPayload(payload);
    if (normalized) return normalized;
    await delay(POLL_INTERVAL_MS);
  }

  throw new BrightDataError(
    "BRIGHT_DATA_COLLECTION_TIMEOUT",
    "Bright Data did not finish the collection before the bounded deadline.",
    true,
  );
}

export async function collectBrightData(config: BrightDataConfig) {
  const collectionId = await triggerBrightDataCollection(config);
  const payload = await downloadBrightDataDataset(config, collectionId);
  return { collectionId, payload, collectedAt: new Date() };
}
