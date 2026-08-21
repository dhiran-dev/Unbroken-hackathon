import type { Metadata } from "next";

import { MyPulseWorkspace } from "@/components/pulserank/local-workspaces";
import { PageFrame } from "@/components/pulserank/public-ui";

export const metadata: Metadata = {
  title: "My Pulse",
  description: "Your saved products, recent views, and My Day—stored only in this browser.",
};

export default function MyPulsePage() {
  return <PageFrame active="/my-pulse" eyebrow="Private by design · browser local" title="Your pulse, your storage." description="Save trusted products, build a local My Day, and move your data with a versioned backup. No login and no server-side personal profile."><MyPulseWorkspace /></PageFrame>;
}
