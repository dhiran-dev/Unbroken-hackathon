"use client";

import Image from "next/image";
import Link from "next/link";
import {
  BatteryCharging,
  Bolt,
  CheckCircle2,
  ChevronDown,
  CircleDot,
  Coffee,
  Cookie,
  Droplets,
  Filter,
  FlaskConical,
  Info,
  Leaf,
  LoaderCircle,
  Package,
  Search,
  SlidersHorizontal,
  Sparkles,
  X,
} from "lucide-react";
import {
  type CSSProperties,
  type KeyboardEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { LocalProductActionsClient } from "@/components/pulserank/local-actions";
import { RainbowButton } from "@/components/ui/rainbow-button";
import { ShimmerButton } from "@/components/ui/shimmer-button";
import {
  caffeineText,
  categoryLabel,
  formatNumber,
  servingText,
} from "@/components/pulserank/public-ui";
import type { CanonicalCategory } from "@/server/ingestion/normalize";
import type { PublicProductDto } from "@/server/products/dto";

import styles from "@/app/explore/explore.module.css";
import {
  appendUniqueProducts,
  type ExplorePlotMetric,
  isExactPlotProduct,
  niceAxisMaximum,
  toExplorePlotPoint,
} from "./explore-model";

type CategoryCount = {
  category: CanonicalCategory;
  productCount: number;
};

type ExploreFilters = {
  search?: string;
  category?: CanonicalCategory;
  caffeineMinMg?: number;
  caffeineMaxMg?: number;
  servingForm?: string;
  exactOnly?: boolean;
  hasSugar?: boolean;
  hasCalories?: boolean;
  sourceLevel?: string;
};

type ProductsResponse = {
  items: PublicProductDto[];
  totalCount: number;
  nextCursor: string | null;
};

const RESULTS_PAGE_SIZE = 24;
const PLOT_PAGE_SIZE = 100;

type ExploreWorkspaceProps = {
  categories: CategoryCount[];
  initialError: string | null;
  initialFilters: ExploreFilters;
  initialNextCursor: string | null;
  initialProducts: PublicProductDto[];
  initialSelected: PublicProductDto | null;
  initialTotalCount: number;
};

const CATEGORY_ICONS = {
  "energy-drink": Bolt,
  "energy-shot": BatteryCharging,
  coffee: Coffee,
  tea: Leaf,
  soda: CircleDot,
  water: Droplets,
  food: Cookie,
  gum: CircleDot,
  other: Package,
} satisfies Record<CanonicalCategory, typeof Bolt>;

function productHash(value: string): number {
  let hash = 2166136261;
  for (const character of value) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return parts.slice(0, 2).map((part) => part[0]).join("").toUpperCase() || "PR";
}

function ProceduralProductSpecimen({
  product,
  compact = false,
}: {
  product: PublicProductDto;
  compact?: boolean;
}) {
  const hash = productHash(product.slug);
  const customProperties = {
    "--specimen-turn": `${((hash % 9) - 4) * 0.7}deg`,
    "--specimen-shift": `${(hash % 19) - 9}px`,
    "--specimen-scale": `${0.93 + (hash % 9) / 100}`,
  } as CSSProperties;

  return (
    <div
      aria-label={`Original abstract ${categoryLabel(product.category)} artwork for ${product.name}`}
      className={`${styles.specimen}${compact ? ` ${styles.specimenCompact}` : ""}`}
      data-category={product.category}
      data-variant={hash % 4}
      role="img"
      style={customProperties}
    >
      <span aria-hidden="true" className={styles.specimenGrid} />
      <span aria-hidden="true" className={styles.specimenOrbit} />
      <span aria-hidden="true" className={styles.specimenObject}>
        <span className={styles.specimenCap} />
        <span className={styles.specimenCode}>{initials(product.name)}</span>
        <span className={styles.specimenBars} />
      </span>
    </div>
  );
}

function ProductArtwork({
  product,
  compact = false,
}: {
  product: PublicProductDto;
  compact?: boolean;
}) {
  const [imageFailed, setImageFailed] = useState(false);
  const [shouldLoad, setShouldLoad] = useState(!compact);
  const artworkRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!compact || shouldLoad) return;
    const artwork = artworkRef.current;
    if (!artwork) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return;
        setShouldLoad(true);
        observer.disconnect();
      },
      { rootMargin: "160px 0px" },
    );
    observer.observe(artwork);
    return () => observer.disconnect();
  }, [compact, shouldLoad]);

  if (imageFailed) {
    return <ProceduralProductSpecimen compact={compact} product={product} />;
  }

  const renderedImagePath = `/api/public/product-images/${encodeURIComponent(product.slug)}`;

  return (
    <div
      className={`${styles.specimen} ${styles.specimenPhoto}${compact ? ` ${styles.specimenCompact}` : ""}`}
      data-category={product.category}
      data-product-image={product.slug}
      data-product-image-mode="edge-matte"
      ref={artworkRef}
    >
      <span aria-hidden="true" className={styles.specimenGrid} />
      {shouldLoad ? (
        <Image
          alt={`${product.name} product packaging`}
          className={styles.productPhoto}
          fill
          loading={compact ? "lazy" : undefined}
          onError={() => setImageFailed(true)}
          preload={!compact}
          sizes={compact ? "(max-width: 560px) 116px, 160px" : "(max-width: 1180px) 100vw, 306px"}
          src={renderedImagePath}
          unoptimized
        />
      ) : (
        <span aria-hidden="true" className={styles.productImageLoading} />
      )}
    </div>
  );
}

