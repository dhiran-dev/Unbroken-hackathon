"use client";

import dynamic from "next/dynamic";

import { StageFallback } from "./stage-fallback";
import type { VisualStageProps } from "./stage-config";

const VisualStageClient = dynamic(
  () => import("./visual-stage-client").then((module) => module.VisualStageClient),
  {
    loading: () => <StageFallback variant="home" />,
    ssr: false,
  },
);

export function VisualStage(props: VisualStageProps) {
  return <VisualStageClient {...props} />;
}
