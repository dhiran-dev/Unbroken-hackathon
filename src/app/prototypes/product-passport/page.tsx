import { ProductPassportPrototypeClient } from "./prototype-client";
import { VARIANTS } from "./prototype-data";

type PrototypePageProps = {
  searchParams: Promise<{ v?: string | string[] | undefined }>;
};

export default async function ProductPassportPrototype({ searchParams }: PrototypePageProps) {
  const params = await searchParams;
  const rawValue = Array.isArray(params.v) ? params.v[0] : params.v;
  const value = Number(rawValue);
  const initialVariant = Number.isInteger(value) && value >= 1 && value <= VARIANTS.length ? value - 1 : 0;

  return <ProductPassportPrototypeClient initialVariant={initialVariant} />;
}
