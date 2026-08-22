import type { Metadata } from "next";

import { ArrowRight, Database, Eye, FlaskConical } from "lucide-react";

import {
  HeroCan,
  ProductCard,
  PublicHeader,
  SectionHeading,
  TrustCallout,
  categoryLabel,
} from "@/components/pulserank/public-ui";
import { OptionalVisualStage } from "@/components/pulserank/visual-stage/optional-stage";
import { toPublicProductDto } from "@/server/products/dto";
import { getOverviewStats } from "@/server/products/queries";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Know what moves you",
  description:
    "Discover caffeine products through trusted source observations and explicit data states.",
};

export default async function HomePage() {
  const stats = await getOverviewStats();
  const featured = stats.featured.map((row) => toPublicProductDto(row));
  const lead = featured[0];

  return (
    <div className="pr-app">
      <PublicHeader active="home" />
      <main className="pr-shell pr-main">
        <section className="pr-home-hero">
          <div>
            <p className="pr-home-kicker"><span />The caffeine observatory</p>
            <h1>Discover what <em>powers</em> your day.</h1>
            <p className="pr-home-copy">
              PulseRank turns source observations into a clear, navigable catalog—so you can see what is published, what is comparable, and where the data stops.
            </p>
            <div className="pr-home-actions">
              <a className="pr-button pr-button-primary" href="/explore">Explore the catalog <ArrowRight size={15} aria-hidden="true" /></a>
              <a className="pr-button pr-button-ghost" href="/live-data">View live data</a>
            </div>
            {lead ? <p className="pr-home-featured">Featured from the trusted snapshot: <a href={`/products/${lead.slug}`}>{lead.name}</a> · {categoryLabel(lead.category)}</p> : null}
          </div>
          <div className="pr-hero-visual">
            <HeroCan />
            <OptionalVisualStage page="home" variant="home" className="pr-hero-stage" />
          </div>
        </section>

        <section className="pr-hero-stats" aria-label="Trusted catalog statistics">
          <div className="pr-hero-stat"><strong>{stats.trustedProductCount.toLocaleString()}</strong><span>Trusted products</span></div>
          <div className="pr-hero-stat"><strong>{stats.categoryCount.toLocaleString()}</strong><span>Categories</span></div>
          <div className="pr-hero-stat"><strong>{stats.fieldCoverage.caffeineObserved.toLocaleString()}</strong><span>Caffeine observed</span></div>
          <div className="pr-hero-stat"><strong>{stats.fieldCoverage.concentrationEligible.toLocaleString()}</strong><span>Concentration-ready</span></div>
        </section>

        <section className="pr-signal-grid" aria-label="PulseRank principles">
          <article className="pr-signal-card"><Database size={18} aria-hidden="true" /><h3>One source, visible provenance.</h3><p>Every public record points back to Caffeine Informer and its observation time. No anonymous blend of sources.</p></article>
          <article className="pr-signal-card"><Eye size={18} aria-hidden="true" /><h3>States stay states.</h3><p>Not published, conflicting, and needs-review fields remain explicit. A blank is never quietly turned into zero.</p></article>
          <article className="pr-signal-card"><FlaskConical size={18} aria-hidden="true" /><h3>Rank what qualifies.</h3><p>Leaderboards use deterministic eligibility rules. Exact concentration only appears when exact caffeine and volume support it.</p></article>
        </section>

        <section className="pr-section">
          <SectionHeading eyebrow="Latest trusted snapshot" title="What is moving right now" action={<a href="/explore">See all products <ArrowRight size={14} /></a>} />
          {featured.length > 0 ? <div className="pr-product-grid">{featured.map((product) => <ProductCard key={product.slug} product={product} />)}</div> : <TrustCallout title="The public catalog is waiting for its first trusted snapshot" tone="alert">The most recent external attempts are visible in Live Data, but no row has passed promotion yet. Once a collector run succeeds, this section will populate from the database—not placeholder products.</TrustCallout>}
        </section>
      </main>
    </div>
  );
}