function addFilterInputs(filters: ExploreFilters, omit: keyof ExploreFilters) {
  return Object.entries(filters).flatMap(([name, value]) => {
    if (name === omit || value === undefined || value === false) return [];
    return [<input key={name} name={name} type="hidden" value={String(value)} />];
  });
}

function filterHref(
  filters: ExploreFilters,
  updates: Partial<Record<keyof ExploreFilters, string | number | boolean | null>>,
): string {
  const parameters = new URLSearchParams();
  for (const [name, value] of Object.entries({ ...filters, ...updates })) {
    if (value !== undefined && value !== null && value !== false && value !== "") {
      parameters.set(name, String(value));
    }
  }
  const query = parameters.toString();
  return query ? `/explore?${query}` : "/explore";
}

function productListParameters(
  filters: ExploreFilters,
  cursor: string,
  limit: number,
): URLSearchParams {
  const parameters = new URLSearchParams();
  for (const [name, value] of Object.entries(filters)) {
    if (value !== undefined && value !== false) parameters.set(name, String(value));
  }
  parameters.set("cursor", cursor);
  parameters.set("limit", String(limit));
  return parameters;
}

function qualificationLabel(product: PublicProductDto): string | null {
  if (product.caffeine.state === "conflicting") return "Conflicting";
  if (product.caffeine.state !== "present") return "Not published";
  if (product.caffeine.qualifier === "range") return "Range";
  if (product.caffeine.qualifier === "approximate") return "Approx.";
  if (product.caffeine.qualifier === "estimated") return "Estimated";
  return null;
}

function exploreCategoryLabel(category: CanonicalCategory): string {
  return category === "other" ? "Other / unclassified" : categoryLabel(category);
}

function productTypeLabel(product: PublicProductDto): string {
  if (product.category === "other") {
    return product.categoryProvenance === "legacy_broad"
      ? "Product type · Not classified"
      : "Product type · Other";
  }
  return `Product type · ${categoryLabel(product.category)}`;
}

function categoryProvenanceLabel(
  provenance: PublicProductDto["categoryProvenance"],
): string {
  if (provenance === "source_listing") return "Source category list";
  if (provenance === "source_pdp") return "Source product page";
  return "Legacy catalog";
}

