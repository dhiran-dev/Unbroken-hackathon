import type { DueSchedule, SavedCommuteSchedule } from "./due-schedules";

export const DAILY_EMAIL_BUDGET = 80 as const;
export const MONTHLY_EMAIL_BUDGET = 2_480;
export const MAX_NOTIFICATION_ATTEMPTS = 3 as const;
export const SEND_LEASE_MS = 5 * 60 * 1_000;
export const RETRY_DELAYS_MS = [60_000, 300_000, 900_000] as const;

export type NotificationPrepareResult =
  | { status: "disabled" }
  | { status: "invalid" }
  | { status: "unavailable" }
  | { status: "prepared" }
  | { status: "duplicate" };

export type NotificationFailureCode =
  | "timeout"
  | "rate_limited"
  | "quota_exhausted"
  | "provider_error"
  | "message_error"
  | "recipient_unavailable";

export type NotificationOutboxStatus =
  "pending" | "sending" | "sent" | "failed" | "suppressed";

export type NotificationOutboxRecord = {
  id: string;
  scheduleId: string;
  serviceDate: string;
  departureAt: Date;
  idempotencyKey: string;
  status: NotificationOutboxStatus;
  attemptCount: number;
  nextAttemptAt: Date | null;
};

export type NotificationSendClaim = {
  outboxId: string;
  scheduleId: string;
  serviceDate: string;
  departureAt: Date;
  idempotencyKey: string;
  attemptNumber: number;
};

export type NotificationClaimResult =
  | { status: "claimed"; claim: NotificationSendClaim }
  | {
      status:
        | "already_sent"
        | "budget_exhausted"
        | "circuit_paused"
        | "failed"
        | "in_flight"
        | "not_found"
        | "retry_not_due"
        | "suppressed";
    };

export type NotificationSendReadiness =
  { status: "ready" } | { status: "suppressed" | "ignored" };

export type NotificationMessage = {
  subject: string;
  text: string;
  html: string;
};

export type NotificationProviderRequest = NotificationMessage & {
  to: string;
  idempotencyKey: string;
};

export type ProviderSendResult =
  | { status: "sent"; providerMessageId: string | null }
  | { status: "failed"; reason: NotificationFailureCode };

export type NotificationFailureDecision = {
  status: "retry_scheduled" | "failed" | "suppressed";
  errorCode: NotificationFailureCode;
  nextAttemptAt: Date | null;
  pauseCircuit: boolean;
};

export type NotificationSendResult =
  | { status: "sent" | "already_sent"; outboxId: string }
  | {
      status: "deferred";
      outboxId: string;
      reason:
        | "disabled"
        | "budget_exhausted"
        | "circuit_paused"
        | "in_flight"
        | "not_found"
        | "retry_not_due"
        | "suppressed";
    }
  | { status: "retry_scheduled"; outboxId: string; nextAttemptAt: Date }
  | { status: "failed"; outboxId: string };

/**
 * The outbox adapter is the transactional seam. Its implementation owns the
 * unique schedule/date and idempotency constraints; this domain module never
 * copies a rider's address into the prepared item.
 */
export interface NotificationOutboxStore {
  prepare(
    input: DueSchedule,
  ): Promise<
    | { status: "prepared"; outboxId: string }
    | { status: "duplicate"; outboxId: string }
  >;
}

export interface NotificationDeliveryStore extends NotificationOutboxStore {
  /** Claims the outbox row and both budget ledgers in one locked transaction. */
  claim(input: {
    outboxId: string;
    now: Date;
    dailyBudget: number;
    monthlyBudget: number;
    maxAttempts: number;
    leaseMs: number;
  }): Promise<NotificationClaimResult>;
  /** Rechecks the locked database clock immediately before recipient/provider work. */
  confirmSendReady(input: {
    claim: NotificationSendClaim;
  }): Promise<NotificationSendReadiness>;
  markSent(input: {
    claim: NotificationSendClaim;
    providerMessageId: string | null;
  }): Promise<{ status: "sent" | "already_sent" | "ignored" }>;
  markFailure(input: {
    claim: NotificationSendClaim;
    decision: NotificationFailureDecision;
  }): Promise<{
    status: "retry_scheduled" | "failed" | "suppressed" | "ignored";
    nextAttemptAt?: Date;
  }>;
}

