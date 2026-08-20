import type {
  NotificationProvider,
  NotificationProviderRequest,
  ProviderSendResult,
} from "@/domain/notifications/outbox";

const RESEND_EMAILS_ENDPOINT = "https://api.resend.com/emails" as const;
const PROVIDER_ID_PATTERN = /^[A-Za-z0-9_-]{1,160}$/u;
const EMAIL_PATTERN = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/u;
const KEY_PATTERN =
  /^commute\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/\d{4}-\d{2}-\d{2}$/u;
const MAX_RESPONSE_BYTES = 4_096;
const MAX_TIMEOUT_MS = 30_000;

type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

export type ResendEmailProviderOptions = {
  apiKey: string;
  from: string;
  fetchImpl?: FetchLike;
  timeoutMs?: number;
};

function validCalendarDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
  const date = new Date(value + "T00:00:00.000Z");
  return (
    Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
  );
}

function validEmail(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length <= 254 &&
    value === value.trim() &&
    EMAIL_PATTERN.test(value) &&
    !/[\u0000-\u001f\u007f]/u.test(value)
  );
}

function validApiKey(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 512 &&
    value === value.trim() &&
    !/[\s\u0000-\u001f\u007f]/u.test(value)
  );
}

function validRequest(input: unknown): input is NotificationProviderRequest {
  if (!input || typeof input !== "object" || Array.isArray(input)) return false;
  const candidate = input as Record<string, unknown>;
  const subject = candidate.subject;
  const text = candidate.text;
  const html = candidate.html;
  const idempotencyKey = candidate.idempotencyKey;
  return (
    validEmail(candidate.to) &&
    typeof subject === "string" &&
    subject.length > 0 &&
    subject.length <= 160 &&
    subject === subject.trim() &&
    !/[\u0000-\u001f\u007f]/u.test(subject) &&
    typeof text === "string" &&
    text.length > 0 &&
    text.length <= 50_000 &&
    !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(text) &&
    typeof html === "string" &&
    html.length > 0 &&
    html.length <= 200_000 &&
    !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(html) &&
    typeof idempotencyKey === "string" &&
    KEY_PATTERN.test(idempotencyKey) &&
    validCalendarDate(idempotencyKey.slice(-10))
  );
}

function providerMessageId(value: unknown): string | null {
  return typeof value === "string" && PROVIDER_ID_PATTERN.test(value)
    ? value
    : null;
}

async function boundedJson(response: Response): Promise<unknown | null> {
  const contentType = response.headers.get("content-type") ?? "";
  const mediaType = contentType.split(";", 1)[0]?.trim().toLowerCase();
  if (mediaType !== "application/json") return null;
  const contentLength = response.headers.get("content-length");
  if (contentLength !== null) {
    const parsed = Number(contentLength);
    if (
      !Number.isSafeInteger(parsed) ||
      parsed < 0 ||
      parsed > MAX_RESPONSE_BYTES
    ) {
      return null;
    }
  }

  if (!response.body) {
    const text = await response.text();
    if (new TextEncoder().encode(text).byteLength > MAX_RESPONSE_BYTES) {
      return null;
    }
    try {
      return JSON.parse(text) as unknown;
    } catch {
      return null;
    }
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      total += next.value.byteLength;
      if (total > MAX_RESPONSE_BYTES) {
        await reader.cancel();
        return null;
      }
      chunks.push(next.value);
    }
  } catch {
    return null;
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
  } catch {
    return null;
  }
}

export class ResendEmailProvider implements NotificationProvider {
  private readonly fetchImpl: FetchLike;
  private readonly timeoutMs: number;

  constructor(private readonly options: ResendEmailProviderOptions) {
    this.fetchImpl = options.fetchImpl ?? ((input, init) => fetch(input, init));
    const configuredTimeout = options.timeoutMs;
    const safeTimeout =
      typeof configuredTimeout === "number" &&
      Number.isSafeInteger(configuredTimeout) &&
      configuredTimeout > 0
        ? configuredTimeout
        : 10_000;
    this.timeoutMs = Math.min(safeTimeout, MAX_TIMEOUT_MS);
  }

  async send(input: NotificationProviderRequest): Promise<ProviderSendResult> {
    if (
      !validApiKey(this.options.apiKey) ||
      !validEmail(this.options.from) ||
      !validRequest(input)
    ) {
      return { status: "failed", reason: "provider_error" };
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(RESEND_EMAILS_ENDPOINT, {
        method: "POST",
        headers: {
          Authorization: "Bearer " + this.options.apiKey,
          Accept: "application/json",
          "Content-Type": "application/json",
          "Idempotency-Key": input.idempotencyKey,
        },
        body: JSON.stringify({
          from: this.options.from,
          to: input.to,
          subject: input.subject,
          text: input.text,
          html: input.html,
        }),
        signal: controller.signal,
        redirect: "error",
      });

      if (response.status === 408) {
        return { status: "failed", reason: "timeout" };
      }
      if (response.status === 429) {
        return { status: "failed", reason: "rate_limited" };
      }
      if (response.status === 402) {
        return { status: "failed", reason: "quota_exhausted" };
      }
      if (response.status < 200 || response.status >= 300) {
        return { status: "failed", reason: "provider_error" };
      }

      const body = await boundedJson(response);
      const id =
        body && typeof body === "object"
          ? providerMessageId((body as { id?: unknown }).id)
          : null;
      if (!id) return { status: "failed", reason: "provider_error" };
      return { status: "sent", providerMessageId: id };
    } catch (error) {
      const errorName =
        error && typeof error === "object" && "name" in error
          ? (error as { name?: unknown }).name
          : null;
      return {
        status: "failed",
        reason: errorName === "AbortError" ? "timeout" : "provider_error",
      };
    } finally {
      clearTimeout(timeout);
    }
  }
}
