import Image from "next/image";

import { ActionDock } from "./action-dock";
import { PRODUCT } from "./prototype-data";
import styles from "./prototype.module.css";

export function OrbitInstrument() {
  return (
    <div className={`${styles.variant} ${styles.orbitVariant}`}>
      <header className={styles.orbitNav}>
        <div className={styles.protoBrand}><span aria-hidden="true" className={styles.brandMark} /> PulseRank</div>
        <nav aria-label="Prototype navigation"><a href="#explore">Explore</a><a href="#leaderboards">Leaderboards</a><a href="#compare">Compare</a><a href="#my-pulse">My Pulse</a></nav>
        <span>TRUSTED DATA / DARK MODE</span>
      </header>

      <div className={styles.orbitMain}>
        <div className={styles.orbitIntro}><span className={styles.orbitLabel}>PRODUCT PASSPORT</span><h1>{PRODUCT.name}</h1><p>One observed record. Every qualifier stays attached.</p></div>
        <section className={styles.orbitHero}>
          <div className={styles.orbitIdentity}><div className={styles.orbitImageFrame}><Image alt={`${PRODUCT.name} product packaging`} className={styles.productImage} fill priority sizes="(max-width: 760px) 280px, 330px" src="/api/public/product-images/mega-monster-energy-drink" unoptimized /></div><span className={styles.orbitImageCaption}>ENERGY DRINK · SOURCE CATEGORY LIST</span></div>
          <div className={styles.orbitCaffeine}><div className={styles.orbitRing} aria-hidden="true"><span /><span /><span /></div><div className={styles.orbitNumber}><span className={styles.orbitLabel}>TOTAL CAFFEINE · EXACT VALUE</span><strong>240</strong><em>mg</em><p>per 709 ml serving</p></div></div>
          <div className={styles.orbitSide}><div><span className={styles.orbitLabel}>SUGAR</span><strong>81 g</strong><small>published · per serving</small></div><div className={styles.orbitSideRule} /><div><span className={styles.orbitLabel}>CONCENTRATION</span><strong>33.9</strong><small>mg / 100 ml</small></div><ActionDock compact /></div>
        </section>

        <section aria-label="Product evidence" className={styles.orbitDossier}>
          <div className={styles.orbitMetaColumn}><span className={styles.orbitLabel}>PRODUCT METADATA</span><h2>Field identity</h2><dl><div><dt>Category</dt><dd>{PRODUCT.category}</dd></div><div><dt>Product type</dt><dd>{PRODUCT.productType}</dd></div><div><dt>Serving</dt><dd>{PRODUCT.serving} · {PRODUCT.servingForm}</dd></div></dl></div>
          <div><span className={styles.orbitLabel}>OBSERVED FACTS</span><div className={styles.orbitFact}><strong>{PRODUCT.normalized}</strong><span>normalized volume</span></div><div className={styles.orbitFact}><strong>{PRODUCT.calories}</strong><span>published calories</span></div></div>
          <div><span className={styles.orbitLabel}>SOURCE RECORD</span><dl><div><dt>Source</dt><dd>{PRODUCT.source}</dd></div><div><dt>Observed</dt><dd>{PRODUCT.observed}</dd></div></dl></div>
          <div><span className={styles.orbitLabel}>RANKING ELIGIBILITY</span><p className={styles.orbitEligible}><span aria-hidden="true" className={styles.statusDot} />Total caffeine</p><p className={styles.orbitEligible}><span aria-hidden="true" className={styles.statusDot} />Concentration</p><small>Exact caffeine and positive normalized milliliters are present.</small></div>
        </section>
      </div>
    </div>
  );
}
