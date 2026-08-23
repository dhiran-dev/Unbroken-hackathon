import type { Metadata } from "next";
import { Inter, Manrope } from "next/font/google";
import { notFound } from "next/navigation";

import { ProductPassport } from "@/components/pulserank/product-passport/product-passport";
import { toPublicProductDto } from "@/server/products/dto";
import { getProductBySlug } from "@/server/products/queries";

export const dynamic = "force-dynamic";

const passportBody = Inter({
  display: "swap",
  subsets: ["latin"],
  variable: "--passport-font-body",
});

const passportDisplay = Manrope({
  display: "swap",
  subsets: ["latin"],
  variable: "--passport-font-display",
});

type RouteProps = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: RouteProps): Promise<Metadata> {
  const { slug } = await params;
  const row = await getProductBySlug(slug);
  return row
    ? { title: row.product.name, description: `${row.product.name} product passport on PulseRank.` }
    : { title: "Product not found" };
}

export default async function ProductPage({ params }: RouteProps) {
  const { slug } = await params;
  const row = await getProductBySlug(slug);
  if (!row) notFound();

  return (
    <ProductPassport
      fontClassName={`${passportBody.variable} ${passportDisplay.variable}`}
      product={toPublicProductDto(row, { extendedFields: true })}
      variations={[
        ...(row.payload.variants ?? []).map((variant) => variant.name),
        ...(row.payload.flavours ?? []).map((flavour) => flavour.name),
      ]}
    />
  );
}
