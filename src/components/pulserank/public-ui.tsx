import Image from "next/image";
import Link from "next/link";
import {
  ArrowRight,
  Check,
  ChevronRight,
  Database,
  Info,
  Search,
  Sparkles,
  TriangleAlert,
  Zap,
} from "lucide-react";

import type {
  PublicCaffeineDto,
  PublicProductDto,
} from "@/server/products/dto";
import { LocalProductActionsClient } from "@/components/pulserank/local-actions";
import { PublishedProductImage } from "@/components/pulserank/product-image";
import productImageStyles from "@/components/pulserank/product-image.module.css";

export const NAV_ITEMS = [
  { href: "/", label: "Home" },
  { href: "/explore", label: "Explore" },
  { href: "/leaderboards", label: "Leaderboards" },
  { href: "/compare", label: "Compare" },
  { href: "/my-pulse", label: "My Pulse" },
  { href: "/changes", label: "Changes" },
  { href: "/live-data", label: "Live Data" },
  { href: "/game", label: "Arcade" },
] as const;

export type PublicNavKey = (typeof NAV_ITEMS)[number]["href"] | "home";

export function PulseMark({ compact = false }: { compact?: boolean }) {
  return (
    <span className="pr-brand" aria-label="PulseRank home">
      <span
        className="pr-brand-mark"
        aria-hidden="true"
        style={{ background: "transparent", borderRadius: 0, boxShadow: "none" }}
      >
        <Image
          alt=""
          height={44}
          priority
          src="/pulserank/logo.png"
          style={{ height: 40, maxWidth: "none", objectFit: "contain", width: 40 }}
          width={44}
        />
      </span>
      {!compact ? <span className="pr-wordmark">PulseRank</span> : null}
    </span>
  );
}

export function PublicHeader({ active }: { active?: PublicNavKey }) {
  return (
    <header className="pr-header">
      <div className="pr-header-inner">
        <Link href="/" aria-label="PulseRank home" className="pr-brand-link">
          <PulseMark />
        </Link>
        <nav aria-label="Primary navigation" className="pr-nav">
          {NAV_ITEMS.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`pr-nav-link${active === item.href ? " is-active" : ""}`}
              aria-current={active === item.href ? "page" : undefined}
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <form className="pr-header-search" action="/explore" method="get" role="search">
          <Search size={15} aria-hidden="true" />
          <label className="sr-only" htmlFor="global-search">Search products</label>
          <input id="global-search" name="search" placeholder="Search products" />
          <kbd>/</kbd>
        </form>
      </div>
    </header>
  );
}

export function PageFrame({
  active,
  eyebrow,
  title,
  description,
  children,
}: {
  active?: PublicNavKey;
  eyebrow: string;
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="pr-app">
      <PublicHeader active={active} />
      <main className="pr-main pr-shell">
        <div className="pr-page-heading">
          <p className="pr-eyebrow">{eyebrow}</p>
          <h1>{title}</h1>
          {description ? <p className="pr-page-description">{description}</p> : null}
        </div>
        {children}
      </main>
    </div>
  );
}

const CATEGORY_LABELS: Record<string, string> = {
  "energy-drink": "Energy drink",
  "energy-shot": "Energy shot",
  coffee: "Coffee",
  tea: "Tea",
  soda: "Soda",
  water: "Water",
  food: "Food",
  gum: "Gum",
  other: "Other",
};

export function categoryLabel(category: string): string {
  return CATEGORY_LABELS[category] ?? category.replaceAll("-", " ");
}

export function formatNumber(value: number): string {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 }).format(value);
}

export function caffeineText(caffeine: PublicCaffeineDto): string {
  if (caffeine.mg !== null) return `${formatNumber(caffeine.mg)} mg`;
  if (caffeine.min !== null && caffeine.max !== null) {
    return `${formatNumber(caffeine.min)}–${formatNumber(caffeine.max)} mg`;
  }
  return "Not published";
}

export function servingText(product: PublicProductDto): string {
  if (product.serving.value === null) return "Serving not published";
  const unit = product.serving.unit?.replaceAll("_", " ") ?? "unit";
  return `${formatNumber(product.serving.value)} ${unit} serving`;
}

const STATE_LABELS: Record<string, string> = {
  present: "Observed",
  not_published: "Not published",
  not_applicable: "Not applicable",
  unparseable: "Needs review",
  conflicting: "Conflicting",
};

export function FieldStateBadge({ state }: { state: string }) {
  const tone = state === "present" ? "is-good" : state === "conflicting" || state === "unparseable" ? "is-alert" : "is-muted";
  return <span className={`pr-state ${tone}`}>{STATE_LABELS[state] ?? state}</span>;
}

