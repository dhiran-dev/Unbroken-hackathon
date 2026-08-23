import type { Metadata } from "next";

import { MyPulsePage as MyPulseSurface } from "@/components/pulserank/my-pulse/my-pulse-page";

export const metadata: Metadata = {
  title: "My Pulse",
  description: "Your saved products, recent views, and My Day—stored only in this browser.",
};

export default function MyPulsePage() {
  return <MyPulseSurface />;
}
