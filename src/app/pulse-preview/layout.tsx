import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "PulseRank",
  description: "PulseRank public observatory.",
};

export default function PulsePreviewLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}