export function ProductArt({
  category,
  name,
  large = false,
}: {
  category: string;
  name: string;
  large?: boolean;
}) {
  return (
    <div className={`pr-product-art category-${category}${large ? " is-large" : ""}`} aria-label={`${categoryLabel(category)} abstract category art`}>
      <span className="pr-art-ring" aria-hidden="true" />
      <span className="pr-art-orb" aria-hidden="true" />
      <span className="pr-art-label">{categoryLabel(category)}</span>
      <span className="pr-art-name">{name.slice(0, 22)}</span>
    </div>
  );
}

function canSave(product: PublicProductDto): boolean {
  return product.caffeine.mg !== null && product.serving.value !== null;
}

export function ProductCard({ product }: { product: PublicProductDto }) {
  return (
    <article className="pr-product-card">
      <Link href={`/products/${product.slug}`} className="pr-card-link">
        <PublishedProductImage
          className={productImageStyles.cardPhoto}
          fallback={<ProductArt category={product.category} name={product.name} />}
          height={360}
          name={product.name}
          sizes="(max-width: 520px) 100vw, (max-width: 820px) 50vw, 25vw"
          slug={product.slug}
          width={640}
        />
        <div className="pr-card-body">
          <div className="pr-card-topline">
            <span className="pr-category-label">{categoryLabel(product.category)}</span>
            <ChevronRight size={16} aria-hidden="true" />
          </div>
          <h3>{product.name}</h3>
          <div className="pr-card-metric-row">
            <strong>{caffeineText(product.caffeine)}</strong>
            <FieldStateBadge state={product.caffeine.state} />
          </div>
          <p>{servingText(product)}</p>
        </div>
      </Link>
      <div className="pr-card-actions">
        <LocalProductActions product={product} compact={!canSave(product)} />
      </div>
    </article>
  );
}

export function LocalProductActions({
  product,
  compact = false,
}: {
  product: PublicProductDto;
  compact?: boolean;
}) {
  // Kept as a server-rendered shell. The interactive implementation is loaded
  // below through a small client boundary so every primary page remains HTML
  // readable with JavaScript disabled.
  return <LocalProductActionsClient product={product} compact={compact} />;
}

export function MetricTile({
  label,
  value,
  detail,
  state,
  accent = "violet",
}: {
  label: string;
  value: string;
  detail?: string;
  state?: string;
  accent?: "violet" | "cyan" | "green" | "amber";
}) {
  return (
    <div className={`pr-metric-tile accent-${accent}`}>
      <span className="pr-metric-label">{label}</span>
      <strong>{value}</strong>
      {state ? <FieldStateBadge state={state} /> : null}
      {detail ? <span className="pr-metric-detail">{detail}</span> : null}
    </div>
  );
}

export function EmptyState({
  title = "No trusted products yet",
  description = "The public catalog only shows observations that passed the contract and promotion gates.",
  href = "/live-data",
  action = "Inspect live data",
}: {
  title?: string;
  description?: string;
  href?: string;
  action?: string;
}) {
  return (
    <section className="pr-empty-state">
      <div className="pr-empty-icon"><Database size={20} aria-hidden="true" /></div>
      <p className="pr-eyebrow">Catalog state</p>
      <h2>{title}</h2>
      <p>{description}</p>
      <Link href={href} className="pr-button pr-button-primary">
        {action} <ArrowRight size={15} aria-hidden="true" />
      </Link>
    </section>
  );
}

export function TrustCallout({
  title,
  children,
  tone = "neutral",
}: {
  title: string;
  children: React.ReactNode;
  tone?: "neutral" | "good" | "alert";
}) {
  const Icon = tone === "good" ? Check : tone === "alert" ? TriangleAlert : Info;
  return (
    <aside className={`pr-trust-callout tone-${tone}`}>
      <Icon size={17} aria-hidden="true" />
      <div><strong>{title}</strong><p>{children}</p></div>
    </aside>
  );
}

export function SourceNote({ observedAt, sourceUrl }: { observedAt: string; sourceUrl: string | null }) {
  return (
    <div className="pr-source-note">
      <span><Sparkles size={14} aria-hidden="true" /> Source observation</span>
      <time dateTime={observedAt}>{new Date(observedAt).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}</time>
      {sourceUrl ? <a href={sourceUrl} target="_blank" rel="noreferrer noopener">Caffeine Informer <ArrowRight size={13} aria-hidden="true" /></a> : <span>Source URL not published</span>}
    </div>
  );
}

export function SearchForm({ initialValue = "" }: { initialValue?: string }) {
  return (
    <form className="pr-explore-search" action="/explore" method="get">
      <Search size={17} aria-hidden="true" />
      <label htmlFor="explore-search" className="sr-only">Search the catalog</label>
      <input id="explore-search" name="search" defaultValue={initialValue} placeholder="Search the caffeine catalog" />
      <button className="pr-button pr-button-primary" type="submit">Search</button>
    </form>
  );
}

