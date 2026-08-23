"use client";

import Image from "next/image";
import Link from "next/link";
import {
  ArrowDownRight,
  Check,
  Database,
  ExternalLink,
  Fingerprint,
  Leaf,
  ShieldCheck,
  Sparkles,
  Zap,
} from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";

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
import { Card } from "@/components/ui/card";
import type { PublicProductDto } from "@/server/products/dto";

import {
  CardBody,
  CardContainer,
  CardItem,
  HoverBorderGradient,
  LayoutGrid,
  type LayoutGridCard,
} from "./components/aceternity";
import { SmoothCursor } from "./components/smooth-cursor";
import { LiquidMetalButton, LivingGreenScene } from "./components/threeui";
import styles from "./prototype.module.css";

const VARIANTS = [
  { id: "grotto", label: "Violet Grotto", note: "The roll" },
  { id: "conservatory", label: "Night Conservatory", note: "Spatial" },
  { id: "herbarium", label: "Herbarium Ledger", note: "Editorial" },
] as const;

type Variant = (typeof VARIANTS)[number]["id"];

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

function ProductSpecimen({
  product,
  label,
}: {
  product: PublicProductDto;
  label: string;
}) {
  const [failed, setFailed] = useState(false);
  const initials = product.name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();

  return (
    <CardContainer
      containerClassName={styles.specimenPerspective}
      className={styles.specimenTilt}
    >
      <CardBody className={styles.specimenBody}>
        <CardItem className={styles.specimenAura} translateZ={-35} />
        <CardItem className={styles.specimenHalo} translateZ={14} />
        <CardItem className={styles.specimenImage} translateY={-5} translateZ={74}>
          {product.image !== null && !failed ? (
            <Image
              alt={`${product.name} product packaging`}
              fill
              onError={() => setFailed(true)}
              priority
              sizes="(max-width: 760px) 78vw, 46vw"
              src={`/api/public/product-images/${encodeURIComponent(product.slug)}`}
              unoptimized
            />
          ) : (
            <div
              aria-label={`Procedural fallback artwork for ${product.name}`}
              className={styles.specimenFallback}
              role="img"
            >
              <Zap aria-hidden="true" />
              <strong>{initials || "PR"}</strong>
            </div>
          )}
        </CardItem>
        <CardItem className={styles.specimenLabel} translateY={6} translateZ={44}>
          <span>{label}</span>
          <strong>{product.name}</strong>
        </CardItem>
      </CardBody>
    </CardContainer>
  );
}

function ProductWordmark() {
  return (
    <Link aria-label="PulseRank home" className={styles.wordmark} href="/">
      <span><Zap aria-hidden="true" /></span>
      <strong>PulseRank</strong>
      <small>Product intelligence</small>
    </Link>
  );
}

function VariantSwitcher({
  active,
  onChange,
}: {
  active: Variant;
  onChange: (variant: Variant) => void;
}) {
  return (
    <nav aria-label="Product Passport prototype variants" className={styles.switcher}>
      {VARIANTS.map((variant) => (
        <Button
          aria-current={active === variant.id ? "page" : undefined}
          className={styles.switcherButton}
          data-active={active === variant.id ? "true" : "false"}
          key={variant.id}
          onClick={() => onChange(variant.id)}
          size="sm"
          variant="ghost"
        >
          <span>{variant.note}</span>
          {variant.label}
        </Button>
      ))}
    </nav>
  );
}

function ActionPair({ product }: { product: PublicProductDto }) {
  return (
    <div className={styles.actions}>
      <LiquidMetalButton
        className={styles.liquidAction}
        onClick={() => { if (product.sourceUrl) window.open(product.sourceUrl, "_blank", "noopener,noreferrer"); }}
        text={product.sourceUrl ? "Open source record" : "Source unavailable"}
      />
      <HoverBorderGradient
        aria-label="Jump to evidence details"
        className={styles.gradientActionInner}
        containerClassName={styles.gradientAction}
        onClick={() => document.querySelector("#passport-evidence")?.scrollIntoView({ behavior: "smooth" })}
      >
        <Fingerprint aria-hidden="true" />
        Trace evidence
        <ArrowDownRight aria-hidden="true" />
      </HoverBorderGradient>
    </div>
  );
}

