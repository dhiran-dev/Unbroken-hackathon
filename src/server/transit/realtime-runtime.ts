import { createRealtimeTransit } from "@/domain/transit/realtime";
import { getServerEnv } from "@/lib/env";
import {
  pollDueRealtimeFeeds,
  type RealtimePollDependencies,
} from "@/server/transit/realtime";
import {
  create511RealtimeSource,
  realtimeFeedDecoder,
} from "@/server/transit/realtime-source";
import {
  PostgresRealtimeReferenceSource,
  PostgresRealtimeSnapshotStore,
} from "@/server/transit/realtime-store";

let store: PostgresRealtimeSnapshotStore | undefined;
let references: PostgresRealtimeReferenceSource | undefined;

function getStore() {
  store ??= new PostgresRealtimeSnapshotStore();
  return store;
}

function getReferences() {
  references ??= new PostgresRealtimeReferenceSource();
  return references;
}

export function getRealtimeTransit() {
  return createRealtimeTransit(getStore());
}

export async function pollConfiguredRealtimeFeeds(at: Date) {
  const environment = getServerEnv();
  if (!environment.CITYWIDE_DATA_ENABLED) {
    return { status: "disabled" as const, results: [] };
  }
  if (!environment.TRANSIT_511_API_TOKEN) {
    return { status: "disabled" as const, results: [] };
  }
  const dependencies: RealtimePollDependencies & {
    readDataFlag: () => string | undefined;
  } = {
    store: getStore(),
    references: getReferences(),
    source: create511RealtimeSource({
      token: environment.TRANSIT_511_API_TOKEN,
    }),
    decoder: realtimeFeedDecoder,
    readDataFlag: () => (environment.CITYWIDE_DATA_ENABLED ? "true" : "false"),
  };
  return pollDueRealtimeFeeds({ at }, dependencies);
}