export interface NotificationProvider {
  send(input: NotificationProviderRequest): Promise<ProviderSendResult>;
}

export interface NotificationRecipientResolver {
  /** The returned address is transient and must never be persisted or logged. */
  resolveRecipient(outboxId: string): Promise<string | null>;
}

export interface NotificationScheduleSource {
  listSchedules(): Promise<readonly SavedCommuteSchedule[]>;
}

export type NotificationMessageBuilder = (
  outboxId: string,
) => Promise<NotificationMessage>;

export type NotificationOutboxDependencies = {
  store: NotificationOutboxStore;
  provider?: NotificationProvider;
  recipientResolver?: NotificationRecipientResolver;
  buildMessage?: NotificationMessageBuilder;
  readEmailsFlag: () => unknown;
  maxAttempts?: number;
  retryDelaysMs?: readonly number[];
  sendLeaseMs?: number;
};

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;
const SAFE_PROVIDER_ID_PATTERN = /^[A-Za-z0-9_-]{1,160}$/u;
const APPROVED_LEADS = new Set([15, 30, 45, 60]);

export function isCommuteEmailsEnabled(value: unknown): value is "true" {
  return value === "true";
}

function emailsEnabled(readFlag: () => unknown) {
  try {
    return isCommuteEmailsEnabled(readFlag());
  } catch {
    return false;
  }
}

function validServiceDate(value: string) {
  if (!DATE_PATTERN.test(value)) return false;
  const date = new Date(value + "T00:00:00.000Z");
  return (
    Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
  );
}

function canonicalId(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

function validDueSchedule(value: unknown): value is DueSchedule {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  const scheduleId = candidate.scheduleId;
  const serviceDate = candidate.serviceDate;
  const dueAt = candidate.dueAt;
  const departureAt = candidate.departureAt;
  const leadMinutes = candidate.leadMinutes;
  return (
    canonicalId(scheduleId) &&
    typeof serviceDate === "string" &&
    validServiceDate(serviceDate) &&
    candidate.idempotencyKey === "commute/" + scheduleId + "/" + serviceDate &&
    dueAt instanceof Date &&
    Number.isFinite(dueAt.getTime()) &&
    departureAt instanceof Date &&
    Number.isFinite(departureAt.getTime()) &&
    APPROVED_LEADS.has(leadMinutes as number) &&
    dueAt.getTime() + (leadMinutes as number) * 60_000 === departureAt.getTime()
  );
}

function validOutboxId(value: unknown): value is string {
  return canonicalId(value);
}

function validStoreResult(value: unknown): value is {
  status: "prepared" | "duplicate";
  outboxId: string;
} {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  if (candidate.status !== "prepared" && candidate.status !== "duplicate") {
    return false;
  }
  return validOutboxId(candidate.outboxId);
}

function validOutboxIdInput(value: string) {
  return canonicalId(value);
}

function validFailureCode(value: unknown): value is NotificationFailureCode {
  return (
    value === "timeout" ||
    value === "rate_limited" ||
    value === "quota_exhausted" ||
    value === "provider_error" ||
    value === "message_error" ||
    value === "recipient_unavailable"
  );
}

function validClaim(
  value: unknown,
  outboxId: string,
  now: Date,
  maxAttempts: number,
): value is { status: "claimed"; claim: NotificationSendClaim } {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const result = value as Record<string, unknown>;
  if (result.status !== "claimed") return false;
  if (!result.claim || typeof result.claim !== "object") return false;
  const claim = result.claim as Record<string, unknown>;
  return (
    claim.outboxId === outboxId &&
    canonicalId(claim.scheduleId) &&
    typeof claim.serviceDate === "string" &&
    validServiceDate(claim.serviceDate) &&
    claim.idempotencyKey ===
      "commute/" + claim.scheduleId + "/" + claim.serviceDate &&
    claim.departureAt instanceof Date &&
    Number.isFinite(claim.departureAt.getTime()) &&
    claim.departureAt > now &&
    Number.isSafeInteger(claim.attemptNumber) &&
    (claim.attemptNumber as number) >= 1 &&
    (claim.attemptNumber as number) <= maxAttempts
  );
}

function validClaimStatus(value: unknown): value is NotificationClaimResult {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const status = (value as Record<string, unknown>).status;
  return (
    status === "already_sent" ||
    status === "budget_exhausted" ||
    status === "circuit_paused" ||
    status === "failed" ||
    status === "in_flight" ||
    status === "not_found" ||
    status === "retry_not_due" ||
    status === "suppressed"
  );
}

function validRecipient(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length >= 3 &&
    value.length <= 254 &&
    value === value.trim() &&
    /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/u.test(value) &&
    !/[\u0000-\u001f\u007f]/u.test(value)
  );
}

