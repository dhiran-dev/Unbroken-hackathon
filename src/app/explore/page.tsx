import type { Metadata } from "next";

import {
  CANONICAL_CATEGORIES,
} from "@/server/ingestion/normalize";
import { toPublicProductDto } from "@/server/products/dto";
import { listCategories, listProducts, getProductBySlug } from "@/server/products/queries";
import { parseProductListQuery } from "@/server/products/request-params";
import {
  EmptyState,
  ProductCard,
  PublicHeader,
  ScatterPlot,
  SearchForm,
  categoryLabel,
  caffeineText,
  servingText,
} from "@/components/pulserank/public-ui";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Explore",
  description: "Filter and compare trusted caffeine product observations.",
};

type SearchParams = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function ExplorePage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const raw = await searchParams;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(raw)) {
    const item = first(value);
    if (item !== undefined) params.set(key, item);
  }
  const parsed = parseProductListQuery(params);
  const filters = parsed.ok ? parsed.value : {};
  const [result, categories] = await Promise.all([
    listProducts({ ...filters, limit: 48 }),
    listCategories(),
  ]);
  const products = result.items.map((row) => toPublicProductDto(row));
  const selectedSlug = first(raw.selected);
  const selectedRow = selectedSlug ? await getProductBySlug(selectedSlug) : null;
  const selected = selectedRow ? toPublicProductDto(selectedRow) : null;

  return (
    <div className="pr-app">
      <PublicHeader active="/explore" />
      <main className="pr-shell pr-main">
        <div className="pr-page-heading"><p className="pr-eyebrow">Catalog / trusted snapshot</p><h1>Explore the signal.</h1><p className="pr-page-description">Search the published catalog, narrow it by category and serving, then inspect the exact fields that qualify a product for comparison.</p></div>
        <div className="pr-explore-toolbar">
          <aside className="pr-filter-panel"><h2>Filter the catalog</h2><form action="/explore" method="get">
            <div className="pr-filter-group"><label htmlFor="filter-category">Category</label><select id="filter-category" name="category" defaultValue={filters.category ?? ""}><option value="">All categories</option>{CANONICAL_CATEGORIES.map((category) => <option key={category} value={category}>{categoryLabel(category)}</option>)}</select></div>
            <div className="pr-filter-group"><label>Caffeine range (mg)</label><div className="pr-filter-inline"><input name="caffeineMinMg" type="number" min="0" placeholder="Min" defaultValue={filters.caffeineMinMg ?? ""} /><input name="caffeineMaxMg" type="number" min="0" placeholder="Max" defaultValue={filters.caffeineMaxMg ?? ""} /></div></div>
            <div className="pr-filter-group"><label htmlFor="filter-serving">Serving type</label><select id="filter-serving" name="servingForm" defaultValue={filters.servingForm ?? ""}><option value="">All forms</option>{["drink", "concentrate", "mix", "food", "supplement", "item", "unknown"].map((form) => <option key={form} value={form}>{form}</option>)}</select></div>
            <div className="pr-filter-group"><label className="pr-filter-check"><input type="checkbox" name="exactOnly" value="true" defaultChecked={filters.exactOnly === true} /> Exact caffeine only</label></div>
            <button type="submit" className="pr-button pr-button-primary">Apply filters</button>{parsed.ok ? null : <p className="pr-action-message">One filter was invalid; showing the trusted catalog.</p>}
          </form></aside>
          <section>
            <SearchForm initialValue={filters.search ?? ""} />
            <div className="pr-results-meta"><span><strong>{products.length}</strong> products in this page</span><span>{categories.length} active categories</span></div>
            <ScatterPlot products={products} />
            {selected ? <div className="pr-selected-drawer"><strong>Selected: {selected.name}</strong> · {caffeineText(selected.caffeine)} · {servingText(selected)} · <a href={`/products/${selected.slug}`}>Open passport</a></div> : null}
            {products.length > 0 ? <div className="pr-product-grid">{products.map((product) => <ProductCard key={product.slug} product={product} />)}</div> : <EmptyState />}
          </section>
        </div>
      </main>
    </div>
  );
}
