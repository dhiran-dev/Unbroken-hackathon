import { COMMUTE_SLOTS, isCommuteSlot, validateCommuteDraft } from "./schedule";
import type {
  CommuteDay,
  CommuteDraft,
  CommuteSlot,
  ReminderMinutes,
} from "./schedule";

export type StoredCommute = {
  id: string;
  userId: string;
  slot: CommuteSlot;
  originPlaceId: string;
  destinationPlaceId: string;
  days: readonly CommuteDay[];
  departureTime: string;
  timezone: "America/Los_Angeles";
  reminderMinutes: ReminderMinutes;
  paused: boolean;
  createdAt: Date;
  updatedAt: Date;
};

export type SavedCommute = Omit<
  StoredCommute,
  "userId" | "createdAt" | "updatedAt"
> & {
  createdAt: string;
  updatedAt: string;
};

export interface CommuteScheduleStore {
  listForRider(userId: string): Promise<StoredCommute[]>;
  replaceForRider(
    userId: string,
    slot: CommuteSlot,
    draft: CommuteDraft,
  ): Promise<StoredCommute>;
  deleteForRider(userId: string, slot: CommuteSlot): Promise<void>;
}

export type CommutePlace = { id: string };

export interface CommutePlaceCatalog {
  getPlace(ref: { placeId: string }): Promise<CommutePlace | null>;
}

export type CommuteService = {
  listForRider(userId: string): Promise<SavedCommute[]>;
  replaceForRider(
    userId: string,
    slot: CommuteSlot,
    input: unknown,
  ): Promise<
    { ok: true; value: SavedCommute } | { ok: false; code: "COMMUTE_INVALID" }
  >;
  deleteForRider(userId: string, slot: CommuteSlot): Promise<void>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isSafeIdentifier(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 255 &&
    value === value.trim() &&
    !/[<>\u0000-\u001f\u007f]/u.test(value)
  );
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

function isCanonicalScheduleId(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

/**
 * Normalize a row at the domain seam before any rider-facing projection.
 * Persistence is allowed to be malformed; callers must never receive a
 * partially normalized schedule or an untrusted owner/slot.
 */
export function normalizeStoredCommute(value: unknown): StoredCommute | null {
  if (!isRecord(value)) return null;

  const createdAt = value.createdAt;
  const updatedAt = value.updatedAt;
  if (
    !isCanonicalScheduleId(value.id) ||
    !isSafeIdentifier(value.userId) ||
    !isCommuteSlot(value.slot) ||
    !(createdAt instanceof Date) ||
    Number.isNaN(createdAt.getTime()) ||
    !(updatedAt instanceof Date) ||
    Number.isNaN(updatedAt.getTime())
  ) {
    return null;
  }

  const validation = validateCommuteDraft({
    originPlaceId: value.originPlaceId,
    destinationPlaceId: value.destinationPlaceId,
    days: value.days,
    departureTime: value.departureTime,
    reminderMinutes: value.reminderMinutes,
    paused: value.paused,
  });
  if (!validation.ok || value.timezone !== "America/Los_Angeles") return null;

  return {
    id: value.id,
    userId: value.userId,
    slot: value.slot,
    ...validation.value,
    createdAt: new Date(createdAt.getTime()),
    updatedAt: new Date(updatedAt.getTime()),
  };
}

function toSavedCommute(record: StoredCommute): SavedCommute {
  return {
    id: record.id,
    slot: record.slot,
    originPlaceId: record.originPlaceId,
    destinationPlaceId: record.destinationPlaceId,
    days: [...record.days],
    departureTime: record.departureTime,
    timezone: record.timezone,
    reminderMinutes: record.reminderMinutes,
    paused: record.paused,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

function invalidStoredCommute(): never {
  throw new Error("COMMUTE_STORE_INVALID");
}

export function createCommuteService(
  store: CommuteScheduleStore,
  catalog: CommutePlaceCatalog,
): CommuteService {
  return {
    async listForRider(userId) {
      if (!isSafeIdentifier(userId)) return [];
      const records = await store.listForRider(userId);
      if (!Array.isArray(records) || records.length > COMMUTE_SLOTS.length) {
        return invalidStoredCommute();
      }
      const normalized = records.map((record) => {
        const value = normalizeStoredCommute(record);
        if (!value || value.userId !== userId) return invalidStoredCommute();
        return value;
      });
      const seenSlots = new Set<CommuteSlot>();
      for (const record of normalized) {
        if (seenSlots.has(record.slot)) return invalidStoredCommute();
        seenSlots.add(record.slot);
      }
      return normalized
        .sort((left, right) =>
          left.slot === right.slot ? 0 : left.slot === "first" ? -1 : 1,
        )
        .map(toSavedCommute);
    },

    async replaceForRider(userId, slot, input) {
      if (!isSafeIdentifier(userId) || !isCommuteSlot(slot)) {
        return { ok: false, code: "COMMUTE_INVALID" };
      }
      const validation = validateCommuteDraft(input);
      if (!validation.ok) return validation;

      const [origin, destination] = await Promise.all([
        catalog.getPlace({ placeId: validation.value.originPlaceId }),
        catalog.getPlace({ placeId: validation.value.destinationPlaceId }),
      ]);
      if (
        !origin ||
        origin.id !== validation.value.originPlaceId ||
        !destination ||
        destination.id !== validation.value.destinationPlaceId
      ) {
        return { ok: false, code: "COMMUTE_INVALID" };
      }

      const record = await store.replaceForRider(
        userId,
        slot,
        validation.value,
      );
      const normalized = normalizeStoredCommute(record);
      if (
        !normalized ||
        normalized.userId !== userId ||
        normalized.slot !== slot
      ) {
        return invalidStoredCommute();
      }
      return { ok: true, value: toSavedCommute(normalized) };
    },

    deleteForRider(userId, slot) {
      if (!isSafeIdentifier(userId) || !isCommuteSlot(slot)) {
        return Promise.resolve();
      }
      return store.deleteForRider(userId, slot);
    },
  };
}