function FilterRail({
  categories,
  filters,
  open,
}: {
  categories: CategoryCount[];
  filters: ExploreFilters;
  open: boolean;
}) {
  const totalProducts = categories.reduce((sum, item) => sum + item.productCount, 0);

  return (
    <aside className={`${styles.filters}${open ? ` ${styles.filtersOpen}` : ""}`} aria-label="Product filters">
      <div className={styles.filtersHeading}>
        <h2>Filters</h2>
        <Link href="/explore">Reset</Link>
      </div>
      <div className={styles.filterSection}>
        <div className={styles.filterLabel}>Categories <ChevronDown size={14} aria-hidden="true" /></div>
        <div className={styles.categoryList}>
          <Link className={!filters.category ? styles.categorySelected : ""} href={filterHref(filters, { category: null })}>
            <SlidersHorizontal size={16} aria-hidden="true" />
            <span>All categories</span>
            <b>{totalProducts.toLocaleString()}</b>
          </Link>
          {categories.map(({ category, productCount }) => {
            const Icon = CATEGORY_ICONS[category];
            return (
              <Link
                className={filters.category === category ? styles.categorySelected : ""}
                href={filterHref(filters, { category })}
                key={category}
              >
                <Icon size={16} aria-hidden="true" />
                <span>{exploreCategoryLabel(category)}</span>
                <b>{productCount.toLocaleString()}</b>
              </Link>
            );
          })}
        </div>
      </div>
      <form action="/explore" className={styles.filterForm} method="get">
        {filters.search ? <input name="search" type="hidden" value={filters.search} /> : null}
        {filters.category ? <input name="category" type="hidden" value={filters.category} /> : null}
        <fieldset>
          <legend>Total caffeine</legend>
          <div className={styles.rangeInputs}>
            <label>
              <span>Minimum mg</span>
              <input defaultValue={filters.caffeineMinMg ?? ""} inputMode="numeric" min="0" name="caffeineMinMg" placeholder="0" type="number" />
            </label>
            <label>
              <span>Maximum mg</span>
              <input defaultValue={filters.caffeineMaxMg ?? ""} inputMode="numeric" min="0" name="caffeineMaxMg" placeholder="Any" type="number" />
            </label>
          </div>
        </fieldset>
        <label className={styles.selectLabel}>
          <span>Serving form</span>
          <select defaultValue={filters.servingForm ?? ""} name="servingForm">
            <option value="">All forms</option>
            <option value="drink">Drink</option>
            <option value="concentrate">Concentrate</option>
            <option value="mix">Mix</option>
            <option value="food">Food</option>
            <option value="supplement">Supplement</option>
            <option value="item">Per item</option>
            <option value="unknown">Unknown</option>
          </select>
        </label>
        <label className={styles.switchLabel}>
          <span><b>Exact caffeine only</b><small>Hide ranges and uncertain points</small></span>
          <input defaultChecked={filters.exactOnly === true} name="exactOnly" type="checkbox" value="true" />
        </label>
        <ShimmerButton
          background="#100c1c"
          borderRadius="10px"
          className={styles.applyButton}
          shimmerColor="#d99cff"
          type="submit"
        >
          Apply filters
        </ShimmerButton>
      </form>
    </aside>
  );
}

function SearchCommand({ filters }: { filters: ExploreFilters }) {
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    function focusSearch(event: globalThis.KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      const isTyping = target?.matches("input, textarea, select, [contenteditable='true']");
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        searchRef.current?.focus();
      } else if (event.key === "/" && !isTyping) {
        event.preventDefault();
        searchRef.current?.focus();
      }
    }
    window.addEventListener("keydown", focusSearch);
    return () => window.removeEventListener("keydown", focusSearch);
  }, []);

  return (
    <form action="/explore" className={styles.commandSearch} method="get" role="search">
      <Search size={18} aria-hidden="true" />
      <label className="sr-only" htmlFor="explore-command-search">Search trusted products</label>
      <input
        autoComplete="off"
        defaultValue={filters.search ?? ""}
        id="explore-command-search"
        name="search"
        placeholder="Search trusted products…"
        ref={searchRef}
      />
      {addFilterInputs(filters, "search")}
      <kbd><span>⌘</span>K</kbd>
      <ShimmerButton
        background="#100c1c"
        borderRadius="10px"
        className={styles.searchButton}
        shimmerColor="#d99cff"
        type="submit"
      >
        Search
      </ShimmerButton>
    </form>
  );
}

function ActiveFilters({ filters }: { filters: ExploreFilters }) {
  const entries = Object.entries(filters).filter(([, value]) => value !== undefined && value !== false);
  if (entries.length === 0) return null;

  const labels: Record<string, string> = {
    search: "Search",
    category: "Category",
    caffeineMinMg: "Min",
    caffeineMaxMg: "Max",
    servingForm: "Serving",
    exactOnly: "Exact only",
  };

  return (
    <div className={styles.activeFilters} aria-label="Active filters">
      {entries.map(([name, value]) => (
        <Link href={filterHref(filters, { [name]: null })} key={name}>
          <span>{labels[name] ?? name}: {value === true ? "on" : String(value).replaceAll("-", " ")}</span>
          <X size={13} aria-hidden="true" />
          <span className="sr-only">Remove {labels[name] ?? name} filter</span>
        </Link>
      ))}
    </div>
  );
}

