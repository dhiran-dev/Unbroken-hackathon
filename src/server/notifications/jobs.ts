import {
  findDueSchedules,
  type DueSchedule,
} from "@/domain/notifications/due-schedules";
import {
  isCommuteEmailsEnabled,
  type NotificationPrepareResult,
  type NotificationScheduleSource,
  type NotificationSendResult,
} from "@/domain/notifications/outbox";

/** Keep one worker tick bounded by the maximum daily rider email budget. */
export const NOTIFICATION_BATCH_LIMIT = 80 as const;
/** One duplicate can be observed for each durable slot during a restart race. */
export const NOTIFICATION_PREPARATION_SCAN_LIMIT = NOTIFICATION_BATCH_LIMIT * 2;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

export type NotificationJobPlanner = {
  prepare(input: DueSchedule): Promise<NotificationPrepareResult>;
  sendNotification(
    outboxId: string,
    now: Date,
  ): Promise<NotificationSendResult>;
};

export type NotificationJobDependencies = {
  planner: NotificationJobPlanner;
  readEmailsFlag: () => unknown;
};

export type NotificationPreparationJobResult = {
  status: "completed" | "disabled" | "unavailable";
  prepared: number;
  duplicates: number;
  invalid: number;
};

export type NotificationSendQueue = {
  listDueOutboxIds(now: Date, limit: number): Promise<readonly string[]>;
};

export type NotificationSendJobResult = {
  status: "completed" | "disabled" | "unavailable";
  attempted: number;
  sent: number;
  retries: number;
  failed: number;
  deferred: number;
};

function validNow(value: unknown): value is Date {
  return value instanceof Date && Number.isFinite(value.getTime());
}

function emailsEnabled(readFlag: () => unknown) {
  try {
    return isCommuteEmailsEnabled(readFlag());
  } catch {
    return false;
  }
}

function validPreparationResult(
  value: unknown,
): value is NotificationPrepareResult {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const status = (value as { status?: unknown }).status;
  return (
    status === "prepared" ||
    status === "duplicate" ||
    status === "invalid" ||
    status === "disabled" ||
    status === "unavailable"
  );
}

function validSendResult(
  value: unknown,
  expectedOutboxId: string,
): value is NotificationSendResult {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const result = value as { status?: unknown; outboxId?: unknown };
  return (
    result.outboxId === expectedOutboxId &&
    UUID_PATTERN.test(expectedOutboxId) &&
    (result.status === "sent" ||
      result.status === "already_sent" ||
      result.status === "retry_scheduled" ||
      result.status === "failed" ||
      result.status === "deferred")
  );
}

/** Prepare a bounded deterministic scan; durable duplicates do not consume the new-item limit. */
export async function prepareDueNotifications(input: {
  source: NotificationScheduleSource;
  dependencies: NotificationJobDependencies;
  now: Date;
}): Promise<NotificationPreparationJobResult> {
  if (!emailsEnabled(input.dependencies.readEmailsFlag)) {
    return { status: "disabled", prepared: 0, duplicates: 0, invalid: 0 };
  }
  if (!validNow(input.now)) {
    return { status: "unavailable", prepared: 0, duplicates: 0, invalid: 0 };
  }

  let schedules;
  try {
    schedules = await input.source.listSchedules();
  } catch {
    return { status: "unavailable", prepared: 0, duplicates: 0, invalid: 0 };
  }

  if (!Array.isArray(schedules)) {
    return { status: "unavailable", prepared: 0, duplicates: 0, invalid: 0 };
  }
  let due: DueSchedule[];
  try {
    due = findDueSchedules({ schedules, now: input.now });
  } catch {
    return { status: "unavailable", prepared: 0, duplicates: 0, invalid: 0 };
  }
  let prepared = 0;
  let duplicates = 0;
  let invalid = 0;
  for (const item of due.slice(0, NOTIFICATION_PREPARATION_SCAN_LIMIT)) {
    if (prepared >= NOTIFICATION_BATCH_LIMIT) break;
    try {
      const result = await input.dependencies.planner.prepare(item);
      if (!validPreparationResult(result)) {
        return { status: "unavailable", prepared, duplicates, invalid };
      }
      if (result.status === "prepared") prepared += 1;
      else if (result.status === "duplicate") duplicates += 1;
      else if (result.status === "invalid") invalid += 1;
      else if (result.status === "disabled") {
        return { status: "disabled", prepared, duplicates, invalid };
      } else if (result.status === "unavailable") {
        return { status: "unavailable", prepared, duplicates, invalid };
      }
    } catch {
      return { status: "unavailable", prepared, duplicates, invalid };
    }
  }
  return { status: "completed", prepared, duplicates, invalid };
}

/** Claim and send at most one bounded batch; budgets and idempotency stay transactional. */
export async function sendDueNotifications(input: {
  queue: NotificationSendQueue;
  dependencies: NotificationJobDependencies;
  now: Date;
}): Promise<NotificationSendJobResult> {
  if (!emailsEnabled(input.dependencies.readEmailsFlag)) {
    return {
      status: "disabled",
      attempted: 0,
      sent: 0,
      retries: 0,
      failed: 0,
      deferred: 0,
    };
  }
  if (!validNow(input.now)) {
    return {
      status: "unavailable",
      attempted: 0,
      sent: 0,
      retries: 0,
      failed: 0,
      deferred: 0,
    };
  }

  let ids: readonly string[];
  try {
    ids = await input.queue.listDueOutboxIds(
      input.now,
      NOTIFICATION_BATCH_LIMIT,
    );
  } catch {
    return {
      status: "unavailable",
      attempted: 0,
      sent: 0,
      retries: 0,
      failed: 0,
      deferred: 0,
    };
  }
  if (!Array.isArray(ids)) {
    return {
      status: "unavailable",
      attempted: 0,
      sent: 0,
      retries: 0,
      failed: 0,
      deferred: 0,
    };
  }

  const seenIds = new Set<string>();
  for (const outboxId of ids) {
    if (
      typeof outboxId !== "string" ||
      !UUID_PATTERN.test(outboxId) ||
      seenIds.has(outboxId)
    ) {
      return {
        status: "unavailable",
        attempted: 0,
        sent: 0,
        retries: 0,
        failed: 0,
        deferred: 0,
      };
    }
    seenIds.add(outboxId);
  }

  let attempted = 0;
  let sent = 0;
  let retries = 0;
  let failed = 0;
  let deferred = 0;
  for (const outboxId of ids.slice(0, NOTIFICATION_BATCH_LIMIT)) {
    attempted += 1;
    try {
      const result = await input.dependencies.planner.sendNotification(
        outboxId,
        input.now,
      );
      if (!validSendResult(result, outboxId)) {
        return {
          status: "unavailable",
          attempted,
          sent,
          retries,
          failed,
          deferred,
        };
      }
      if (result.status === "deferred") {
        deferred += 1;
        if (
          result.reason === "budget_exhausted" ||
          result.reason === "circuit_paused"
        ) {
          break;
        }
      } else if (result.status === "sent" || result.status === "already_sent") {
        sent += 1;
      } else if (result.status === "retry_scheduled") {
        retries += 1;
      } else {
        failed += 1;
      }
    } catch {
      return {
        status: "unavailable",
        attempted,
        sent,
        retries,
        failed,
        deferred,
      };
    }
  }
  return { status: "completed", attempted, sent, retries, failed, deferred };
}
