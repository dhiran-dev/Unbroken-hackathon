"use client";

import Image from "next/image";
import Link from "next/link";
import {
  ArrowLeft,
  Bookmark,
  CalendarPlus,
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
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";

import styles from "@/app/products/[slug]/product-passport.module.css";
import {
  GlassObject,
  HoverBorderGradient,
  LiquidMetalButton,
  LivingGreenAccent,
  SmoothCursor,
} from "./product-passport-effects";
import { ProductViewTracker } from "@/components/pulserank/local-workspaces";
import { categoryLabel } from "@/components/pulserank/public-ui";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { addCompareSlug, isInCompare, removeCompareSlug } from "@/lib/local-state/compare";
import { addMyDayEntry, utcDateKey, utcTimeLabel } from "@/lib/local-state/my-day";
import {
  isProductSaved,
  removeSavedProduct,
  saveSavedProduct,
  type SavedProductRef,
} from "@/lib/local-state/saved-products";
import type { PublicProductDto } from "@/server/products/dto";

import {
  caffeinePresentation,
  categoryProvenanceLabel,
  formatPassportNumber,
  myDayEligibility,
  nutritionPresentation,
  rankingReasonLabel,
  saveEligibility,
  servingPresentation,
  sourceLevelLabel,
} from "./product-passport-model";

type ProductPassportProps = {
  fontClassName: string;
  product: PublicProductDto;
};

function formatObservedAt(value: string): string {
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

function toSavedRef(product: PublicProductDto): SavedProductRef | null {
  if (!saveEligibility(product).eligible || product.caffeine.mg === null || product.serving.value === null) return null;
  return {
    slug: product.slug,
    name: product.name,
    category: product.category,
    caffeine: {
      mg: product.caffeine.mg,
      qualifier: product.caffeine.qualifier,
      sourceLevel: product.caffeine.sourceLevel,
    },
    serving: {
      value: product.serving.value,
      unit: product.serving.unit ?? "unknown",
      form: product.serving.form,
    },
    observedAt: product.observedAt,
  };
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
        <Link href="/explore">Explore</Link>
        <Link href="/leaderboards">Leaderboards</Link>
        <Link href="/compare">Compare</Link>
        <Link href="/my-pulse">My Pulse</Link>
        <Link href="/changes">Changes</Link>
      </nav>
      <div className={styles.headerTools}>
        <form action="/explore" className={styles.searchForm} method="get" role="search">
          <label className={styles.visuallyHidden} htmlFor="passport-search">Search products</label>
          <input id="passport-search" name="search" placeholder="Search products…" />
          <button aria-label="Search products" type="submit"><Search aria-hidden="true" /></button>
        </form>
        <Button aria-label="PulseRank uses a dark-only theme" className={styles.themeButton} disabled size="icon" title="PulseRank is dark only" variant="ghost">
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
  const initials = product.name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();

  return (
    <div className={styles.productPerspective}>
      <span aria-hidden="true" className={styles.productLight} />
      <div className={styles.productImage}>
        {product.image !== null && !failed ? (
          <Image
            alt={`${product.name} product packaging`}
            fill
            onError={() => setFailed(true)}
            preload
            sizes="(max-width: 920px) 78vw, 27vw"
            src={`/api/public/product-images/${encodeURIComponent(product.slug)}`}
            unoptimized
          />
        ) : (
          <div aria-label={`Procedural fallback artwork for ${product.name}`} className={styles.productFallback} role="img">
            <Zap aria-hidden="true" />
            <strong>{initials || "PR"}</strong>
            <small>{categoryLabel(product.category)}</small>
          </div>
        )}
      </div>
    </div>
  );
}

function ProductActions({ product }: { product: PublicProductDto }) {
  const savedRef = useMemo(() => toSavedRef(product), [product]);
  const saveGate = useMemo(() => saveEligibility(product), [product]);
  const myDayGate = useMemo(() => myDayEligibility(product), [product]);
  const [saved, setSaved] = useState(false);
  const [compared, setCompared] = useState(false);
  const [message, setMessage] = useState("Actions stay in this browser.");
  const [interactive, setInteractive] = useState(false);
  const localMutationVersion = useRef(0);

  useEffect(() => {
    let active = true;
    const hydrationVersion = localMutationVersion.current;
    void Promise.all([
      isProductSaved(product.slug),
      Promise.resolve(isInCompare(product.slug)),
    ]).then(([nextSaved, nextCompared]) => {
      if (!active) return;
      setInteractive(true);
      if (localMutationVersion.current !== hydrationVersion) return;
      setSaved(nextSaved);
      setCompared(nextCompared);
    }).catch(() => {
      if (active) setInteractive(true);
    });
    return () => { active = false; };
  }, [product.slug]);

  async function toggleSaved() {
    if (!savedRef) return;
    localMutationVersion.current += 1;
    try {
      if (saved) {
        const removed = await removeSavedProduct(product.slug);
        if (!removed) {
          setMessage("Could not remove the saved product because browser storage is unavailable.");
          return;
        }
        setSaved(false);
        setMessage("Removed from this browser.");
        return;
      }
      const stored = await saveSavedProduct(savedRef);
      if (stored === null) {
        setMessage("Could not save because browser storage is unavailable.");
        return;
      }
      setSaved(true);
      setMessage("Saved in this browser.");
    } catch {
      setMessage("Could not update Saved because browser storage failed.");
    }
  }

  function toggleCompare() {
    localMutationVersion.current += 1;
    const update = compared ? removeCompareSlug(product.slug) : addCompareSlug(product.slug);
    if (!update.ok) {
      setMessage("Could not update Compare because browser storage is unavailable.");
      return;
    }
    const nextCompared = update.slugs.includes(product.slug);
    setCompared(nextCompared);
    setMessage(
      nextCompared !== compared
        ? nextCompared ? "Added to Compare." : "Removed from Compare."
        : nextCompared ? "Already in Compare." : "Compare is full. Remove a product first.",
    );
  }

  async function addToMyDay() {
    if (!myDayGate.eligible || product.caffeine.mg === null) return;
    const now = new Date();
    try {
      const stored = await addMyDayEntry(utcDateKey(now), {
        caffeineMg: product.caffeine.mg,
        name: product.name,
        slug: product.slug,
        timeLabel: utcTimeLabel(now),
      });
      setMessage(stored === null
        ? "Could not add to My Day because browser storage is unavailable."
        : "Added to My Day in this browser.");
    } catch {
      setMessage("Could not add to My Day because browser storage failed.");
    }
  }

  const saveReasonId = `save-reason-${product.slug}`;
  const myDayReasonId = `my-day-reason-${product.slug}`;

  return (
    <aside aria-label="Product actions" className={styles.actions} data-interactive={interactive ? "true" : "false"}>
      <Button
        aria-describedby={!saveGate.eligible ? saveReasonId : undefined}
        aria-pressed={saved}
        className={styles.saveAction}
        disabled={!interactive || !saveGate.eligible}
        onClick={() => void toggleSaved()}
        title={saveGate.reason}
        type="button"
        variant="default"
      >
        {saved ? <Check aria-hidden="true" /> : <Bookmark aria-hidden="true" />}
        {saved ? "Saved" : "Save"}
      </Button>
      <HoverBorderGradient
        aria-label={compared ? "In Compare" : "Compare"}
        aria-pressed={compared}
        className={styles.compareAction}
        disabled={!interactive}
        onClick={toggleCompare}
      >
        {compared ? <Check aria-hidden="true" /> : <Scale aria-hidden="true" />}
        {compared ? "In Compare" : "Compare"}
      </HoverBorderGradient>
      <LiquidMetalButton
        aria-describedby={!myDayGate.eligible ? myDayReasonId : undefined}
        className={styles.liquidAction}
        disabled={!interactive || !myDayGate.eligible}
        onClick={() => void addToMyDay()}
        title={myDayGate.reason}
      >
        <CalendarPlus aria-hidden="true" />
        Add to My Day
      </LiquidMetalButton>
      {!saveGate.eligible || !myDayGate.eligible ? (
        <div className={styles.actionReasons}>
          {!saveGate.eligible ? <p id={saveReasonId}><strong>Save unavailable:</strong> {saveGate.reason}</p> : null}
          {!myDayGate.eligible ? <p id={myDayReasonId}><strong>My Day unavailable:</strong> {myDayGate.reason}</p> : null}
        </div>
      ) : null}
      <p aria-live="polite" className={styles.actionMessage} role="status">{message}</p>
    </aside>
  );
}

function CompactGlassMetric({ product }: { product: PublicProductDto }) {
  const caffeine = caffeinePresentation(product.caffeine);
  const caffeineValue = `${caffeine.value}${caffeine.unit ? ` ${caffeine.unit}` : ""}`;
  const serving = servingPresentation(product.serving);
  const servingContext = product.serving.state === "present"
    ? product.serving.value === null
      ? "serving value: not published"
      : "in one published serving"
    : `serving context: ${serving.stateLabel.toLowerCase()}`;
  const sugar = nutritionPresentation(
    product.sugar ? { state: product.sugar.state, value: product.sugar.g } : undefined,
    " g",
  );

  return (
    <>
      <h2 className={styles.visuallyHidden}>Total caffeine · {caffeine.stateLabel}</h2>
      <div
        aria-label={`Observed values: ${caffeineValue} caffeine and ${sugar.value} sugar; ${servingContext}`}
        className={styles.glassInstrument}
        role="img"
      >
        <div aria-hidden="true" className={styles.glassAura} />
        <GlassObject className={styles.glassObject} />
        <div className={styles.glassReadout}>
          <span>Total caffeine</span>
          <strong>{caffeine.value}{caffeine.unit ? <small>{caffeine.unit}</small> : null}</strong>
          <em data-state={caffeine.state}>{caffeine.stateLabel}</em>
          <p><span>Sugar</span><b>{sugar.value}</b></p>
          <small className={styles.glassNote}>No recommended target implied</small>
        </div>
      </div>
    </>
  );
}

function MetricCell({ detail, label, state, value }: { detail: string; label: string; state: string; value: string }) {
  return (
    <div className={styles.metricCell} data-state={state}>
      <span>{label}<Info aria-hidden="true" /></span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </div>
  );
}

function MetricBand({ product }: { product: PublicProductDto }) {
  const sugar = nutritionPresentation(
    product.sugar ? { state: product.sugar.state, value: product.sugar.g } : undefined,
    " g",
  );
  const serving = servingPresentation(product.serving);
  const concentration = product.concentration.mgPer100Ml === null
    ? "N/A"
    : `${formatPassportNumber(product.concentration.mgPer100Ml)} mg`;
  const calories = nutritionPresentation(
    product.calories ? { state: product.calories.state, value: product.calories.kcal } : undefined,
    " kcal",
  );

  return (
    <section aria-label="Observed product facts" className={styles.metricBand}>
      <div className={`${styles.metricCell} ${styles.glassMetric}`}><CompactGlassMetric product={product} /></div>
      <MetricCell detail={product.serving.form} label="Serving size" state={product.serving.state} value={serving.value} />
      <MetricCell detail={product.concentration.mgPer100Ml === null ? "Exact caffeine + ml required" : "Per 100 ml"} label="Concentration" state={product.concentration.mgPer100Ml === null ? "not_applicable" : "present"} value={concentration} />
      <MetricCell detail={sugar.detail} label="Sugar" state={sugar.state} value={sugar.value} />
      <MetricCell detail={calories.detail} label="Calories" state={calories.state} value={calories.value} />
    </section>
  );
}

function ValueRows({ rows }: { rows: Array<[string, ReactNode, string?]> }) {
  return (
    <dl className={styles.valueRows}>
      {rows.map(([label, value, state]) => (
        <div data-state={state} key={label}><dt>{label}</dt><dd>{value}</dd></div>
      ))}
    </dl>
  );
}

function EligibilityMark({ eligible, label }: { eligible: boolean; label: string }) {
  const Icon = eligible ? Check : CircleX;
  return (
    <div className={styles.eligibilityMark} data-eligible={eligible ? "true" : "false"}>
      <span>{label}</span>
      <Icon aria-hidden="true" />
      <strong>{eligible ? "Yes" : "No"}</strong>
    </div>
  );
}

function EvidenceBento({ product }: { product: PublicProductDto }) {
  const caffeine = caffeinePresentation(product.caffeine);
  const serving = servingPresentation(product.serving);
  const reasons = product.rankingEligibility.reasons.map(rankingReasonLabel);

  return (
    <>
      <nav aria-label="Product Passport sections" className={styles.tabRail}>
        <a className={styles.activeTab} href="#overview">Overview</a>
        <a href="#source-data">Source &amp; Data</a>
        <a href="#ranking">Ranking</a>
      </nav>
      <section aria-label="Product evidence" className={styles.bentoGrid} id="overview">
        <article className={styles.bentoItem} data-bento-item>
          <section data-evidence-column="product-metadata">
            <h3>Product metadata</h3>
            <ValueRows rows={[
              ["Category", categoryLabel(product.category)],
              ["Classification source", categoryProvenanceLabel(product.categoryProvenance)],
              ["Serving form", product.serving.form],
              ["Serving size", serving.value, product.serving.state],
            ]} />
          </section>
          <section data-evidence-column="observed-facts">
            <h3>Observed facts</h3>
            <ValueRows rows={[
              ["Caffeine", `${caffeine.value}${caffeine.unit ? ` ${caffeine.unit}` : ""}`, caffeine.state],
              ["Serving (normalized)", serving.normalizedValue, product.serving.state],
              ["Observed", formatObservedAt(product.observedAt)],
            ]} />
          </section>
        </article>
        <article className={styles.bentoItem} data-bento-item>
          <section className={styles.sourceSection} data-evidence-column="source-record" id="source-data">
            <div className={styles.livingWindow}>
              <Leaf aria-hidden="true" />
              <span>Trusted living source layer</span>
            </div>
            <div className={styles.sourceCopy}>
              <h3>Source record</h3>
              <ValueRows rows={[
                ["Source", product.sourceUrl ? <a href={product.sourceUrl} key="source" rel="noreferrer noopener" target="_blank">{product.sourceAttribution}<ExternalLink aria-hidden="true" /></a> : <span key="source">Source URL not published</span>],
                ["Published level", sourceLevelLabel(product.caffeine.sourceLevel)],
              ]} />
            </div>
          </section>
          <section data-evidence-column="ranking-eligibility" id="ranking">
            <h3>Ranking eligibility <Info aria-hidden="true" /></h3>
            <div className={styles.eligibilityList}>
              <EligibilityMark eligible={product.rankingEligibility.totalCaffeine} label="Total caffeine eligible" />
              <EligibilityMark eligible={product.rankingEligibility.concentration} label="Concentration eligible" />
              <p>{reasons.length > 0 ? reasons.join(" ") : "No exclusion reasons."} Ranking state is not health guidance.</p>
            </div>
          </section>
        </article>
      </section>
    </>
  );
}

export function ProductPassport({ fontClassName, product }: ProductPassportProps) {
  const caffeine = caffeinePresentation(product.caffeine);

  return (
    <div className={`${styles.page} ${fontClassName}`}>
      <a className={styles.skipLink} href="#product-passport-main">Skip to Product Passport</a>
      <SmoothCursor className={styles.smoothCursor} />
      <LivingGreenAccent className={styles.livingPageAccent} />
      <Header />
      <ProductViewTracker product={product} />
      <main className={styles.shell} id="product-passport-main">
        <Link className={styles.backLink} href="/explore"><ArrowLeft aria-hidden="true" />Product Passport</Link>
        <section aria-labelledby="passport-title" className={styles.hero}>
          <aside className={styles.productColumn}>
            <div className={styles.productBay} data-product-bay>
              <div className={styles.productSpecimen} data-product-specimen><ProductImage product={product} /></div>
            </div>
            <p className={styles.imageNote}><Fingerprint aria-hidden="true" />Published recognition image, rendered through PulseRank’s protected media route.</p>
          </aside>
          <div className={styles.passportColumn}>
            <div className={styles.identityTopline}>
              <Badge className={styles.categoryBadge}>{categoryLabel(product.category)}</Badge>
              <ProductActions product={product} />
            </div>
            <div className={styles.titleBlock}>
              <h1 id="passport-title">{product.name}</h1>
              <div className={styles.truthCluster}>
                <Badge className={styles.stateBadge} data-state={caffeine.state}>
                  {caffeine.state === "exact" || caffeine.state === "explicit-zero" ? <Check aria-hidden="true" /> : <Info aria-hidden="true" />}
                  {caffeine.stateLabel}
                </Badge>
                <p>Observed {formatObservedAt(product.observedAt)}<i aria-hidden="true" />Source: {product.sourceAttribution}</p>
              </div>
            </div>
            <MetricBand product={product} />
            <EvidenceBento product={product} />
          </div>
        </section>
      </main>
    </div>
  );
}