export function ScatterPlot({ products }: { products: PublicProductDto[] }) {
  const points = products.filter((product) => product.caffeine.mg !== null && product.serving.value !== null);
  if (points.length === 0) return null;
  const maxCaffeine = Math.max(...points.map((product) => product.caffeine.mg ?? 0), 1);
  const maxServing = Math.max(...points.map((product) => product.serving.value ?? 0), 1);
  return (
    <section className="pr-scatter" aria-labelledby="scatter-title">
      <h2 id="scatter-title">Total caffeine vs serving</h2>
      <p>Only exact numeric points are plotted. Missing and range values remain in the grid below.</p>
      <svg viewBox="0 0 700 235" role="img" aria-label="Scatter plot of total caffeine against serving size">
        <line x1="48" y1="18" x2="48" y2="198" /><line x1="48" y1="198" x2="680" y2="198" />
        <text x="48" y="222">0 ml</text><text x="625" y="222">{formatNumber(maxServing)} ml</text>
        <text x="7" y="198">0</text><text x="4" y="28">{formatNumber(maxCaffeine)} mg</text>
        {points.map((product) => {
          const x = 48 + ((product.serving.value ?? 0) / maxServing) * 632;
          const y = 198 - ((product.caffeine.mg ?? 0) / maxCaffeine) * 170;
          return <a href={`/products/${product.slug}`} key={product.slug}><title>{`${product.name}: ${caffeineText(product.caffeine)}, ${servingText(product)}`}</title><circle cx={x} cy={y} r="5" /></a>;
        })}
      </svg>
    </section>
  );
}

export function CoverageBar({ label, value, total }: { label: string; value: number; total: number }) {
  const percentage = total > 0 ? Math.round((value / total) * 100) : 0;
  return (
    <div className="pr-coverage-row">
      <div><span>{label}</span><strong>{total > 0 ? `${percentage}%` : "—"}</strong></div>
      <div className="pr-coverage-track"><span style={{ width: `${percentage}%` }} /></div>
      <small>{value.toLocaleString()} of {total.toLocaleString()} trusted records</small>
    </div>
  );
}

export function ProductTable({ products }: { products: PublicProductDto[] }) {
  return (
    <div className="pr-table-wrap">
      <table className="pr-data-table">
        <thead><tr><th>Product</th><th>Caffeine</th><th>Serving</th><th>Concentration</th><th>Data state</th></tr></thead>
        <tbody>
          {products.map((product) => (
            <tr key={product.slug}>
              <td><Link href={`/products/${product.slug}`} className="pr-table-product"><PublishedProductImage alt="" className={productImageStyles.tablePhoto} fallback={<ProductArt category={product.category} name={product.name} />} height={40} name={product.name} sizes="40px" slug={product.slug} width={40} /> <span><strong>{product.name}</strong><small>{categoryLabel(product.category)}</small></span></Link></td>
              <td><strong>{caffeineText(product.caffeine)}</strong><small>{product.caffeine.qualifier}</small></td>
              <td>{servingText(product)}</td>
              <td>{product.concentration.mgPer100Ml !== null ? `${formatNumber(product.concentration.mgPer100Ml)} mg / 100 ml` : "Not eligible"}</td>
              <td><FieldStateBadge state={product.caffeine.state} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function HeroCan() {
  return (
    <div className="pr-hero-can-wrap" aria-label="Abstract caffeine observatory can illustration">
      <div className="pr-hero-grid" aria-hidden="true" />
      <div className="pr-hero-can">
        <span className="pr-hero-can-top" />
        <span className="pr-hero-can-bolt"><Zap size={35} strokeWidth={2.5} /></span>
        <span className="pr-hero-can-copy">PULSE<br /><b>RANK</b></span>
        <span className="pr-hero-can-bottom">DATA / 01</span>
      </div>
      <span className="pr-hero-callout callout-top"><b>01</b><span>Field states</span></span>
      <span className="pr-hero-callout callout-right"><b>02</b><span>Trust gates</span></span>
      <span className="pr-hero-callout callout-bottom"><b>03</b><span>Real snapshots</span></span>
    </div>
  );
}

export function SectionHeading({
  eyebrow,
  title,
  action,
}: {
  eyebrow?: string;
  title: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="pr-section-heading">
      <div>{eyebrow ? <p className="pr-eyebrow">{eyebrow}</p> : null}<h2>{title}</h2></div>
      {action}
    </div>
  );
}

export function Breadcrumbs({ items }: { items: Array<{ label: string; href?: string }> }) {
  return <nav aria-label="Breadcrumb" className="pr-breadcrumbs">{items.map((item, index) => <span key={`${item.label}-${index}`}>{item.href ? <Link href={item.href}>{item.label}</Link> : item.label}{index < items.length - 1 ? <ChevronRight size={13} aria-hidden="true" /> : null}</span>)}</nav>;
}
