import Image from "next/image";

import { ActionDock } from "./action-dock";
import { PRODUCT } from "./prototype-data";
import styles from "./prototype.module.css";

export function EvidenceIndex() {
  return (
    <div className={`${styles.variant} ${styles.indexVariant}`}>
      <header className={styles.indexNav}>
        <div className={styles.protoBrand}><span aria-hidden="true" className={styles.brandMark} /> PulseRank</div>
        <div className={styles.indexNavRule} />
        <span>PRODUCT PASSPORT / TRUSTED OBSERVATION</span>
        <nav aria-label="Prototype navigation"><a href="#explore">Explore</a><a href="#compare">Compare</a><a href="#my-pulse">My Pulse</a></nav>
      </header>

      <div className={styles.indexMain}>
        <div className={styles.indexKicker}><span>01</span><span>CAFFEINE INFORMER · OBSERVED 22 AUG 2026</span><span>EXACT</span></div>
        <div className={styles.indexTitleRow}><h1>{PRODUCT.name}</h1><ActionDock compact /></div>

        <section className={styles.indexHero}>
          <div className={styles.indexImagePanel}>
            <div className={styles.indexImageMeta}><span>PRODUCT IMAGE</span><span>01 / 01</span></div>
            <div className={styles.indexImageFrame}><Image alt={`${PRODUCT.name} product packaging`} className={styles.productImage} fill priority sizes="(max-width: 760px) 100vw, 440px" src="/api/public/product-images/mega-monster-energy-drink" unoptimized /></div>
            <p>Authorized image route · image is illustrative product identification, not evidence for any metric.</p>
          </div>
          <div className={styles.indexReadoutPanel}>
            <div className={styles.indexPrimary}><span className={styles.indexLabel}>TOTAL CAFFEINE</span><div><strong>240</strong><em>mg</em></div><p>Observed total · per 709 ml serving</p></div>
            <div className={styles.indexMetricGrid}><div><span>Serving</span><strong>709 ml</strong><small>drink</small></div><div><span>Normalized</span><strong>709 ml</strong><small>positive volume</small></div><div><span>Concentration</span><strong>33.9</strong><small>mg / 100 ml</small></div><div><span>Sugar</span><strong>81 g</strong><small>published</small></div></div>
            <div className={styles.indexSugarBand}><span className={styles.indexLabel}>SUGAR MEASURE</span><strong>81 g</strong><div aria-label="81 grams of published sugar on a 100 gram scale" className={styles.sugarBar} role="img"><span /></div><small>Adaptive 100 g scale · not a recommended limit.</small></div>
          </div>
        </section>

        <section aria-label="Product evidence" className={styles.indexDossier}>
          <div className={styles.indexMetaColumn}><span className={styles.indexLabel}>PRODUCT METADATA</span><dl><div><dt>Category</dt><dd>{PRODUCT.category}</dd></div><div><dt>Product type</dt><dd>{PRODUCT.productType}</dd></div><div><dt>Serving form</dt><dd>{PRODUCT.servingForm}</dd></div></dl></div>
          <div><span className={styles.indexLabel}>OBSERVED FACTS</span><dl><div><dt>Caffeine</dt><dd>{PRODUCT.caffeine}</dd></div><div><dt>Calories</dt><dd>{PRODUCT.calories}</dd></div><div><dt>State</dt><dd>{PRODUCT.caffeineState}</dd></div></dl></div>
          <div><span className={styles.indexLabel}>SOURCE RECORD</span><dl><div><dt>Source</dt><dd>{PRODUCT.source}</dd></div><div><dt>Observed</dt><dd>{PRODUCT.observed}</dd></div></dl></div>
          <div><span className={styles.indexLabel}>RANKING ELIGIBILITY</span><p className={styles.indexEligible}><span aria-hidden="true" className={styles.statusDot} />Total caffeine</p><p className={styles.indexEligible}><span aria-hidden="true" className={styles.statusDot} />Concentration</p><small>Eligibility reflects data completeness, not quality or health.</small></div>
        </section>
      </div>
    </div>
  );
}