function validMessage(value: unknown): value is NotificationMessage {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.subject === "string" &&
    candidate.subject.length > 0 &&
    candidate.subject.length <= 160 &&
    candidate.subject === candidate.subject.trim() &&
    !/[<>\u0000-\u001f\u007f]/u.test(candidate.subject) &&
    typeof candidate.text === "string" &&
    candidate.text.length > 0 &&
    candidate.text.length <= 50_000 &&
    !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(candidate.text) &&
    typeof candidate.html === "string" &&
    candidate.html.length > 0 &&
    candidate.html.length <= 200_000 &&
    !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(candidate.html)
  );
}

export function decideNotificationFailure(input: {
  now: Date;
  departureAt: Date;
  attemptNumber: number;
  failure: NotificationFailureCode;
  maxAttempts?: number;
  retryDelaysMs?: readonly number[];
}): NotificationFailureDecision {
  const maxAttempts = input.maxAttempts ?? MAX_NOTIFICATION_ATTEMPTS;
  const retryDelaysMs = input.retryDelaysMs ?? RETRY_DELAYS_MS;
  const pauseCircuit = ["rate_limited", "quota_exhausted"].includes(
    input.failure,
  );
  const terminal =
    !Number.isSafeInteger(input.attemptNumber) ||
    input.attemptNumber < 1 ||
    input.attemptNumber >= maxAttempts ||
    !Number.isFinite(input.now.getTime()) ||
    !Number.isFinite(input.departureAt.getTime()) ||
    input.now >= input.departureAt;

  if (terminal) {
    return {
      status: input.now >= input.departureAt ? "suppressed" : "failed",
      errorCode: input.failure,
      nextAttemptAt: null,
      pauseCircuit,
    };
  }

  const delay =
    retryDelaysMs[Math.min(input.attemptNumber - 1, retryDelaysMs.length - 1)];
  if (delay === undefined || !Number.isSafeInteger(delay) || delay < 0) {
    return {
      status: "failed",
      errorCode: input.failure,
      nextAttemptAt: null,
      pauseCircuit,
    };
  }
  const nextAttemptAt = new Date(input.now.getTime() + delay);
  if (
    !Number.isFinite(nextAttemptAt.getTime()) ||
    nextAttemptAt >= input.departureAt
  ) {
    return {
      status: "suppressed",
      errorCode: input.failure,
      nextAttemptAt: null,
      pauseCircuit,
    };
  }
  return {
    status: "retry_scheduled",
    errorCode: input.failure,
    nextAttemptAt,
    pauseCircuit,
  };
}

