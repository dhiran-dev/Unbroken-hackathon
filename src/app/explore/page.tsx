import type { Metadata } from "next";

import { ExploreWorkspace } from "@/components/pulserank/explore/explore-workspace";
import { isExactPlotProduct } from "@/components/pulserank/explore/explore-model";
import { PublicHeader } from "@/components/pulserank/public-ui";
import { toPublicProductDto } from "@/server/products/dto";
import {
  getProductBySlug,
  listCategories,
  listProducts,
} from "@/server/products/queries";
import { parseProductListQuery } from "@/server/products/request-params";

import styles from "./explore.module.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Explore",
  description:
    "Search, filter, and inspect trusted caffeine observations without losing their serving or source context.",
};

type SearchParams = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function ExplorePage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const raw = await searchParams;
  const parameters = new URLSearchParams();
  for (const [key, value] of Object.entries(raw)) {
    const item = first(value);
    if (item !== undefined) parameters.set(key, item);
  }

  const parsed = parseProductListQuery(parameters);
  const filters = parsed.ok
    ? { ...parsed.value, cursor: null, limit: 24 }
    : { limit: 24 as const };
  const selectedSlug = first(raw.selected);

  const [result, categories, selectedRow] = await Promise.all([
    listProducts(filters),
    listCategories(),
    selectedSlug ? getProductBySlug(selectedSlug) : Promise.resolve(null),
  ]);

  const products = result.items.map((row) => toPublicProductDto(row));
  const requestedSelection = selectedRow ? toPublicProductDto(selectedRow) : null;
  const initialSelected =
    requestedSelection ??
    products.find((product) => isExactPlotProduct(product, "total")) ??
    products[0] ??
    null;
  const workspaceKey = JSON.stringify({
    filters: result.activeFacets,
    selected: initialSelected?.slug ?? null,
  });

  return (
    <div className={`${styles.exploreRoot} pr-app`}>
      <span
        aria-hidden="true"
        className={styles.directionContract}
        data-form-seed="pulserank-explore-observatory-v1"
        dangerouslySetInnerHTML={{
          __html: `<!--
            THESIS: Explore is a caffeine observatory, not a generic card catalog.
            OWN-WORLD: Near-black fields, blue hairlines, violet action, category signals, and procedural specimens.
            STORY: Filter trusted products, read exact normalized measurements, inspect qualifiers, then save or compare.
            FIRST VIEWPORT: Source-backed facets left, dominant exact-value plot center, evidence inspector right; search is the primary entry action.
            FORM: Three-zone operate workspace; form 1; seed pulserank-explore-observatory-v1.
            FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
          -->`,
        }}
      />
      <PublicHeader active="/explore" />
      <ExploreWorkspace
        key={workspaceKey}
        categories={categories}
        initialError={parsed.ok ? null : parsed.error}
        initialFilters={result.activeFacets}
        initialNextCursor={result.nextCursor}
        initialProducts={products}
        initialSelected={initialSelected}
        initialTotalCount={result.totalCount}
      />
    </div>
  );
}
