import { seedTransitLandmarks } from "@/server/transit/landmark-seed";
import { PostgresLandmarkSeedStore } from "@/server/transit/landmark-seed-store";

try {
  await seedTransitLandmarks(new PostgresLandmarkSeedStore());
  console.info("Reviewed transit places are ready.");
} catch {
  console.error("Reviewed transit places could not be prepared.");
  process.exitCode = 1;
}
