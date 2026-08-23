import { Inter, Manrope } from "next/font/google";
import { notFound } from "next/navigation";

import { toPublicProductDto } from "@/server/products/dto";
import { getProductBySlug } from "@/server/products/queries";

import { GlassProductPassport } from "./prototype-client";

export const dynamic = "force-dynamic";

const body = Inter({
  display: "swap",
  subsets: ["latin"],
  variable: "--glass-passport-body",
});

const display = Manrope({
  display: "swap",
  subsets: ["latin"],
  variable: "--glass-passport-display",
});

export default async function GlassProductPassportPage() {
  const row = await getProductBySlug("mega-monster-energy-drink");
  if (!row) notFound();

  return (
    <GlassProductPassport
      fontClassName={`${body.variable} ${display.variable}`}
      product={toPublicProductDto(row, { extendedFields: true })}
    />
  );
}
