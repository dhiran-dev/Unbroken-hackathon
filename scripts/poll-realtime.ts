import { pollConfiguredRealtimeFeeds } from "@/server/transit/realtime-runtime";

try {
  const result = await pollConfiguredRealtimeFeeds(new Date());
  if (result.status === "disabled") {
    console.info("Realtime polling is disabled.");
  } else {
    const summary = result.results.reduce<Record<string, number>>(
      (counts, item) => {
        counts[item.status] = (counts[item.status] ?? 0) + 1;
        return counts;
      },
      {},
    );
    console.info("Realtime polling completed.", summary);
  }
} catch {
  console.error("Realtime polling could not be completed.");
  process.exitCode = 1;
}
