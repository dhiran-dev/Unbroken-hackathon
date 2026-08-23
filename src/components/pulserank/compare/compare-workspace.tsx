"use client";

import Link from "next/link";
import {
  BarChart3,
  Beaker,
  Box,
  CircleGauge,
  Flame,
  Info,
  PackageOpen,
  Plus,
  Search,
  ShieldCheck,
  Sun,
  Trash2,
  X,
  Zap,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";

import {
  addCompareSlug,
  clearCompare,
  getCompareSlugs,
  replaceCompareSlugs,
} from "@/lib/local-state/compare";
import type { PublicProductDto } from "@/server/products/dto";
import { PublishedProductImage } from "@/components/pulserank/product-image";

import {
  caffeineMetric,
  caloriesMetric,
  categoryProvenanceLabel,
  compareCategoryLabel,
  concentrationMetric,
  eligibilityLabel,
  observedAtLabel,
  servingMetric,
  sugarMetric,
  type CompareMetricView,
} from "./compare-model";
import { isCurrentCompareRequest, reconcileCompareSelection } from "./compare-reconciliation";
import styles from "./compare-workspace.module.css";

type ProductResponse = { product?: PublicProductDto };

const NAV_ITEMS = [
  ["/explore", "Explore"],
  ["/leaderboards", "Leaderboards"],
  ["/compare", "Compare"],
  ["/my-pulse", "My Pulse"],
  ["/changes", "Changes"],
] as const;

const ROWS = [
  {
    key: "caffeine",
    label: "Total caffeine",
    detail: "Per serving",
    icon: Zap,
    value: caffeineMetric,
  },
  {
    key: "serving",
    label: "Serving size",
    detail: "Amount per serving",
    icon: PackageOpen,
    value: servingMetric,
  },
  {
    key: "concentration",
    label: "Concentration",
    detail: "mg per 100 ml",
    icon: Beaker,
    value: concentrationMetric,
  },
  {
    key: "calories",
    label: "Calories",
    detail: "Per serving",
    icon: Flame,
    value: caloriesMetric,
  },
  {
    key: "sugar",
    label: "Sugar",
    detail: "Per serving",
    icon: Box,
    value: sugarMetric,
  },
] as const;

function ProductImage({ product }: { product: PublicProductDto }) {
  return (
    <PublishedProductImage
      alt={`${product.name} product packaging`}
      className={styles.productImage}
      fallback={(
        <div className={styles.fallbackArt} aria-hidden="true">
          <span>{product.name.slice(0, 2).toUpperCase()}</span>
        </div>
      )}
      height={112}
      name={product.name}
      slug={product.slug}
      width={112}
    />
  );
}

function Header() {
  return (
    <header className={styles.header}>
      <div className={styles.headerInner}>
        <Link className={styles.brand} href="/" aria-label="PulseRank home">
          <Zap aria-hidden="true" />
          <span>Pulse<strong>Rank</strong></span>
        </Link>
        <nav aria-label="Primary navigation" className={styles.nav}>
          {NAV_ITEMS.map(([href, label]) => (
            <Link
              aria-current={href === "/compare" ? "page" : undefined}
              className={href === "/compare" ? styles.navActive : undefined}
              href={href}
              key={href}
            >
              {label}
            </Link>
          ))}
        </nav>
        <form action="/explore" className={styles.search} method="get" role="search">
          <label className="sr-only" htmlFor="compare-search">Search products</label>
          <input id="compare-search" name="search" placeholder="Search products…" />
          <button aria-label="Search products" type="submit"><Search aria-hidden="true" /></button>
        </form>
        <button
          aria-label="PulseRank uses a dark-only appearance"
          className={styles.themeButton}
          disabled
          title="PulseRank uses a dark-only appearance"
          type="button"
        >
          <Sun aria-hidden="true" />
        </button>
      </div>
    </header>
  );
}

function AddProductCard({ compact = false, tableCell = false }: { compact?: boolean; tableCell?: boolean }) {
  const link = (
    <Link aria-label={tableCell ? "Add a product to compare" : undefined} className={compact ? styles.addButton : styles.addCard} href="/explore">
      <span className={styles.addIcon}><Plus aria-hidden="true" /></span>
      <span>{compact ? "Add product" : "Add a product"}</span>
      {!compact ? <small>Search or browse<br />to add a product</small> : null}
    </Link>
  );
  return tableCell ? <div aria-label="Add a product to compare" className={styles.addCardCell} role="columnheader">{link}</div> : link;
}

function ProductHeader({
  onRemove,
  product,
}: {
  onRemove: (slug: string) => void;
  product: PublicProductDto;
}) {
  return (
    <article aria-label={`${product.name} comparison column`} className={styles.productHeader} role="columnheader">
      <button
        aria-label={`Remove ${product.name} from comparison`}
        className={styles.removeButton}
        onClick={() => onRemove(product.slug)}
        type="button"
      >
        <X aria-hidden="true" />
      </button>
      <Link className={styles.productIdentity} href={`/products/${product.slug}`}>
        <div className={styles.productMedia}><ProductImage product={product} /></div>
        <div>
          <h2>{product.name}</h2>
          <p>
            {compareCategoryLabel(product.category)}
            <span> · {categoryProvenanceLabel(product.categoryProvenance)}</span>
          </p>
        </div>
      </Link>
      <div className={styles.provenance}>
        {product.sourceUrl ? (
          <a href={product.sourceUrl} rel="noreferrer noopener" target="_blank">
            <ShieldCheck aria-hidden="true" />
            {product.sourceAttribution}
          </a>
        ) : (
          <span>Source URL not published</span>
        )}
        <span>Observed {observedAtLabel(product.observedAt)}</span>
      </div>
    </article>
  );
}

function EmptyProductHeader({ index }: { index: number }) {
  return (
    <div aria-label={`Comparison slot ${index + 1}, no product selected`} className={styles.emptyProduct} role="columnheader">
      <span>Slot {index + 1}</span>
      <small>No product selected</small>
    </div>
  );
}

function MetricCell({ label, metric, productName }: { label: string; metric: CompareMetricView; productName: string }) {
  return (
    <div aria-label={`${label} for ${productName}: ${metric.primary}, ${metric.badge}`} className={styles.metricCell} role="cell">
      <div>
        <strong>{metric.primary}</strong>
        {metric.secondary ? <span>{metric.secondary}</span> : null}
      </div>
      <span className={`${styles.stateBadge} ${styles[`tone_${metric.tone}`]}`}>
        {metric.badge}
      </span>
    </div>
  );
}

function SourceCell({ product }: { product: PublicProductDto }) {
  return (
    <div aria-label={`Data status for ${product.name}: trusted observation, ${product.sourceAttribution}`} className={styles.sourceCell} role="cell">
      <ShieldCheck aria-hidden="true" />
      <div>
        <strong>Trusted observation</strong>
        <span>{product.sourceAttribution}</span>
      </div>
    </div>
  );
}

function EligibilityCell({ product }: { product: PublicProductDto }) {
  const eligibility = eligibilityLabel(product);
  return (
    <div aria-label={`Ranking eligibility for ${product.name}: ${eligibility.primary}, ${eligibility.secondary}`} className={`${styles.eligibilityCell} ${!eligibility.eligible ? styles.ineligible : ""}`} role="cell">
      <strong>{eligibility.primary}</strong>
      <span>{eligibility.secondary}</span>
    </div>
  );
}

function EmptyCell() {
  return <div aria-label="No product selected" className={styles.emptyCell} role="cell">—</div>;
}

async function fetchProducts(slugs: readonly string[], signal: AbortSignal): Promise<PublicProductDto[]> {
  const records = await Promise.all(
    slugs.slice(0, 4).map(async (slug) => {
      try {
        const response = await fetch(`/api/public/products/${encodeURIComponent(slug)}`, {
          cache: "no-store",
          signal,
        });
        if (!response.ok) return null;
        const body = (await response.json()) as ProductResponse;
        return body.product ?? null;
      } catch {
        return null;
      }
    }),
  );
  return records.filter((record): record is PublicProductDto => record !== null);
}

export function CompareWorkspace({
  fontClassName,
}: {
  fontClassName: string;
}) {
  const [products, setProducts] = useState<PublicProductDto[]>([]);
  const [selectionCount, setSelectionCount] = useState(0);
  const [hydrating, setHydrating] = useState(true);
  const [loadNotice, setLoadNotice] = useState<string | null>(null);
  const requestControllerRef = useRef<AbortController | null>(null);
  const requestGenerationRef = useRef(0);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    const requestGeneration = requestGenerationRef.current + 1;
    requestGenerationRef.current = requestGeneration;
    requestControllerRef.current = controller;
    const params = new URLSearchParams(window.location.search);
    const add = params.get("add");
    const rawShared = params.get("products");
    const shared = rawShared === null
      ? undefined
      : rawShared
      .split(",")
      .map((slug) => slug.trim())
      .filter(Boolean);
    const { notice: persistenceNotice, requested } = reconcileCompareSelection({
      add: addCompareSlug,
      addSlug: add,
      replace: replaceCompareSlugs,
      shared,
      stored: getCompareSlugs(),
    });
    if (requested.length === 0) {
      queueMicrotask(() => {
        if (!isCurrentCompareRequest(active, requestGeneration, requestGenerationRef.current)) return;
        setProducts([]);
        setSelectionCount(0);
        setLoadNotice(persistenceNotice);
        setHydrating(false);
      });
      return () => {
        active = false;
        controller.abort();
        if (requestControllerRef.current === controller) requestControllerRef.current = null;
      };
    }

    queueMicrotask(() => {
      if (isCurrentCompareRequest(active, requestGeneration, requestGenerationRef.current)) {
        setSelectionCount(requested.length);
      }
    });

    void fetchProducts(requested, controller.signal).then((loaded) => {
      if (!isCurrentCompareRequest(active, requestGeneration, requestGenerationRef.current)) return;
      setProducts(loaded);
      setLoadNotice(
        loaded.length === requested.length
          ? persistenceNotice
          : "Some selected products are no longer available as trusted records.",
      );
      setHydrating(false);
    });
    return () => {
      active = false;
      controller.abort();
      if (requestControllerRef.current === controller) requestControllerRef.current = null;
    };
  }, []);

  function remove(slug: string) {
    const next = products.filter((product) => product.slug !== slug);
    if (!replaceCompareSlugs(next.map((product) => product.slug)).ok) {
      setLoadNotice("This product could not be removed because browser storage is unavailable.");
      return;
    }
    setProducts(next);
    setSelectionCount(next.length);
    setLoadNotice(null);
  }

  function clear() {
    if (!clearCompare()) {
      setLoadNotice("The comparison could not be cleared because browser storage is unavailable.");
      return;
    }
    requestGenerationRef.current += 1;
    requestControllerRef.current?.abort();
    requestControllerRef.current = null;
    setProducts([]);
    setSelectionCount(0);
    setHydrating(false);
    setLoadNotice(null);
  }

  const slots = Array.from({ length: 4 }, (_, index) => products[index] ?? null);

  return (
    <div className={`${styles.page} ${fontClassName}`}>
      <Header />
      <main className={styles.main}>
        <section className={styles.heading} aria-labelledby="compare-title">
          <div>
            <h1 id="compare-title">Compare up to 4 products</h1>
            <p>See how trusted products stack up across caffeine, serving size, calories and more.</p>
          </div>
          <div className={styles.actions}>
            <button disabled={selectionCount === 0} onClick={clear} type="button">
              <Trash2 aria-hidden="true" /> Clear all
            </button>
            <AddProductCard compact />
          </div>
        </section>

        {hydrating ? <div aria-live="polite" className={styles.loading} role="status">Loading your local comparison…</div> : (
          <>
            {loadNotice ? <p aria-live="polite" className={styles.notice} role="status">{loadNotice}</p> : null}
            <div className={styles.tableScroller} role="region" aria-label="Product comparison" tabIndex={0}>
              <div aria-label="Product comparison table" className={styles.comparisonGrid} role="table">
                <div className={styles.tableRow} role="row">
                  <AddProductCard tableCell />
                  {slots.map((product, index) =>
                    product ? (
                      <ProductHeader key={product.slug} onRemove={remove} product={product} />
                    ) : (
                      <EmptyProductHeader index={index} key={`empty-header-${index}`} />
                    ),
                  )}
                </div>

                {ROWS.map((row) => {
                  const Icon = row.icon;
                  return (
                    <div className={styles.tableRow} key={row.key} role="row">
                      <div aria-label={`${row.label}: ${row.detail}`} className={styles.rowLabel} role="rowheader">
                        <Icon aria-hidden="true" />
                        <div><strong>{row.label}</strong><span>{row.detail}</span></div>
                      </div>
                      {slots.map((product, index) =>
                        product ? (
                          <MetricCell key={`${row.key}-${product.slug}`} label={row.label} metric={row.value(product)} productName={product.name} />
                        ) : (
                          <EmptyCell key={`${row.key}-empty-${index}`} />
                        ),
                      )}
                    </div>
                  );
                })}

                <div className={styles.tableRow} role="row">
                  <div className={styles.rowLabel} role="rowheader">
                    <ShieldCheck aria-hidden="true" />
                    <div><strong>Data status</strong><span>Source-backed record</span></div>
                  </div>
                  {slots.map((product, index) =>
                    product ? <SourceCell key={`source-${product.slug}`} product={product} /> : <EmptyCell key={`source-empty-${index}`} />,
                  )}
                </div>

                <div className={`${styles.tableRow} ${styles.lastRow}`} role="row">
                  <div className={`${styles.rowLabel} ${styles.lastLabel}`} role="rowheader">
                    <BarChart3 aria-hidden="true" />
                    <div><strong>Ranking eligibility</strong><span>Exact comparable fields</span></div>
                  </div>
                  {slots.map((product, index) =>
                    product ? <EligibilityCell key={`eligibility-${product.slug}`} product={product} /> : <EmptyCell key={`eligibility-empty-${index}`} />,
                  )}
                </div>
              </div>
            </div>

            <footer className={styles.footer}>
              <p><Info aria-hidden="true" />Values reflect the latest trusted observation from each attributed source.</p>
              <p><CircleGauge aria-hidden="true" />Observed times vary by source update. Comparison is informational, not medical guidance.</p>
            </footer>
          </>
        )}
      </main>
    </div>
  );
}