function ScatterPlot({
  catalogTotalCount,
  loading,
  metric,
  products,
  selectedSlug,
  onSelect,
}: {
  catalogTotalCount: number;
  loading: boolean;
  metric: ExplorePlotMetric;
  products: PublicProductDto[];
  selectedSlug: string | null;
  onSelect: (product: PublicProductDto) => void;
}) {
  const [activeLabelSlug, setActiveLabelSlug] = useState<string | null>(null);
  const points = products.flatMap((product) => {
    const point = toExplorePlotPoint(product, metric);
    return point ? [{ product, ...point }] : [];
  });
  const maxX = niceAxisMaximum(Math.max(...points.map((point) => point.xMl), 1));
  const maxY = niceAxisMaximum(Math.max(...points.map((point) => point.yValue), 1));
  const width = 860;
  const height = 430;
  const left = 64;
  const right = 22;
  const top = 28;
  const bottom = 55;
  const plotWidth = width - left - right;
  const plotHeight = height - top - bottom;
  const ticks = [0, 0.25, 0.5, 0.75, 1];
  const yUnit = metric === "total" ? "mg" : "mg / 100 ml";
  const legendCategories = Array.from(new Set(points.map(({ product }) => product.category)));
  const renderedPoints = selectedSlug === null
    ? points
    : [
        ...points.filter(({ product }) => product.slug !== selectedSlug),
        ...points.filter(({ product }) => product.slug === selectedSlug),
      ];

  if (points.length === 0) {
    return (
      <div className={styles.plotEmpty}>
        {loading ? <LoaderCircle className={styles.spinner} size={24} aria-hidden="true" /> : <FlaskConical size={24} aria-hidden="true" />}
        <h3>{loading ? "Loading the complete plot" : "No comparable points in these results"}</h3>
        <p>{loading ? "Collecting every matching product before reporting the final exact-point count." : "Try a wider filter. Ranges and missing volumes stay in the results, but cannot share this exact-value plot."}</p>
      </div>
    );
  }

  function handlePointKey(event: KeyboardEvent<SVGGElement>, product: PublicProductDto) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onSelect(product);
    }
  }

  return (
    <div className={styles.plotFrame}>
      <div className={styles.plotScroller}>
        <svg aria-labelledby="explore-plot-title explore-plot-description" className={styles.plot} role="group" viewBox={`0 0 ${width} ${height}`}>
        <title id="explore-plot-title">Caffeine products plotted by normalized serving volume</title>
        <desc id="explore-plot-description">
          {points.length} exact products. Horizontal position is serving volume in milliliters. Vertical position is {metric === "total" ? "total caffeine" : "caffeine concentration"}.
        </desc>
        {ticks.map((tick) => {
          const x = left + tick * plotWidth;
          const y = top + (1 - tick) * plotHeight;
          return (
            <g key={tick}>
              <line className={styles.gridLine} x1={left} x2={width - right} y1={y} y2={y} />
              <line className={styles.gridLine} x1={x} x2={x} y1={top} y2={height - bottom} />
              <text className={styles.axisText} textAnchor="end" x={left - 12} y={y + 4}>{formatNumber(tick * maxY)}</text>
              <text className={styles.axisText} textAnchor={tick === 0 ? "start" : tick === 1 ? "end" : "middle"} x={x} y={height - 24}>{formatNumber(tick * maxX)} ml</text>
            </g>
          );
        })}
        <line className={styles.axisLine} x1={left} x2={left} y1={top} y2={height - bottom} />
        <line className={styles.axisLine} x1={left} x2={width - right} y1={height - bottom} y2={height - bottom} />
        <text className={styles.axisLabel} textAnchor="middle" transform={`translate(17 ${top + plotHeight / 2}) rotate(-90)`}>{yUnit}</text>
        <text className={styles.axisLabel} textAnchor="middle" x={left + plotWidth / 2} y={height - 3}>Normalized serving volume</text>
        {renderedPoints.map(({ product, xMl, yValue }, index) => {
          const x = left + (xMl / maxX) * plotWidth;
          const y = top + (1 - yValue / maxY) * plotHeight;
          const selected = product.slug === selectedSlug;
          return (
            <g
              aria-label={`${product.name}: ${formatNumber(yValue)} ${yUnit}, ${formatNumber(xMl)} ml serving`}
              className={`${styles.plotPoint}${selected ? ` ${styles.plotPointSelected}` : ""}`}
              data-category={product.category}
              data-plot-point={product.slug}
              data-plot-selected={selected || undefined}
              key={product.slug}
              onBlur={() => setActiveLabelSlug(null)}
              onClick={(event) => {
                event.currentTarget.focus();
                onSelect(product);
              }}
              onFocus={() => setActiveLabelSlug(product.slug)}
              onKeyDown={(event) => handlePointKey(event, product)}
              onMouseEnter={() => setActiveLabelSlug(product.slug)}
              onMouseLeave={() => setActiveLabelSlug(null)}
              role="button"
              style={{ "--point-order": Math.min(index, RESULTS_PAGE_SIZE) } as CSSProperties}
              tabIndex={0}
              transform={`translate(${x} ${y})`}
            >
              <circle className={styles.pointTarget} r="24" />
              <circle className={styles.pointHalo} r={selected ? 10 : 7} />
              <circle className={styles.pointCore} r={selected ? 5.5 : 4} />
            </g>
          );
        })}
        {points.flatMap(({ product, xMl, yValue }) => {
          if (product.slug !== (activeLabelSlug ?? selectedSlug)) return [];
          const x = left + (xMl / maxX) * plotWidth;
          const y = top + (1 - yValue / maxY) * plotHeight;
          const labelX = x > width - right - 190 ? x - 183 : x + 13;
          const labelY = y < top + 52 ? y + 14 : y - 15;
          return [
            <g aria-hidden="true" className={styles.pointLabel} data-point-label={product.slug} key={`label-${product.slug}`} transform={`translate(${labelX} ${labelY})`}>
              <rect height="45" rx="8" width="170" />
              <text x="10" y="17">{product.name.slice(0, 24)}</text>
              <text className={styles.pointLabelValue} x="10" y="34">{formatNumber(yValue)} {yUnit} · {formatNumber(xMl)} ml</text>
            </g>,
          ];
        })}
        </svg>
      </div>
      <div aria-label="Plot category legend" className={styles.plotLegend}>
        {legendCategories.map((category) => (
          <span data-category={category} key={category}><i aria-hidden="true" /> {exploreCategoryLabel(category)}</span>
        ))}
      </div>
      <div className={styles.plotFootnote}>
        <span><Info size={14} aria-hidden="true" /> Exact caffeine + positive normalized volume only</span>
        <span>{loading
          ? `${points.length} plotted while loading ${products.length} of ${catalogTotalCount}`
          : `${points.length} plotted from all ${products.length} matching products`}</span>
        <span className={styles.mobilePlotHint}>Swipe the plot to inspect the full axis</span>
      </div>
    </div>
  );
}

