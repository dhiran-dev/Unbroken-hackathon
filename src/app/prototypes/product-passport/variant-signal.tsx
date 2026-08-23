import Image from "next/image";

import { ActionDock } from "./action-dock";
import { PRODUCT } from "./prototype-data";
import styles from "./prototype.module.css";

function ProductImage({ className }: { className?: string }) {
  return (
    <div className={`${styles.productImageFrame} ${className ?? ""}`}>
      <span aria-hidden="true" className={styles.imageCrosshair} />
      <Image
        alt={`${PRODUCT.name} product packaging`}
        className={styles.productImage}
        fill
        priority
        sizes="(max-width: 760px) calc(100vw - 48px), 360px"
        src="/api/public/product-images/mega-monster-energy-drink"
        unoptimized
      />
    </div>
  );
}

export function SignalConsole() {
  return (
    <div className={`${styles.variant} ${styles.signalVariant}`}>
      <header className={styles.signalNav}>
        <div className={styles.protoBrand}><span aria-hidden="true" className={styles.brandMark} /> PulseRank</div>
        <span className={styles.navContext}>PUBLIC PRODUCT PASSPORT / 01</span>
        <nav aria-label="Prototype navigation"><a href="#explore">Explore</a><a href="#leaderboards">Leaderboards</a><a href="#compare">Compare</a><a href="#my-pulse">My Pulse</a></nav>
      </header>

      <div className={styles.signalHero}>
        <section aria-label="Product artwork" className={`${styles.signalCell} ${styles.signalSpecimen}`}>
          <span className={styles.cellLabel}>SPECIMEN</span>
          <ProductImage />
          <div className={styles.specimenCaption}><span>MEGA / ENERGY</span><span>IMAGE · AUTHORIZED ROUTE</span></div>
        </section>

        <section aria-labelledby="signal-caffeine-heading" className={`${styles.signalCell} ${styles.signalReadout}`}>
          <div className={styles.readoutTop}><span className={styles.cellLabel}>TOTAL CAFFEINE</span><span className={styles.statePill}>EXACT VALUE</span></div>
          <div className={styles.signalNumber}><strong id="signal-caffeine-heading">240</strong><span>mg</span></div>
          <div className={styles.readoutRule}><span /> observed total · per 709 ml serving</div>
          <div className={styles.signalMetrics}>
            <div><span>CONCENTRATION</span><strong>33.9</strong><small>mg / 100 ml</small></div>
            <div><span>NORMALIZED</span><strong>709</strong><small>ml</small></div>
            <div><span>CALORIES</span><strong>320</strong><small>kcal · published</small></div>
          </div>
        </section>

        <section aria-labelledby="signal-sugar-heading" className={`${styles.signalCell} ${styles.signalSugar}`}>
          <span className={styles.cellLabel}>SUGAR MEASURE</span>
          <div className={styles.sugarValue}><strong id="signal-sugar-heading">81</strong><span>g</span></div>
          <p>per 709 ml serving</p>
          <div className={styles.sugarBar} aria-label="81 grams of published sugar on a 100 gram scale" role="img"><span /></div>
          <div className={styles.sugarTicks}><span>0</span><span>50</span><span>100 g</span></div>
          <small>Measurement scale, not a recommended limit.</small>
        </section>

        <ActionDock />
      </div>

      <section aria-label="Product evidence" className={styles.signalDossier}>
        <div className={styles.dossierColumn}>
          <span className={styles.dossierLabel}>PRODUCT METADATA</span>
          <h1>{PRODUCT.name}</h1>
          <dl><div><dt>Category</dt><dd>{PRODUCT.category}</dd></div><div><dt>Product type</dt><dd>{PRODUCT.productType}</dd></div><div><dt>Serving form</dt><dd>{PRODUCT.servingForm}</dd></div></dl>
        </div>
        <div className={styles.dossierColumn}>
          <span className={styles.dossierLabel}>OBSERVED FACTS</span>
          <dl><div><dt>Caffeine</dt><dd>{PRODUCT.caffeine} <small>{PRODUCT.caffeineState}</small></dd></div><div><dt>Serving</dt><dd>{PRODUCT.serving}</dd></div><div><dt>Normalized</dt><dd>{PRODUCT.normalized}</dd></div><div><dt>Sugar</dt><dd>{PRODUCT.sugar}</dd></div></dl>
        </div>
        <div className={styles.dossierColumn}>
          <span className={styles.dossierLabel}>SOURCE RECORD</span>
          <dl><div><dt>Source</dt><dd>{PRODUCT.source}</dd></div><div><dt>Observed</dt><dd>{PRODUCT.observed}</dd></div><div><dt>Published level</dt><dd>Extreme</dd></div></dl>
        </div>
        <div className={styles.dossierColumn}>
          <span className={styles.dossierLabel}>RANKING ELIGIBILITY</span>
          <p className={styles.eligibilityGood}><span aria-hidden="true" className={styles.statusDot} />Eligible for total-caffeine ranking</p>
          <p className={styles.eligibilityGood}><span aria-hidden="true" className={styles.statusDot} />Eligible for concentration ranking</p>
          <small>Exact caffeine + positive serving normalized to milliliters.</small>
        </div>
      </section>
    </div>
  );
}
