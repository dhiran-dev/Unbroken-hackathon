"use client";

import Image from "next/image";
import Link from "next/link";
import {
  ArrowLeft,
  Bookmark,
  Check,
  CircleX,
  ExternalLink,
  Fingerprint,
  Info,
  Leaf,
  Menu,
  Scale,
  Search,
  Sun,
  Zap,
} from "lucide-react";
import { useState, type ReactNode } from "react";

import {
  caffeinePresentation,
  categoryProvenanceLabel,
  fieldStateLabel,
  formatPassportNumber,
  rankingReasonLabel,
  sourceLevelLabel,
} from "@/components/pulserank/product-passport/product-passport-model";
import { categoryLabel } from "@/components/pulserank/public-ui";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { PublicProductDto } from "@/server/products/dto";

import {
  CardBody,
  CardContainer,
  CardItem,
  HoverBorderGradient,
} from "../product-passport-living/components/aceternity";
import { SmoothCursor } from "../product-passport-living/components/smooth-cursor";
import { LiquidMetalButton, LivingGreenScene } from "../product-passport-living/components/threeui";
import { BentoGrid, BentoGridItem } from "./components/bento-grid";
import { CaffeineSugarGlass } from "./components/caffeine-sugar-glass";
import styles from "./prototype.module.css";

function formatObservedAt(value: string) {
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
    minute: "2-digit",
    month: "short",
    timeZone: "UTC",
    timeZoneName: "short",
    year: "numeric",
  }).format(new Date(value));
}

function servingUnit(unit: PublicProductDto["serving"]["unit"]) {
  return unit?.replaceAll("_", " ") ?? "unit";
}

function Wordmark() {
  return (
    <Link aria-label="PulseRank home" className={styles.wordmark} href="/">
      <Zap aria-hidden="true" />
      <strong>Pulse<span>Rank</span></strong>
    </Link>
  );
}

function Header() {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <header className={styles.header}>
      <Wordmark />
      <nav aria-label="Primary navigation" className={styles.nav}>
        <Link className={styles.activeNav} href="/explore">Explore</Link>
        <Link href="/leaderboards">Leaderboards</Link>
        <Link href="/compare">Compare</Link>
        <Link href="/my-pulse">My Pulse</Link>
        <Link href="/changes">Changes</Link>
      </nav>
      <div className={styles.headerTools}>
        <Button aria-label="Search products — unavailable in this isolated prototype" className={styles.searchButton} disabled title="Search is unavailable in this isolated prototype" variant="ghost">
          <span>Search products…</span><Search aria-hidden="true" />
        </Button>
        <Button aria-label="Theme settings — dark only" className={styles.themeButton} disabled size="icon" title="PulseRank is dark only" variant="ghost">
          <Sun aria-hidden="true" />
        </Button>
        <Button
          aria-controls="mobile-passport-navigation"
          aria-expanded={menuOpen}
          aria-label="Toggle navigation"
          className={styles.menuButton}
          onClick={() => setMenuOpen((open) => !open)}
          size="icon"
          variant="ghost"
        >
          <Menu aria-hidden="true" />
        </Button>
      </div>
      {menuOpen ? (
        <nav aria-label="Mobile navigation" className={styles.mobileNav} id="mobile-passport-navigation">
          <Link href="/explore">Explore</Link>
          <Link href="/leaderboards">Leaderboards</Link>
          <Link href="/compare">Compare</Link>
          <Link href="/my-pulse">My Pulse</Link>
          <Link href="/changes">Changes</Link>
        </nav>
      ) : null}
    </header>
  );
}

function ProductImage({ product }: { product: PublicProductDto }) {
  const [failed, setFailed] = useState(false);
  const initials = product.name.split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase();

  return (
    <CardContainer className={styles.productTilt} containerClassName={styles.productPerspective}>
      <CardBody className={styles.productBody}>
        <CardItem className={styles.productLight} translateZ={-16} />
        <CardItem className={styles.productImage} translateY={-3} translateZ={34}>
          {product.image !== null && !failed ? (
            <Image
              alt={`${product.name} product packaging`}
              fill
              onError={() => setFailed(true)}
              priority
              sizes="(max-width: 920px) 86vw, 31vw"
              src={`/api/public/product-images/${encodeURIComponent(product.slug)}`}
              unoptimized
            />
          ) : (
            <div aria-label={`Procedural fallback artwork for ${product.name}`} className={styles.productFallback} role="img">
              <Zap aria-hidden="true" /><strong>{initials || "PR"}</strong>
            </div>
          )}
        </CardItem>
      </CardBody>
    </CardContainer>
  );
}