function Inspector({
  product,
  onClose,
  closeRef,
  inspectorRef,
  engaged,
  modal,
}: {
  product: PublicProductDto | null;
  onClose: () => void;
  closeRef: React.RefObject<HTMLButtonElement | null>;
  inspectorRef: React.RefObject<HTMLElement | null>;
  engaged: boolean;
  modal: boolean;
}) {
  if (!product) {
    return (
      <aside className={styles.inspector} aria-label="Product inspector">
        <div className={styles.inspectorEmpty}>
          <Sparkles size={22} aria-hidden="true" />
          <h2>Inspect a product</h2>
          <p>Select a plot point or result to see its serving, provenance, and comparison eligibility.</p>
        </div>
      </aside>
    );
  }

  const observed = new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
    year: "numeric",
  }).format(new Date(product.observedAt));
  const provenance = categoryProvenanceLabel(product.categoryProvenance);
  const qualification = qualificationLabel(product);

  return (
    <aside
      aria-labelledby={`explore-inspector-title-${product.slug}`}
      aria-modal={modal || undefined}
      className={`${styles.inspector} ${styles.inspectorOpen}${engaged ? ` ${styles.inspectorEngaged}` : ""}`}
      data-product-inspector={product.slug}
      ref={inspectorRef}
      role={modal ? "dialog" : undefined}
    >
      <button aria-label="Close product inspector" className={styles.inspectorClose} onClick={onClose} ref={closeRef} type="button"><X size={18} /></button>
      <ProductArtwork key={product.slug} product={product} />
      <div className={styles.inspectorBody}>
        <div className={styles.inspectorTitle}>
          <h2 id={`explore-inspector-title-${product.slug}`}>{product.name}</h2>
          <span>{productTypeLabel(product)}</span>
        </div>
        <div className={styles.trustChip}><CheckCircle2 size={14} aria-hidden="true" /> Trusted observation</div>
        <dl className={styles.inspectorMetrics}>
          <div><dt>Total caffeine</dt><dd>{caffeineText(product.caffeine)}{qualification ? <small>{qualification}</small> : null}</dd></div>
          <div><dt>Serving</dt><dd>{servingText(product)}{product.serving.normalizedMl !== null ? <small>{formatNumber(product.serving.normalizedMl)} ml normalized</small> : null}</dd></div>
          <div><dt>Concentration</dt><dd>{product.concentration.mgPer100Ml !== null ? `${formatNumber(product.concentration.mgPer100Ml)} mg / 100 ml` : "Not eligible"}</dd></div>
          <div><dt>Observed</dt><dd>{observed}</dd></div>
        </dl>
        <div className={styles.provenance}>
          <span>Classification source</span>
          <strong>{provenance}</strong>
          <small>{product.sourceAttribution}</small>
        </div>
        <LocalProductActionsClient product={product} showMyDay={false} />
        <Link className={styles.passportLink} href={`/products/${product.slug}`}>View product passport <span aria-hidden="true">→</span></Link>
      </div>
    </aside>
  );
}

