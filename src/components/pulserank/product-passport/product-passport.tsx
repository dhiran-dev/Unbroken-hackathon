"use client";

import Image from "next/image";
import Link from "next/link";
import {
  BadgeCheck,
  Bookmark,
  Brackets,
  Check,
  CircleHelp,
  CircleOff,
  ExternalLink,
  GitCompareArrows,
  MinusCircle,
  Plus,
  TriangleAlert,
  Waves,
  Zap,
} from "lucide-react";
import {
  type CSSProperties,
  useEffect,
  useId,
  useMemo,
  useState,
} from "react";

import styles from "@/app/products/[slug]/product-passport.module.css";
import { ProductViewTracker } from "@/components/pulserank/local-workspaces";
import {
  PublicHeader,
  categoryLabel,
} from "@/components/pulserank/public-ui";
import { addCompareSlug, isInCompare, removeCompareSlug } from "@/lib/local-state/compare";
import { addMyDayEntry } from "@/lib/local-state/my-day";
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
  fieldStateLabel,
  formatPassportNumber,
  rankingReasonLabel,
  sourceLevelLabel,
  sugarScale,
} from "./product-passport-model";

type ProductPassportProps = {
  fontClassName: string;
  product: PublicProductDto;
  variations: string[];
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

function servingUnit(unit: PublicProductDto["serving"]["unit"]): string {
  if (unit === null) return "";
  return unit.replaceAll("_", " ");
}

function toSavedRef(product: PublicProductDto): SavedProductRef | null {
  if (product.caffeine.mg === null || product.serving.value === null) return null;
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

function ProductArtwork({ product }: { product: PublicProductDto }) {
  const [failed, setFailed] = useState(false);
  const initials = product.name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();

  return (
    <div className={styles.specimenFrame} data-product-specimen>
      <span aria-hidden="true" className={styles.specimenGrid} />
      {product.image !== null && !failed ? (
        <Image
          alt={`${product.name} product packaging`}
          className={styles.productImage}
          fill
          onError={() => setFailed(true)}
          preload
          sizes="(max-width: 760px) calc(100vw - 56px), (max-width: 1300px) 280px, 340px"
          src={`/api/public/product-images/${encodeURIComponent(product.slug)}`}
          unoptimized
        />
      ) : (
        <div
          aria-label={`Procedural ${categoryLabel(product.category)} artwork for ${product.name}`}
          className={styles.proceduralArtwork}
          role="img"
        >
          <span aria-hidden="true" className={styles.proceduralCap} />
          <span aria-hidden="true" className={styles.proceduralBolt}><Zap /></span>
          <strong>{initials || "PR"}</strong>
          <small>{categoryLabel(product.category)}</small>
        </div>
      )}
    </div>
  );
}

function ProductBay({ product }: { product: PublicProductDto }) {
  return (
    <section
      aria-label={`${product.name} product artwork`}
      className={`${styles.instrumentPanel} ${styles.productBay}`}
      data-product-bay
    >
      <ProductArtwork product={product} />
    </section>
  );
}

function CaffeinePanel({ product }: { product: PublicProductDto }) {
  const metric = caffeinePresentation(product.caffeine);
  const serving = product.serving.value === null
    ? "Serving context not published"
    : `per ${formatPassportNumber(product.serving.value)} ${servingUnit(product.serving.unit)} serving`;

  return (
    <section
      aria-labelledby="caffeine-heading"
      className={`${styles.instrumentPanel} ${styles.caffeinePanel}`}
      data-state={metric.state}
    >
      <div className={styles.reticle} aria-hidden="true" />
      <h2 id="caffeine-heading">Total caffeine <span>· {metric.stateLabel}</span></h2>
      <div className={styles.caffeineValue} data-long={metric.value.length > 8 ? "true" : "false"}>
        <strong>{metric.value}</strong>
        {metric.unit ? <span>{metric.unit}</span> : null}
      </div>
      <p>{serving}</p>
      <span aria-hidden="true" className={styles.datumLine} />
    </section>
  );
}

function MetricCell({
  detail,
  label,
  state,
  value,
}: {
  detail: string;
  label: string;
  state?: string;
  value: string;
}) {
  return (
    <div className={styles.metricCell}>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{state ?? detail}</small>
    </div>
  );
}

function MetricStrip({ product }: { product: PublicProductDto }) {
  const serving = product.serving.value === null
    ? fieldStateLabel(product.serving.state)
    : `${formatPassportNumber(product.serving.value)} ${servingUnit(product.serving.unit)}`;
  const normalized = product.serving.normalizedMl === null
    ? fieldStateLabel(product.serving.state)
    : `${formatPassportNumber(product.serving.normalizedMl)} ml`;
  const concentration = product.concentration.mgPer100Ml === null
    ? "Not eligible"
    : formatPassportNumber(product.concentration.mgPer100Ml);
  const calories = product.calories?.kcal === null || product.calories === undefined
    ? product.calories ? fieldStateLabel(product.calories.state) : "Not available"
    : formatPassportNumber(product.calories.kcal);

  return (
    <section aria-label="Primary product metrics" className={`${styles.instrumentPanel} ${styles.metricStrip}`}>
      <MetricCell detail={product.serving.form} label="Serving" value={serving} />
      <MetricCell detail="Normalized volume" label="Normalized" value={normalized} />
      <MetricCell
        detail="mg / 100 ml"
        label="Concentration"
        state={product.concentration.mgPer100Ml === null ? "Exact caffeine + ml required" : undefined}
        value={concentration}
      />
      <MetricCell
        detail="kcal per serving"
        label="Calories"
        state={product.calories ? fieldStateLabel(product.calories.state) : "Not in public response"}
        value={calories}
      />
    </section>
  );
}

function SugarVessel({ product }: { product: PublicProductDto }) {
  const scale = sugarScale(product.sugar);
  const clipId = `sugar-${useId().replaceAll(":", "")}`;
  const patternId = `${clipId}-grain`;
  const innerTop = 144;
  const innerBottom = 364;
  const innerHeight = innerBottom - innerTop;
  const fillHeight = scale.fillPercent === null ? 0 : innerHeight * scale.fillPercent / 100;
  const fillY = innerBottom - fillHeight;
  const serving = product.serving.value === null
    ? "serving context not published"
    : `per ${formatPassportNumber(product.serving.value)} ${servingUnit(product.serving.unit)} serving`;
  const accessibleDescription = scale.fillPercent === null
    ? `${scale.valueLabel}. No fill level is shown because a numeric sugar quantity is unavailable.`
    : scale.fillPercent === 0
      ? "Explicitly published as zero grams. The bottle is intentionally empty."
      : `${scale.valueLabel} of published sugar, shown on an adaptive ${formatPassportNumber(scale.maximum ?? 0)} gram bottle scale.`;

  return (
    <section
      aria-labelledby="sugar-heading"
      className={`${styles.instrumentPanel} ${styles.sugarPanel}`}
      data-state={scale.state}
    >
      <div className={styles.sugarCopy}>
        <h2 id="sugar-heading">Sugar measure</h2>
        <strong>{scale.valueLabel}</strong>
        <p>{serving}</p>
        <span className={styles.stateMarker}>{scale.stateLabel}</span>
      </div>
      <svg
        aria-describedby="sugar-description"
        aria-label="Sugar quantity in a glass measuring bottle"
        className={styles.sugarVessel}
        role="img"
        viewBox="0 0 250 420"
      >
        <title>Sugar quantity in a glass measuring bottle</title>
        <desc id="sugar-description">{accessibleDescription}</desc>
        <defs>
          <clipPath id={clipId}>
            <path d="M87 30h76v58c0 13 24 20 31 48v218c0 27-17 42-43 42h-52c-26 0-43-15-43-42V136c7-28 31-35 31-48Z" />
          </clipPath>
          <pattern height="12" id={patternId} patternUnits="userSpaceOnUse" width="12">
            <rect fill="#e9e7df" height="12" width="12" />
            <circle cx="3" cy="4" fill="#fff" r="1.2" />
            <circle cx="9" cy="9" fill="#c9c5ba" r="1" />
            <circle cx="11" cy="2" fill="#f8f7f2" r=".8" />
          </pattern>
          <linearGradient id={`${clipId}-glass`} x1="0" x2="1">
            <stop offset="0" stopColor="#c8d0d3" stopOpacity=".08" />
            <stop offset=".18" stopColor="#fff" stopOpacity=".38" />
            <stop offset=".34" stopColor="#fff" stopOpacity=".04" />
            <stop offset=".76" stopColor="#8f9a9f" stopOpacity=".08" />
            <stop offset=".9" stopColor="#fff" stopOpacity=".3" />
            <stop offset="1" stopColor="#c8d0d3" stopOpacity=".08" />
          </linearGradient>
        </defs>
        <path className={styles.bottleShadow} d="M87 30h76v58c0 13 24 20 31 48v218c0 27-17 42-43 42h-52c-26 0-43-15-43-42V136c7-28 31-35 31-48Z" />
        <g clipPath={`url(#${clipId})`}>
          {scale.fillPercent !== null && scale.fillPercent > 0 ? (
            <rect
              className={styles.sugarFill}
              fill={`url(#${patternId})`}
              height={fillHeight}
              width="138"
              x="56"
              y={fillY}
            />
          ) : null}
          {scale.fillPercent === null ? (
            <g className={styles.unavailableFill}>
              <path d="M74 238h102" />
              <path d="m99 214 52 52" />
              <path d="m151 214-52 52" />
            </g>
          ) : null}
          <rect fill={`url(#${clipId}-glass)`} height="380" width="150" x="50" y="22" />
        </g>
        <path className={styles.bottleOutline} d="M87 30h76v58c0 13 24 20 31 48v218c0 27-17 42-43 42h-52c-26 0-43-15-43-42V136c7-28 31-35 31-48Z" />
        <path className={styles.bottleLip} d="M82 30h86v19H82zM86 58h78" />
        {scale.maximum !== null ? scale.ticks.map((tick) => {
          const y = innerBottom - (tick / scale.maximum!) * innerHeight;
          return (
            <g className={styles.bottleTick} key={tick}>
              <path d={`M154 ${y}h18`} />
              <text x="178" y={y + 4}>{formatPassportNumber(tick)} g</text>
            </g>
          );
        }) : null}
      </svg>
      <p className={styles.scaleNote}>Bottle scale represents published grams; not a recommended limit.</p>
    </section>
  );
}

function LocalActionRail({ product }: { product: PublicProductDto }) {
  const savedRef = useMemo(() => toSavedRef(product), [product]);
  const [saved, setSaved] = useState(false);
  const [compared, setCompared] = useState(false);
  const [message, setMessage] = useState("Actions stay in this browser");

  useEffect(() => {
    let active = true;
    void Promise.all([
      isProductSaved(product.slug),
      Promise.resolve(isInCompare(product.slug)),
    ]).then(([nextSaved, nextCompared]) => {
      if (!active) return;
      setSaved(nextSaved);
      setCompared(nextCompared);
    });
    return () => { active = false; };
  }, [product.slug]);

  async function toggleSaved() {
    if (!savedRef) {
      setMessage("Save requires a numeric caffeine value and serving.");
      return;
    }
    if (saved) {
      await removeSavedProduct(product.slug);
      setSaved(false);
      setMessage("Removed from this browser.");
      return;
    }
    await saveSavedProduct(savedRef);
    setSaved(true);
    setMessage("Saved in this browser.");
  }

  function toggleCompare() {
    const update = compared
      ? removeCompareSlug(product.slug)
      : addCompareSlug(product.slug);
    const nowCompared = update.slugs.includes(product.slug);
    setCompared(nowCompared);
    setMessage(
      update.added || compared
        ? nowCompared ? "Added to Compare." : "Removed from Compare."
        : "Compare is full. Remove a product first.",
    );
  }

  async function addToDay() {
    if (!savedRef) {
      setMessage("My Day requires an exact numeric caffeine value.");
      return;
    }
    const now = new Date();
    await addMyDayEntry(now.toISOString().slice(0, 10), {
      caffeineMg: savedRef.caffeine.mg,
      name: product.name,
      slug: product.slug,
      timeLabel: now.toLocaleTimeString([], {
        hour: "2-digit",
        hour12: false,
        minute: "2-digit",
      }),
    });
    setMessage("Added to My Day in this browser.");
  }

  return (
    <aside aria-label="Local product actions" className={`${styles.instrumentPanel} ${styles.actionRail}`}>
      <button aria-pressed={saved} className={saved ? styles.selectedAction : undefined} onClick={() => void toggleSaved()} type="button">
        {saved ? <Check aria-hidden="true" /> : <Bookmark aria-hidden="true" />}
        <span><strong>{saved ? "Saved" : "Save"}</strong><small>Stay in this browser</small></span>
      </button>
      <button aria-pressed={compared} className={compared ? styles.selectedAction : undefined} onClick={toggleCompare} type="button">
        <GitCompareArrows aria-hidden="true" />
        <span><strong>{compared ? "In Compare" : "Compare"}</strong><small>Stay in this browser</small></span>
      </button>
      <button onClick={() => void addToDay()} type="button">
        <Plus aria-hidden="true" />
        <span><strong>Add to My Day</strong><small>Stay in this browser</small></span>
      </button>
      <p aria-live="polite" className={styles.actionMessage} role="status">{message}</p>
    </aside>
  );
}

function FactRow({ label, state, value }: { label: string; state?: string; value: string }) {
  return (
    <div className={styles.factRow}>
      <dt>{label}</dt>
      <dd><span>{value}</span>{state ? <small>{state}</small> : null}</dd>
    </div>
  );
}

function ProductMetadata({ product }: { product: PublicProductDto }) {
  return (
    <section
      className={`${styles.evidenceColumn} ${styles.productMetadata}`}
      aria-labelledby="product-title"
      data-evidence-column="product-metadata"
    >
      <span className={styles.evidenceEyebrow}>Product metadata</span>
      <h1 id="product-title">{product.name}</h1>
      <dl>
        <FactRow label="Category" value={categoryLabel(product.category)} />
        <FactRow label="Product type" value={categoryProvenanceLabel(product.categoryProvenance)} />
        <FactRow label="Serving form" value={product.serving.form} />
      </dl>
    </section>
  );
}

function ObservedFacts({ product }: { product: PublicProductDto }) {
  const caffeine = caffeinePresentation(product.caffeine);
  const serving = product.serving.value === null
    ? fieldStateLabel(product.serving.state)
    : `${formatPassportNumber(product.serving.value)} ${servingUnit(product.serving.unit)}`;
  const normalized = product.serving.normalizedMl === null
    ? fieldStateLabel(product.serving.state)
    : `${formatPassportNumber(product.serving.normalizedMl)} ml`;
  const concentration = product.concentration.mgPer100Ml === null
    ? "Not eligible"
    : `${formatPassportNumber(product.concentration.mgPer100Ml)} mg / 100 ml`;
  const calories = product.calories?.kcal === null || product.calories === undefined
    ? product.calories ? fieldStateLabel(product.calories.state) : "Not available in public response"
    : `${formatPassportNumber(product.calories.kcal)} kcal`;
  const sugar = product.sugar?.g === null || product.sugar === undefined
    ? product.sugar ? fieldStateLabel(product.sugar.state) : "Not available in public response"
    : `${formatPassportNumber(product.sugar.g)} g`;

  return (
    <section className={styles.evidenceColumn} aria-labelledby="observed-facts-heading" data-evidence-column>
      <h2 id="observed-facts-heading">Observed facts</h2>
      <dl>
        <FactRow label="Total caffeine" state={caffeine.stateLabel} value={`${caffeine.value}${caffeine.unit ? ` ${caffeine.unit}` : ""}`} />
        <FactRow label="Serving size" state={product.serving.form} value={serving} />
        <FactRow label="Serving size (normalized)" value={normalized} />
        <FactRow label="Concentration" value={concentration} />
        <FactRow label="Calories" state={product.calories ? fieldStateLabel(product.calories.state) : undefined} value={calories} />
        <FactRow label="Sugar" state={product.sugar ? fieldStateLabel(product.sugar.state) : undefined} value={sugar} />
      </dl>
    </section>
  );
}

function SourceRecord({ product }: { product: PublicProductDto }) {
  return (
    <section className={styles.evidenceColumn} aria-labelledby="source-record-heading" data-evidence-column>
      <h2 id="source-record-heading">Source record</h2>
      <dl>
        <FactRow label="Source" value={product.sourceAttribution} />
        <FactRow label="Published level" value={sourceLevelLabel(product.caffeine.sourceLevel)} />
        <FactRow label="Observed" value={formatObservedAt(product.observedAt)} />
      </dl>
      <a className={styles.sourceLink} href={product.sourceUrl} rel="noreferrer noopener" target="_blank">
        <span>{product.sourceAttribution}</span>
        <ExternalLink aria-hidden="true" size={15} />
        <span className="sr-only"> source page (opens in a new tab)</span>
      </a>
    </section>
  );
}

function RankingEligibility({ product }: { product: PublicProductDto }) {
  const reasons = product.rankingEligibility.reasons.map(rankingReasonLabel);
  return (
    <section className={styles.evidenceColumn} aria-labelledby="ranking-heading" data-evidence-column>
      <h2 id="ranking-heading">Ranking eligibility</h2>
      <div className={styles.eligibilityRow} data-eligible={product.rankingEligibility.totalCaffeine}>
        {product.rankingEligibility.totalCaffeine ? <BadgeCheck aria-hidden="true" /> : <CircleOff aria-hidden="true" />}
        <span>{product.rankingEligibility.totalCaffeine ? "Eligible" : "Not eligible"} for total-caffeine ranking</span>
      </div>
      <div className={styles.eligibilityRow} data-eligible={product.rankingEligibility.concentration}>
        {product.rankingEligibility.concentration ? <BadgeCheck aria-hidden="true" /> : <CircleOff aria-hidden="true" />}
        <span>{product.rankingEligibility.concentration ? "Eligible" : "Not eligible"} for concentration ranking</span>
      </div>
      <p className={styles.eligibilityNote}>
        Concentration ranking requires exact caffeine and a positive serving normalized to milliliters.
      </p>
      {reasons.length > 0 ? (
        <ul className={styles.reasonList}>{reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul>
      ) : null}
    </section>
  );
}

const LEGEND_ITEMS = [
  { icon: BadgeCheck, label: "Exact value", state: "exact" },
  { icon: CircleOff, label: "Explicit zero", state: "explicit-zero" },
  { icon: Brackets, label: "Range", state: "range" },
  { icon: Waves, label: "Estimated", state: "estimated" },
  { icon: TriangleAlert, label: "Conflicting", state: "conflicting" },
  { icon: CircleHelp, label: "Unparseable", state: "unparseable" },
  { icon: MinusCircle, label: "Not published", state: "not-published" },
] as const;

function DataStateLegend() {
  return (
    <section aria-labelledby="data-state-heading" className={`${styles.instrumentPanel} ${styles.stateLegend}`}>
      <h2 id="data-state-heading">Data state legend</h2>
      <ul>
        {LEGEND_ITEMS.map(({ icon: Icon, label, state }) => (
          <li data-state={state} key={state}><Icon aria-hidden="true" /><span>{label}</span></li>
        ))}
      </ul>
    </section>
  );
}

function Variations({ names }: { names: string[] }) {
  if (names.length === 0) return null;
  return (
    <section className={`${styles.instrumentPanel} ${styles.variations}`}>
      <h2>Listed variations</h2>
      <p>Observed names only; no additional measurements are inferred.</p>
      <ul>{names.map((name) => <li key={name}>{name}</li>)}</ul>
    </section>
  );
}

export function ProductPassport({
  fontClassName,
  product,
  variations,
}: ProductPassportProps) {
  const style = {
    "--passport-accent": product.caffeine.state === "present" ? "#25d8f5" : "#f2a93b",
  } as CSSProperties;

  return (
    <div className={`${styles.root} ${fontClassName} pr-app`} style={style}>
      <a className={styles.skipLink} href="#product-passport-main">Skip to product passport</a>
      <PublicHeader />
      <ProductViewTracker product={product} />
      <main className={styles.main} id="product-passport-main">
        <Link className={styles.backLink} href="/explore">← Explore trusted products</Link>
        <div className={styles.instrument}>
          <ProductBay product={product} />
          <div className={styles.measurementStack}>
            <CaffeinePanel product={product} />
            <MetricStrip product={product} />
          </div>
          <SugarVessel product={product} />
          <LocalActionRail product={product} />
        </div>
        <div className={`${styles.instrumentPanel} ${styles.evidenceDeck}`}>
          <ProductMetadata product={product} />
          <ObservedFacts product={product} />
          <SourceRecord product={product} />
          <RankingEligibility product={product} />
        </div>
        <DataStateLegend />
        <Variations names={variations} />
      </main>
    </div>
  );
}
