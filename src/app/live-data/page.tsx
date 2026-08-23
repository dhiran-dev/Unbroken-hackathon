import type { Metadata } from "next";

import { LiveDataDashboard } from "@/components/pulserank/live-data/live-data-dashboard";
import { getLiveDataStats } from "@/server/products/queries";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Live Data",
  description: "Sanitized operational counts and trusted pipeline history from PulseRank.",
};

export default async function LiveDataPage() {
  const stats = await getLiveDataStats();
  return <LiveDataDashboard stats={stats} />;
}
