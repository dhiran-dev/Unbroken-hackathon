import type { Metadata } from "next";

import { CompareWorkspace } from "@/components/pulserank/local-workspaces";
import { PageFrame } from "@/components/pulserank/public-ui";

export const metadata: Metadata = {
  title: "Compare",
  description: "Compare up to four trusted products using browser-local selection.",
};

export default function ComparePage() {
  return <PageFrame active="/compare" eyebrow="Local comparison tray · four slots" title="Put the numbers side by side." description="Compare exact source fields without an account. Your tray lives in this browser; the product records remain trusted public observations."><CompareWorkspace /></PageFrame>;
}
