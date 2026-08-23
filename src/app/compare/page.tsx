import type { Metadata } from "next";
import { Inter, Manrope } from "next/font/google";

import { CompareWorkspace } from "@/components/pulserank/compare/compare-workspace";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Compare products",
  description:
    "Compare up to four trusted caffeine products with explicit serving, field-state, source, and ranking context.",
};

const compareBody = Inter({
  display: "swap",
  subsets: ["latin"],
  variable: "--compare-font-body",
});

const compareDisplay = Manrope({
  display: "swap",
  subsets: ["latin"],
  variable: "--compare-font-display",
});

export default async function ComparePage() {
  return (
    <CompareWorkspace
      fontClassName={`${compareBody.variable} ${compareDisplay.variable}`}
    />
  );
}