export function createNotificationOutbox(
  dependencies: NotificationOutboxDependencies,
) {
  const configuredMaxAttempts = dependencies.maxAttempts;
  const maxAttempts =
    typeof configuredMaxAttempts === "number" &&
    Number.isSafeInteger(configuredMaxAttempts) &&
    configuredMaxAttempts >= 1 &&
    configuredMaxAttempts <= 10
      ? configuredMaxAttempts
      : MAX_NOTIFICATION_ATTEMPTS;
  const configuredRetryDelays = dependencies.retryDelaysMs;
  const retryDelaysMs =
    Array.isArray(configuredRetryDelays) &&
    configuredRetryDelays.length > 0 &&
    configuredRetryDelays.length <= 10 &&
    configuredRetryDelays.every(
      (delay) =>
        Number.isSafeInteger(delay) && delay >= 0 && delay <= 86_400_000,
    )
      ? configuredRetryDelays
      : RETRY_DELAYS_MS;
  const configuredLease = dependencies.sendLeaseMs;
  const sendLeaseMs =
    typeof configuredLease === "number" &&
    Number.isSafeInteger(configuredLease) &&
    configuredLease >= 1_000 &&
    configuredLease <= 3_600_000
      ? configuredLease
      : SEND_LEASE_MS;

  const prepare = async (
    input: DueSchedule,
  ): Promise<NotificationPrepareResult> => {
    if (!emailsEnabled(dependencies.readEmailsFlag)) {
      return { status: "disabled" };
    }
    if (!validDueSchedule(input)) return { status: "invalid" };
    try {
      const result = await dependencies.store.prepare(input);
      if (!validStoreResult(result)) return { status: "unavailable" };
      return { status: result.status };
    } catch {
      return { status: "unavailable" };
    }
  };

  const recordFailure = async (
    store: NotificationDeliveryStore,
    claim: NotificationSendClaim,
    now: Date,
    failure: NotificationFailureCode,
  ): Promise<NotificationSendResult> => {
    const decision = decideNotificationFailure({
      now,
      departureAt: claim.departureAt,
      attemptNumber: claim.attemptNumber,
      failure,
      maxAttempts,
      retryDelaysMs,
    });
    try {
      const recorded = await store.markFailure({ claim, decision });
      if (
        !recorded ||
        typeof recorded !== "object" ||
        Array.isArray(recorded) ||
        (recorded.status !== "retry_scheduled" &&
          recorded.status !== "failed" &&
          recorded.status !== "suppressed" &&
          recorded.status !== "ignored")
      ) {
        return { status: "failed", outboxId: claim.outboxId };
      }
      if (recorded.status === "retry_scheduled") {
        const nextAttemptAt = recorded.nextAttemptAt;
        if (
          !(nextAttemptAt instanceof Date) ||
          !Number.isFinite(nextAttemptAt.getTime()) ||
          nextAttemptAt <= now ||
          nextAttemptAt >= claim.departureAt
        ) {
          return { status: "failed", outboxId: claim.outboxId };
        }
        return {
          status: "retry_scheduled",
          outboxId: claim.outboxId,
          nextAttemptAt,
        };
      }
      if (recorded.status === "suppressed") {
        return {
          status: "deferred",
          outboxId: claim.outboxId,
          reason: "suppressed",
        };
      }
      return { status: "failed", outboxId: claim.outboxId };
    } catch {
      return { status: "failed", outboxId: claim.outboxId };
    }
  };

  return {
    prepare,
    async sendNotification(
      outboxId: string,
      now: Date,
    ): Promise<NotificationSendResult> {
      if (!emailsEnabled(dependencies.readEmailsFlag)) {
        return { status: "deferred", outboxId, reason: "disabled" };
      }
      if (
        !validOutboxIdInput(outboxId) ||
        !(now instanceof Date) ||
        !Number.isFinite(now.getTime())
      ) {
        return { status: "deferred", outboxId, reason: "not_found" };
      }
      const candidateStore =
        dependencies.store as Partial<NotificationDeliveryStore>;
      if (
        typeof candidateStore.claim !== "function" ||
        typeof candidateStore.confirmSendReady !== "function" ||
        typeof candidateStore.markSent !== "function" ||
        typeof candidateStore.markFailure !== "function" ||
        !dependencies.provider ||
        !dependencies.recipientResolver ||
        !dependencies.buildMessage
      ) {
        return { status: "failed", outboxId };
      }
      const store = candidateStore as NotificationDeliveryStore;

      let claimed: NotificationClaimResult;
      try {
        const candidate = await store.claim({
          outboxId,
          now,
          dailyBudget: DAILY_EMAIL_BUDGET,
          monthlyBudget: MONTHLY_EMAIL_BUDGET,
          maxAttempts,
          leaseMs: sendLeaseMs,
        });
        if ((candidate as { status?: unknown } | null)?.status === "claimed") {
          if (!validClaim(candidate, outboxId, now, maxAttempts)) {
            return { status: "failed", outboxId };
          }
        } else if (!validClaimStatus(candidate)) {
          return { status: "failed", outboxId };
        }
        claimed = candidate;
      } catch {
        return { status: "failed", outboxId };
      }
      if (claimed.status !== "claimed") {
        if (claimed.status === "already_sent") {
          return { status: "already_sent", outboxId };
        }
        if (claimed.status === "failed") return { status: "failed", outboxId };
        return { status: "deferred", outboxId, reason: claimed.status };
      }

      const claim = claimed.claim;
      let message: NotificationMessage;
      try {
        const candidate = await dependencies.buildMessage(outboxId);
        if (!validMessage(candidate)) throw new Error("invalid message");
        message = candidate;
      } catch {
        return recordFailure(store, claim, now, "message_error");
      }

      let recipient: string | null = null;
      try {
        const candidate =
          await dependencies.recipientResolver.resolveRecipient(outboxId);
        recipient = validRecipient(candidate) ? candidate : null;
      } catch {
        recipient = null;
      }
      if (!recipient) {
        return recordFailure(store, claim, now, "recipient_unavailable");
      }

      let readiness: NotificationSendReadiness;
      try {
        const candidate = await store.confirmSendReady({ claim });
        if (
          !candidate ||
          typeof candidate !== "object" ||
          Array.isArray(candidate) ||
          (candidate.status !== "ready" &&
            candidate.status !== "suppressed" &&
            candidate.status !== "ignored")
        ) {
          return { status: "failed", outboxId };
        }
        readiness = candidate;
      } catch {
        return { status: "failed", outboxId };
      }
      if (readiness.status === "suppressed") {
        return { status: "deferred", outboxId, reason: "suppressed" };
      }
      if (readiness.status === "ignored") {
        return { status: "failed", outboxId };
      }

      let result: ProviderSendResult;
      try {
        const candidate = await dependencies.provider.send({
          ...message,
          to: recipient,
          idempotencyKey: claim.idempotencyKey,
        });
        if (
          candidate &&
          typeof candidate === "object" &&
          candidate.status === "sent" &&
          (candidate.providerMessageId === null ||
            (typeof candidate.providerMessageId === "string" &&
              SAFE_PROVIDER_ID_PATTERN.test(candidate.providerMessageId)))
        ) {
          result = candidate;
        } else if (
          candidate &&
          typeof candidate === "object" &&
          candidate.status === "failed" &&
          validFailureCode(candidate.reason)
        ) {
          result = candidate;
        } else {
          result = { status: "failed", reason: "provider_error" };
        }
      } catch {
        result = { status: "failed", reason: "provider_error" };
      }

      if (result.status === "sent") {
        const providerMessageId =
          result.providerMessageId === null ||
          SAFE_PROVIDER_ID_PATTERN.test(result.providerMessageId)
            ? result.providerMessageId
            : null;
        try {
          const recorded = await store.markSent({
            claim,
            providerMessageId,
          });
          return recorded.status === "sent" ||
            recorded.status === "already_sent"
            ? { status: recorded.status, outboxId }
            : { status: "failed", outboxId };
        } catch {
          return { status: "failed", outboxId };
        }
      }

      return recordFailure(store, claim, now, result.reason);
    },
  };
}
