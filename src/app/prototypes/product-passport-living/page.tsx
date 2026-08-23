import { Inter, Manrope } from "next/font/google";
import { notFound } from "next/navigation";

import { toPublicProductDto } from "@/server/products/dto";
import { getProductBySlug } from "@/server/products/queries";

import { LivingProductPassport } from "./prototype-client";

export const dynamic = "force-dynamic";

const body = Inter({
  display: "swap",
  subsets: ["latin"],
  variable: "--living-passport-body",
});

const display = Manrope({
  display: "swap",
  subsets: ["latin"],
  variable: "--living-passport-display",
});

const VARIANTS = ["grotto", "conservatory", "herbarium"] as const;
type Variant = (typeof VARIANTS)[number];

function isVariant(value: string | undefined): value is Variant {
  return VARIANTS.includes(value as Variant);
}

export default async function LivingProductPassportPage({
  searchParams,
}: {
  searchParams: Promise<{ variant?: string }>;
}) {
  const row = await getProductBySlug("mega-monster-energy-drink");
  if (!row) notFound();

  const params = await searchParams;
  const variant = isVariant(params.variant) ? params.variant : "grotto";

  return (
    <LivingProductPassport
      fontClassName={`${body.variable} ${display.variable}`}
      initialVariant={variant}
      product={toPublicProductDto(row, { extendedFields: true })}
    />
  );
}
