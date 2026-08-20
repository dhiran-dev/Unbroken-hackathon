import {
  createPublicLiveVehicles,
  type PublicLiveVehicles,
} from "@/domain/transit/live-vehicles";
import { getRealtimeTransit } from "@/server/transit/realtime-runtime";

let liveVehicles: PublicLiveVehicles | undefined;

export function getPublicLiveVehicles() {
  liveVehicles ??= createPublicLiveVehicles(getRealtimeTransit());
  return liveVehicles;
}