function ProductActions({ product }: { product: PublicProductDto }) {
  return (
    <div className={styles.actions}>
      <Button className={styles.saveAction} disabled title="Save is unavailable in this isolated prototype" variant="default">
        <Bookmark aria-hidden="true" />Save
      </Button>
      <HoverBorderGradient
        aria-label="Add this product to compare"
        className={styles.compareActionInner}
        containerClassName={styles.compareAction}
        disabled
        title="Compare is unavailable in this isolated prototype"
      >
        <Scale aria-hidden="true" />Compare
      </HoverBorderGradient>
      <LiquidMetalButton
        className={styles.liquidAction}
        onClick={() => { if (product.sourceUrl) window.open(product.sourceUrl, "_blank", "noopener,noreferrer"); }}
        text={product.sourceUrl ? "Open source" : "Source unavailable"}
      />
    </div>
  );
}

function ValueRows({ rows }: { rows: Array<[string, ReactNode]> }) {
  return (
    <dl className={styles.valueRows}>
      {rows.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
    </dl>
  );
}

function EligibilityMark({ eligible, label }: { eligible: boolean; label: string }) {
  const Icon = eligible ? Check : CircleX;
  return (
    <span className={styles.eligibilityMark} data-eligible={eligible ? "true" : "false"}>
      <Icon aria-hidden="true" />
      <span>{label}</span>
      <strong>{eligible ? "Yes" : "No"}</strong>
    </span>
  );
}

function MetricBand({ product }: { product: PublicProductDto }) {
  const caffeine = caffeinePresentation(product.caffeine);
  const caffeineValue = `${caffeine.value}${caffeine.unit ? ` ${caffeine.unit}` : ""}`;
  const sugarValue = product.sugar?.g === null || product.sugar === undefined
    ? product.sugar ? fieldStateLabel(product.sugar.state) : "Not published"
    : `${formatPassportNumber(product.sugar.g)} g`;
  const serving = product.serving.value === null
    ? fieldStateLabel(product.serving.state)
    : `${formatPassportNumber(product.serving.value)} ${servingUnit(product.serving.unit)}`;
  const concentration = product.concentration.mgPer100Ml === null
    ? "N/A"
    : `${formatPassportNumber(product.concentration.mgPer100Ml)} mg`;
  const calories = product.calories?.kcal === null || product.calories === undefined
    ? "Not published"
    : `${formatPassportNumber(product.calories.kcal)} kcal`;

  return (
    <section aria-label="Observed product facts" className={styles.metricBand}>
      <div className={`${styles.metricCell} ${styles.glassMetric}`}>
        <CaffeineSugarGlass caffeine={caffeineValue} sugar={sugarValue} />
      </div>
      <div className={styles.metricCell}>
        <span>Serving size <Info aria-hidden="true" /></span>
        <strong>{serving}</strong>
        <small>Published serving</small>
      </div>
      <div className={styles.metricCell}>
        <span>Concentration <Info aria-hidden="true" /></span>
        <strong>{concentration}</strong>
        <small>Per 100 ml</small>
      </div>
      <div className={styles.metricCell}>
        <span>Calories <Info aria-hidden="true" /></span>
        <strong>{calories}</strong>
        <small>Per serving</small>
      </div>
      <div className={styles.metricCell}>
        <span>Source level <Info aria-hidden="true" /></span>
        <strong>{sourceLevelLabel(product.caffeine.sourceLevel)}</strong>
        <small>Caffeine evidence</small>
      </div>
    </section>
  );
}

function EvidenceBento({ product }: { product: PublicProductDto }) {
  const caffeine = caffeinePresentation(product.caffeine);
  const reasons = product.rankingEligibility.reasons.length === 0
    ? "No exclusion reasons"
    : product.rankingEligibility.reasons.map(rankingReasonLabel).join(" ");

  return (
    <>
      <nav aria-label="Product Passport sections" className={styles.tabRail}>
        <a aria-current="page" href="#overview">Overview</a>
        <a href="#source-data">Source &amp; Data</a>
        <a href="#ranking">Ranking</a>
      </nav>
      <div id="overview">
      <BentoGrid className={styles.bentoGrid}>
        <BentoGridItem
          className={`${styles.bentoItem} ${styles.pairCard}`}
          description={<div className={styles.bentoPair}>
            <section>
              <h4>Product metadata</h4>
              <ValueRows rows={[
                ["Category", categoryLabel(product.category)],
                ["Provenance", categoryProvenanceLabel(product.categoryProvenance)],
                ["Form", product.serving.form],
              ]} />
            </section>
            <section>
              <h4>Observed facts</h4>
              <ValueRows rows={[
                ["Caffeine state", caffeine.stateLabel],
                ["Normalized volume", product.serving.normalizedMl === null ? fieldStateLabel(product.serving.state) : `${formatPassportNumber(product.serving.normalizedMl)} ml`],
                ["Observation", formatObservedAt(product.observedAt)],
              ]} />
            </section>
          </div>}
          title={<span className={styles.visuallyHidden}>Product evidence</span>}
        />
        <BentoGridItem
          className={`${styles.bentoItem} ${styles.pairCard}`}
          description={<div className={styles.bentoPair}>
            <section className={styles.sourceSection} id="source-data">
              <div className={styles.livingWindow}><LivingGreenScene className={styles.livingScene} /><span><Leaf aria-hidden="true" />Living source layer</span></div>
              <div className={styles.pairCopy}>
                <h4>Source record</h4>
                <ValueRows rows={[
                  ["Source", product.sourceUrl ? <a href={product.sourceUrl} key="source" rel="noreferrer" target="_blank">{product.sourceAttribution}<ExternalLink aria-hidden="true" /></a> : <span key="source">Source URL not published</span>],
                  ["Publication", "Trusted observation only"],
                ]} />
              </div>
            </section>
            <section id="ranking">
              <h4>Ranking eligibility</h4>
              <div className={styles.eligibilityList}>
                <EligibilityMark eligible={product.rankingEligibility.totalCaffeine} label="Total caffeine" />
                <EligibilityMark eligible={product.rankingEligibility.concentration} label="Concentration" />
                <p>{reasons}. Ranking state, not health guidance.</p>
              </div>
            </section>
          </div>}
          title={<span className={styles.visuallyHidden}>Source and ranking evidence</span>}
        />
      </BentoGrid>
      </div>
    </>
  );
}

export function GlassProductPassport({ fontClassName, product }: { fontClassName: string; product: PublicProductDto }) {
  const caffeine = caffeinePresentation(product.caffeine);

  return (
    <main className={`${styles.page} ${fontClassName}`}>
      <SmoothCursor className={styles.smoothCursor} />
      <Header />
      <div className={styles.shell}>
        <Link className={styles.backLink} href="/explore"><ArrowLeft aria-hidden="true" />Product Passport</Link>
        <section aria-labelledby="passport-title" className={styles.hero}>
          <aside className={styles.productColumn}>
            <div className={styles.productBay}><ProductImage product={product} /></div>
            <p className={styles.imageNote}><Fingerprint aria-hidden="true" />Published recognition image, rendered through PulseRank’s protected media route.</p>
          </aside>
          <div className={styles.passportColumn}>
            <div className={styles.identityTopline}>
              <Badge className={styles.categoryBadge}>{categoryLabel(product.category)}</Badge>
              <ProductActions product={product} />
            </div>
            <div className={styles.titleBlock}>
              <h1 id="passport-title">{product.name}</h1>
              <Badge className={styles.stateBadge}><Check aria-hidden="true" />{caffeine.stateLabel}</Badge>
              <p>Observed {formatObservedAt(product.observedAt)}<i aria-hidden="true" />Source: {product.sourceAttribution}</p>
            </div>
            <MetricBand product={product} />
            <EvidenceBento product={product} />
          </div>
        </section>
      </div>
    </main>
  );
}
