"use client";

import dynamic from "next/dynamic";
import type { ComponentProps } from "react";

const DynamicCitywideStopMap = dynamic(
  () => import("./citywide-stop-map").then((module) => module.CitywideStopMap),
  {
    ssr: false,
    loading: () => (
      <div
        aria-label="Loading citywide stop map"
        className="h-[26.25rem] w-full animate-pulse rounded-xl border bg-muted/20"
        role="status"
      />
    ),
  },
);

export type LazyCitywideStopMapProps = ComponentProps<
  typeof DynamicCitywideStopMap
>;

export function LazyCitywideStopMap(props: LazyCitywideStopMapProps) {
  return <DynamicCitywideStopMap {...props} />;
}

export default LazyCitywideStopMap;
