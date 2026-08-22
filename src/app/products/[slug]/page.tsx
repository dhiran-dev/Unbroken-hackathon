import type { Metadata } from "next";
import { notFound } from "next/navigation";

import {
  Breadcrumbs,
  FieldStateBadge,
  LocalProductActions,
  ProductArt,
  PublicHeader,
  SourceNote,
  TrustCallout,
  categoryLabel,
  caffeineText,
  formatNumber,
  servingText,
} from "@/components/pulserank/public-ui";
import { ProductViewTracker } from "@/components/pulserank/local-workspaces";
import { OptionalVisualStage } from "@/components/pulserank/visual-stage/optional-stage";
import { toPublicProductDto } from "@/server/products/dto";
import { getProductBySlug } from "@/server/products/queries";

export const dynamic = "force-dynamic";

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
  const product = toPublicProductDto(row);
  const variants = row.payload.variants ?? [];
  const flavours = row.payload.flavours ?? [];

  return (
    <div className="pr-app">
      <PublicHeader />
      <main className="pr-shell pr-main">
        <Breadcrumbs items={[{ label: "Explore", href: "/explore" }, { label: categoryLabel(product.category), href: `/explore?category=${product.category}` }, { label: product.name }]} />
        <ProductViewTracker product={product} />
        <OptionalVisualStage page="product" variant="product" className="pr-route-stage pr-product-stage" />
        <section className="pr-product-hero">
          <ProductArt category={product.category} name={product.name} large />
          <div className="pr-product-detail">
            <p className="pr-eyebrow">Product passport · {categoryLabel(product.category)}</p>
            <h1>{product.name}</h1>
            <p>One trusted observation, presented with the field states and qualifiers that determine how far this product can travel through PulseRank.</p>
            <div className="pr-product-actions"><LocalProductActions product={product} /><a className="pr-button pr-button-ghost" href={product.sourceUrl} target="_blank" rel="noreferrer noopener">Open source page</a></div>
            <SourceNote observedAt={product.observedAt} sourceUrl={product.sourceUrl} />
          </div>
        </section>

        <section className="pr-metric-strip" aria-label="Product metrics">
          <div className="pr-metric-tile accent-violet"><span className="pr-metric-label">Total caffeine</span><strong>{caffeineText(product.caffeine)}</strong><FieldStateBadge state={product.caffeine.state} /></div>
          <div className="pr-metric-tile accent-cyan"><span className="pr-metric-label">Serving</span><strong>{product.serving.value === null ? "—" : `${formatNumber(product.serving.value)} ${product.serving.unit ?? ""}`}</strong><span className="pr-metric-detail">{product.serving.form}</span></div>
          <div className="pr-metric-tile accent-green"><span className="pr-metric-label">Concentration</span><strong>{product.concentration.mgPer100Ml === null ? "—" : `${formatNumber(product.concentration.mgPer100Ml)}`}</strong><span className="pr-metric-detail">mg per 100 ml · exact only</span></div>
          <div className="pr-metric-tile accent-amber"><span className="pr-metric-label">Source band</span><strong>{product.caffeine.sourceLevel.replaceAll("_", " ")}</strong><span className="pr-metric-detail">published source level</span></div>
        </section>

        <div className="pr-tabs"><a className="pr-tab is-active" href="#overview">Overview</a><a className="pr-tab" href="#source-notes">Source & notes</a>{variants.length > 0 ? <a className="pr-tab" href="#variations">Variations</a> : null}</div>
        <div className="pr-detail-grid">
          <section id="overview" className="pr-detail-card"><h2>What the source says</h2><dl className="pr-detail-list"><div><dt>Caffeine</dt><dd>{caffeineText(product.caffeine)} · {product.caffeine.qualifier}</dd></div><div><dt>Serving</dt><dd>{servingText(product)}</dd></div><div><dt>Calories</dt><dd>{product.calories?.kcal === null || product.calories === undefined ? "Not published" : `${product.calories.kcal} kcal`} {product.calories ? <FieldStateBadge state={product.calories.state} /> : null}</dd></div><div><dt>Sugar</dt><dd>{product.sugar?.g === null || product.sugar === undefined ? "Not published" : `${product.sugar.g} g`} {product.sugar ? <FieldStateBadge state={product.sugar.state} /> : null}</dd></div></dl><TrustCallout tone={product.rankingEligibility.totalCaffeine ? "good" : "alert"} title={product.rankingEligibility.totalCaffeine ? "Eligible for total-caffeine ranking" : "Not eligible for total-caffeine ranking"}>{product.rankingEligibility.reasons.length > 0 ? product.rankingEligibility.reasons.join(" · ") : "The trusted record carries a usable numeric or range caffeine observation."}</TrustCallout></section>
          <aside id="source-notes" className="pr-detail-card"><h2>Ranking eligibility</h2><div className="pr-eligibility"><span className={`pr-eligibility-chip ${product.rankingEligibility.totalCaffeine ? "is-eligible" : "is-excluded"}`}>{product.rankingEligibility.totalCaffeine ? "✓" : "—"} Total caffeine</span><span className={`pr-eligibility-chip ${product.rankingEligibility.concentration ? "is-eligible" : "is-excluded"}`}>{product.rankingEligibility.concentration ? "✓" : "—"} Exact concentration</span></div><p className="pr-muted-copy">A concentration value requires exact caffeine and a positive serving normalized to milliliters. This rule is deterministic and source-derived.</p><p className="pr-muted-copy">Source: <a href={product.sourceUrl} target="_blank" rel="noreferrer noopener">Caffeine Informer</a><br />Observed: {new Date(product.observedAt).toLocaleString()}</p></aside>
        </div>

        {variants.length > 0 || flavours.length > 0 ? <section id="variations" className="pr-section"><div className="pr-detail-card"><h2>Listed variations</h2><div className="pr-local-list">{[...variants.map((variant) => variant.name), ...flavours.map((flavour) => flavour.name)].map((name) => <div className="pr-local-list-item" key={name}><span><strong>{name}</strong><small>Observed variation · no additional inferred metrics</small></span></div>)}</div></div></section> : null}
      </main>
    </div>
  );
}