function ProductResult({
  product,
  selected,
  onInspect,
}: {
  product: PublicProductDto;
  selected: boolean;
  onInspect: (product: PublicProductDto) => void;
}) {
  const qualification = qualificationLabel(product);

  return (
    <article className={`${styles.resultCard}${selected ? ` ${styles.resultSelected}` : ""}`} data-product-result={product.slug}>
      <ProductArtwork compact product={product} />
      <div className={styles.resultBody}>
        <div className={styles.resultHeading}>
          <div>
            <h3><Link href={`/products/${product.slug}`}>{product.name}</Link></h3>
            <span>{productTypeLabel(product)}</span>
          </div>
          {qualification ? <span className={styles.qualifier}>{qualification}</span> : null}
        </div>
        <div className={styles.resultMetrics}>
          <strong>{caffeineText(product.caffeine)}</strong>
          <span>{servingText(product)}</span>
        </div>
        <div className={styles.resultActions}>
          <button onClick={() => onInspect(product)} type="button">Inspect</button>
          <LocalProductActionsClient compact product={product} showMyDay={false} />
        </div>
      </div>
    </article>
  );
}

export function ExploreWorkspace({
  categories,
  initialError,
  initialFilters,
  initialNextCursor,
  initialProducts,
  initialSelected,
  initialTotalCount,
}: ExploreWorkspaceProps) {
  const [products, setProducts] = useState(initialProducts);
  const [plotProducts, setPlotProducts] = useState(initialProducts);
  const [nextCursor, setNextCursor] = useState(initialNextCursor);
  const [totalCount, setTotalCount] = useState(initialTotalCount);
  const [selected, setSelected] = useState(initialSelected);
  const [inspectorEngaged, setInspectorEngaged] = useState(false);
  const [metric, setMetric] = useState<ExplorePlotMetric>("total");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [compactInspector, setCompactInspector] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [plotLoading, setPlotLoading] = useState(initialNextCursor !== null);
  const [plotError, setPlotError] = useState<string | null>(null);
  const inspectorCloseRef = useRef<HTMLButtonElement>(null);
  const inspectorRef = useRef<HTMLElement>(null);
  const lastFocusRef = useRef<HTMLElement | SVGElement | null>(null);

  const inspectorModal = compactInspector && inspectorEngaged && selected !== null;

  const closeInspector = useCallback(() => {
    setInspectorEngaged(false);
    setSelected(null);
    const previousFocus = lastFocusRef.current;
    window.requestAnimationFrame(() => {
      if (previousFocus?.isConnected) previousFocus.focus();
    });
  }, []);

  const plottedCount = useMemo(
    () => plotProducts.filter((product) => isExactPlotProduct(product, metric)).length,
    [metric, plotProducts],
  );

  useEffect(() => {
    if (!initialNextCursor) return;

    const controller = new AbortController();

    async function loadCompletePlot() {
      let cursor: string | null = initialNextCursor;
      let collected = initialProducts;
      const visitedCursors = new Set<string>();

      try {
        while (cursor !== null) {
          if (visitedCursors.has(cursor)) throw new Error("Catalog cursor repeated");
          visitedCursors.add(cursor);

          const parameters = productListParameters(initialFilters, cursor, PLOT_PAGE_SIZE);
          const response = await fetch(`/api/public/products?${parameters.toString()}`, {
            signal: controller.signal,
          });
          if (!response.ok) throw new Error(`Catalog returned ${response.status}`);
          const body = (await response.json()) as ProductsResponse;
          collected = appendUniqueProducts(collected, body.items);
          cursor = body.nextCursor;
          setPlotProducts(collected);
        }
      } catch (error) {
        if (controller.signal.aborted) return;
        setPlotError(error instanceof Error ? error.message : "The complete plot could not be loaded");
      } finally {
        if (!controller.signal.aborted) setPlotLoading(false);
      }
    }

    void loadCompletePlot();
    return () => controller.abort();
  }, [initialFilters, initialNextCursor, initialProducts]);

  useEffect(() => {
    const media = window.matchMedia("(max-width: 1180px)");
    const sync = () => setCompactInspector(media.matches);
    sync();
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, []);

  useEffect(() => {
    function closeOnEscape(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape" && inspectorEngaged) closeInspector();
    }
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [closeInspector, inspectorEngaged]);

  useEffect(() => {
    if (!inspectorModal) return;

    const header = document.querySelector<HTMLElement>(".pr-header");
    const headerWasInert = header?.hasAttribute("inert") ?? false;
    const previousOverflow = document.body.style.overflow;
    const panel = inspectorRef.current;

    header?.setAttribute("inert", "");
    document.body.style.overflow = "hidden";

    function trapFocus(event: globalThis.KeyboardEvent) {
      if (event.key !== "Tab" || !panel) return;
      const focusable = Array.from(
        panel.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'),
      ).filter((element) => !element.hasAttribute("hidden"));
      if (focusable.length === 0) return;
      const firstFocusable = focusable[0];
      const lastFocusable = focusable[focusable.length - 1];
      if (!firstFocusable || !lastFocusable) return;
      if (event.shiftKey && document.activeElement === firstFocusable) {
        event.preventDefault();
        lastFocusable.focus();
      } else if (!event.shiftKey && document.activeElement === lastFocusable) {
        event.preventDefault();
        firstFocusable.focus();
      }
    }

    panel?.addEventListener("keydown", trapFocus);
    window.requestAnimationFrame(() => inspectorCloseRef.current?.focus());

    return () => {
      panel?.removeEventListener("keydown", trapFocus);
      document.body.style.overflow = previousOverflow;
      if (header && !headerWasInert) header.removeAttribute("inert");
    };
  }, [inspectorModal]);

  function selectProduct(product: PublicProductDto) {
    const activeElement = document.activeElement;
    lastFocusRef.current = activeElement instanceof HTMLElement || activeElement instanceof SVGElement
      ? activeElement
      : null;
    setSelected(product);
    setInspectorEngaged(true);
  }

  async function loadMore() {
    if (!nextCursor || loading) return;
    setLoading(true);
    setLoadError(null);
    const parameters = productListParameters(initialFilters, nextCursor, RESULTS_PAGE_SIZE);

    try {
      const response = await fetch(`/api/public/products?${parameters.toString()}`);
      if (!response.ok) throw new Error(`Catalog returned ${response.status}`);
      const body = (await response.json()) as ProductsResponse;
      setProducts((current) => appendUniqueProducts(current, body.items));
      setNextCursor(body.nextCursor);
      setTotalCount(body.totalCount);
    } catch {
      setLoadError("The next catalog page could not be loaded. Your current results are still available; try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className={styles.main}>
      <button
        aria-controls="explore-filter-rail"
        aria-expanded={filtersOpen}
        className={styles.mobileFilterButton}
        inert={inspectorModal || undefined}
        onClick={() => setFiltersOpen((value) => !value)}
        type="button"
      >
        <Filter size={17} aria-hidden="true" /> Filters
        {Object.keys(initialFilters).length > 0 ? <span>{Object.keys(initialFilters).length}</span> : null}
      </button>
      <div className={styles.workspace}>
        <div className={styles.filterRailSlot} id="explore-filter-rail" inert={inspectorModal || undefined}><FilterRail categories={categories} filters={initialFilters} open={filtersOpen} /></div>
        <section className={styles.observatory} inert={inspectorModal || undefined}>
          <header className={styles.pageHeading}>
            <div>
              <h1>Explore products</h1>
              <p>Map exact caffeine against normalized serving volume, then inspect every qualifier.</p>
            </div>
            <div aria-label="Plot metric" className={styles.metricToggle} role="group">
              {metric === "total" ? (
                <RainbowButton aria-pressed={true} className={styles.metricSelected} onClick={() => setMetric("total")}>Total caffeine</RainbowButton>
              ) : (
                <button aria-pressed={false} onClick={() => setMetric("total")} type="button">Total caffeine</button>
              )}
              {metric === "concentration" ? (
                <RainbowButton aria-pressed={true} className={styles.metricSelected} onClick={() => setMetric("concentration")}>Concentration</RainbowButton>
              ) : (
                <button aria-pressed={false} onClick={() => setMetric("concentration")} type="button">Concentration</button>
              )}
            </div>
          </header>
          <SearchCommand filters={initialFilters} />
          <ActiveFilters filters={initialFilters} />
          {initialError ? <div className={styles.queryError} role="status"><Info size={15} aria-hidden="true" /> {initialError}. Showing the unfiltered trusted catalog.</div> : null}
          <div className={styles.resultSummary} aria-live="polite">
            <span><strong>{totalCount.toLocaleString()}</strong> trusted {totalCount === 1 ? "result" : "results"}</span>
            <span data-plot-catalog-status={plotLoading ? "loading" : plotError ? "partial" : "complete"}>
              <i /> {plotLoading
                ? `${plottedCount} exact points · loading the complete plot`
                : plotError
                  ? `${plottedCount} exact points loaded · complete plot unavailable`
                  : `${plottedCount} exact points across all results`}
            </span>
          </div>
          <ScatterPlot
            catalogTotalCount={totalCount}
            loading={plotLoading}
            metric={metric}
            onSelect={selectProduct}
            products={plotProducts}
            selectedSlug={selected?.slug ?? null}
          />
          <section className={styles.resultsSection} aria-labelledby="explore-results-heading">
            <div className={styles.resultsHeading}>
              <div>
                <h2 id="explore-results-heading">Loaded catalog</h2>
                <p>{products.length.toLocaleString()} of {totalCount.toLocaleString()} products</p>
              </div>
              <span>Ranges and missing fields stay visible here</span>
            </div>
            {products.length > 0 ? (
              <div className={styles.resultGrid}>
                {products.map((product) => (
                  <ProductResult key={product.slug} onInspect={selectProduct} product={product} selected={selected?.slug === product.slug} />
                ))}
              </div>
            ) : (
              <div className={styles.emptyResults}>
                <Search size={22} aria-hidden="true" />
                <h3>No trusted products match these filters</h3>
                <p>Reset the filters or widen the caffeine range. Nothing was converted to zero or silently omitted.</p>
                <Link href="/explore">Reset filters</Link>
              </div>
            )}
            {loadError ? <p className={styles.loadError} role="alert">{loadError}</p> : null}
            {nextCursor ? (
              <ShimmerButton
                background="#100c1c"
                borderRadius="10px"
                className={styles.loadMore}
                disabled={loading}
                onClick={() => void loadMore()}
                shimmerColor="#d99cff"
              >
                {loading ? <LoaderCircle className={styles.spinner} size={17} aria-hidden="true" /> : null}
                {loading ? "Loading next 24…" : "Load 24 more products"}
              </ShimmerButton>
            ) : products.length > 0 ? <p className={styles.catalogEnd}>You reached all {products.length.toLocaleString()} matching products.</p> : null}
          </section>
        </section>
        {inspectorModal ? <button aria-label="Close product inspector backdrop" className={styles.inspectorScrim} onClick={closeInspector} tabIndex={-1} type="button" /> : null}
        <Inspector
          closeRef={inspectorCloseRef}
          engaged={inspectorEngaged}
          inspectorRef={inspectorRef}
          modal={inspectorModal}
          onClose={closeInspector}
          product={selected}
        />
      </div>
    </main>
  );
}