function CaffeineReadout({ product }: { product: PublicProductDto }) {
  const caffeine = caffeinePresentation(product.caffeine);
  const serving = product.serving.value === null
    ? "Serving not published"
    : `per ${formatPassportNumber(product.serving.value)} ${servingUnit(product.serving.unit)} serving`;

  return (
    <div className={styles.caffeineReadout} data-state={caffeine.state}>
      <div className={styles.readoutTopline}>
        <span>Total caffeine</span>
        <Badge className={styles.stateBadge}>
          <Check aria-hidden="true" />
          {caffeine.stateLabel}
        </Badge>
      </div>
      <div className={styles.caffeineValue}>
        <strong>{caffeine.value}</strong>
        {caffeine.unit ? <em>{caffeine.unit}</em> : null}
      </div>
      <p>{serving}</p>
      <div aria-hidden="true" className={styles.emissionRail}>
        {Array.from({ length: 18 }, (_, index) => (
          <i data-active={index < 12 ? "true" : "false"} key={index} />
        ))}
      </div>
    </div>
  );
}

function QuickFacts({ product }: { product: PublicProductDto }) {
  const facts = [
    {
      label: "Normalized",
      value: product.serving.normalizedMl === null
        ? fieldStateLabel(product.serving.state)
        : `${formatPassportNumber(product.serving.normalizedMl)} ml`,
    },
    {
      label: "Concentration",
      value: product.concentration.mgPer100Ml === null
        ? "Not eligible"
        : `${formatPassportNumber(product.concentration.mgPer100Ml)} mg / 100 ml`,
    },
    {
      label: "Sugar",
      value: product.sugar?.g === null || product.sugar === undefined
        ? product.sugar ? fieldStateLabel(product.sugar.state) : "Not available"
        : `${formatPassportNumber(product.sugar.g)} g`,
    },
  ];

  return (
    <dl className={styles.quickFacts}>
      {facts.map((fact) => (
        <div key={fact.label}>
          <dt>{fact.label}</dt>
          <dd>{fact.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function GrottoHero({ product }: { product: PublicProductDto }) {
  return (
    <section aria-labelledby="grotto-title" className={`${styles.hero} ${styles.grottoHero}`}>
      <div className={styles.grottoForest}>
        <LivingGreenScene className={styles.forestScene} />
        <div aria-hidden="true" className={styles.violetRefraction} />
        <ProductSpecimen label="Trusted specimen · 01" product={product} />
        <div className={styles.forestCaption}>
          <Leaf aria-hidden="true" />
          <span>Living source field</span>
          <small>Pointer-responsive · reduced-motion safe</small>
        </div>
      </div>
      <div className={styles.grottoCopy}>
        <p className={styles.eyebrow}>Product passport · trusted observation</p>
        <h1 id="grotto-title">
          {product.name.split(" Energy Drink")[0]}
          <span> Energy Drink</span>
        </h1>
        <p className={styles.lede}>
          A source-backed field record for one published serving. Every value keeps its observed state and ranking eligibility.
        </p>
        <Card className={styles.glassReadout}>
          <CaffeineReadout product={product} />
          <QuickFacts product={product} />
        </Card>
        <ActionPair product={product} />
      </div>
    </section>
  );
}

function ConservatoryHero({ product }: { product: PublicProductDto }) {
  const caffeine = caffeinePresentation(product.caffeine);
  return (
    <section aria-labelledby="conservatory-title" className={`${styles.hero} ${styles.conservatoryHero}`}>
      <LivingGreenScene className={styles.conservatoryScene} />
      <div aria-hidden="true" className={styles.conservatoryGlass} />
      <div className={styles.conservatoryHeading}>
        <p className={styles.eyebrow}>Night conservatory · specimen 01</p>
        <h1 id="conservatory-title">{product.name}</h1>
        <div className={styles.conservatoryTags}>
          <Badge className={styles.stateBadge}><Sparkles aria-hidden="true" />Verified DTO</Badge>
          <Badge className={styles.stateBadge}><Leaf aria-hidden="true" />{categoryLabel(product.category)}</Badge>
        </div>
      </div>
      <div className={styles.conservatorySpecimen}>
        <ProductSpecimen label="Mega Monster · source specimen" product={product} />
      </div>
      <Card className={styles.conservatoryReadout}>
        <span className={styles.orbitLabel}>Exact caffeine</span>
        <strong>{caffeine.value}</strong>
        <em>{caffeine.unit}</em>
        <p>per {formatPassportNumber(product.serving.value ?? 0)} {servingUnit(product.serving.unit)} serving</p>
        <QuickFacts product={product} />
      </Card>
      <div className={styles.conservatoryActions}>
        <ActionPair product={product} />
      </div>
    </section>
  );
}

function HerbariumHero({ product }: { product: PublicProductDto }) {
  return (
    <section aria-labelledby="herbarium-title" className={`${styles.hero} ${styles.herbariumHero}`}>
      <div className={styles.herbariumLedger}>
        <p className={styles.eyebrow}>Herbarium record · PR–MM–709</p>
        <div className={styles.ledgerIndex}><span>01</span><i /><small>Trusted product observation</small></div>
        <h1 id="herbarium-title">{product.name}</h1>
        <p className={styles.lede}>
          A botanical-style evidence plate for caffeine intelligence: source, specimen, measurement, and eligibility remain inspectable.
        </p>
        <CaffeineReadout product={product} />
        <ActionPair product={product} />
      </div>
      <div className={styles.herbariumForest}>
        <LivingGreenScene className={styles.forestScene} />
        <div aria-hidden="true" className={styles.violetRefraction} />
        <ProductSpecimen label="Filed 22 Aug 2026 · UTC" product={product} />
        <QuickFacts product={product} />
      </div>
    </section>
  );
}

function RecordRows({ rows }: { rows: Array<[string, ReactNode]> }) {
  return (
    <dl className={styles.recordRows}>
      {rows.map(([label, value]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function EvidenceGrid({ product, variant }: { product: PublicProductDto; variant: Variant }) {
  const caffeine = caffeinePresentation(product.caffeine);
  const calories = product.calories?.kcal === null || product.calories === undefined
    ? product.calories ? fieldStateLabel(product.calories.state) : "Not in public response"
    : `${formatPassportNumber(product.calories.kcal)} kcal`;
  const sugar = product.sugar?.g === null || product.sugar === undefined
    ? product.sugar ? fieldStateLabel(product.sugar.state) : "Not in public response"
    : `${formatPassportNumber(product.sugar.g)} g`;
  const eligibilityReasons = product.rankingEligibility.reasons.length === 0
    ? "No exclusion reasons"
    : product.rankingEligibility.reasons.map(rankingReasonLabel).join(" ");

  const cards: LayoutGridCard[] = [
    {
      id: "metadata",
      eyebrow: "01 · Specimen",
      title: "Product metadata",
      summary: `${categoryLabel(product.category)} · ${formatPassportNumber(product.serving.value ?? 0)} ${servingUnit(product.serving.unit)}`,
      content: (
        <RecordRows rows={[
          ["Product", product.name],
          ["Category", categoryLabel(product.category)],
          ["Category provenance", categoryProvenanceLabel(product.categoryProvenance)],
          ["Serving context", product.serving.value === null ? fieldStateLabel(product.serving.state) : `${formatPassportNumber(product.serving.value)} ${servingUnit(product.serving.unit)}`],
          ["Serving form", product.serving.form],
        ]} />
      ),
    },
    {
      id: "facts",
      eyebrow: "02 · Measure",
      title: "Observed facts",
      summary: `${caffeine.value} ${caffeine.unit ?? ""} · ${sugar}`,
      content: (
        <RecordRows rows={[
          ["Caffeine", `${caffeine.value}${caffeine.unit ? ` ${caffeine.unit}` : ""} · ${caffeine.stateLabel}`],
          ["Source level", sourceLevelLabel(product.caffeine.sourceLevel)],
          ["Normalized volume", product.serving.normalizedMl === null ? fieldStateLabel(product.serving.state) : `${formatPassportNumber(product.serving.normalizedMl)} ml`],
          ["Concentration", product.concentration.mgPer100Ml === null ? "Not eligible" : `${formatPassportNumber(product.concentration.mgPer100Ml)} mg / 100 ml`],
          ["Calories", calories],
          ["Sugar", sugar],
        ]} />
      ),
    },
    {
      id: "source",
      eyebrow: "03 · Provenance",
      title: "Source record",
      summary: product.sourceAttribution,
      content: (
        <RecordRows rows={[
          ["Source", product.sourceAttribution],
          ["Observed", formatObservedAt(product.observedAt)],
          ["Attribution", "Product facts and image source retained"],
          ["Publication", "Trusted observation only"],
        ]} />
      ),
    },
    {
      id: "ranking",
      eyebrow: "04 · Eligibility",
      title: "Ranking eligibility",
      summary: product.rankingEligibility.totalCaffeine && product.rankingEligibility.concentration ? "Eligible on both boards" : "Eligibility varies",
      content: (
        <RecordRows rows={[
          ["Total caffeine", product.rankingEligibility.totalCaffeine ? "Eligible" : "Excluded"],
          ["Concentration", product.rankingEligibility.concentration ? "Eligible" : "Excluded"],
          ["Reason", eligibilityReasons],
          ["Interpretation", "Ranking status, not health guidance"],
        ]} />
      ),
    },
  ];

  return (
    <section className={styles.evidence} id="passport-evidence">
      <div className={styles.evidenceHeading}>
        <div>
          <p className={styles.eyebrow}>Evidence architecture</p>
          <h2>Four records. One trusted observation.</h2>
        </div>
        <p>
          The field grid replaces the old column strip. Open any record for the full field-level trace.
        </p>
      </div>
      <LayoutGrid
        cards={cards}
        className={`${styles.layoutGrid} ${styles[`layoutGrid_${variant}`]}`}
        itemClassName={styles.layoutGridCard}
      />
    </section>
  );
}

export function LivingProductPassport({
  fontClassName,
  initialVariant,
  product,
}: {
  fontClassName: string;
  initialVariant: Variant;
  product: PublicProductDto;
}) {
  const [variant, setVariant] = useState<Variant>(initialVariant);
  const activeVariant = useMemo(
    () => VARIANTS.find((entry) => entry.id === variant) ?? VARIANTS[0],
    [variant],
  );

  function changeVariant(nextVariant: Variant) {
    setVariant(nextVariant);
    const url = new URL(window.location.href);
    url.searchParams.set("variant", nextVariant);
    window.history.replaceState(null, "", url);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  return (
    <main className={`${styles.page} ${fontClassName}`} data-variant={variant}>
      <SmoothCursor className={styles.smoothCursor} />
      <header className={styles.header}>
        <ProductWordmark />
        <div className={styles.headerRecord}>
          <span>Prototype · living passport</span>
          <strong>{activeVariant.label}</strong>
        </div>
        <VariantSwitcher active={variant} onChange={changeVariant} />
      </header>

      {variant === "grotto" ? <GrottoHero product={product} /> : null}
      {variant === "conservatory" ? <ConservatoryHero product={product} /> : null}
      {variant === "herbarium" ? <HerbariumHero product={product} /> : null}

      <EvidenceGrid product={product} variant={variant} />

      <footer className={styles.footer}>
        <div><ShieldCheck aria-hidden="true" /><span>Trusted DTO</span></div>
        <div><Database aria-hidden="true" /><span>Source-observed 22 Aug 2026</span></div>
        {product.sourceUrl ? <a href={product.sourceUrl} rel="noreferrer" target="_blank">
          {product.sourceAttribution}
          <ExternalLink aria-hidden="true" />
        </a> : <span>Source URL not published</span>}
        <span>Procedural scene · reduced-motion supported</span>
      </footer>
    </main>
  );
}
