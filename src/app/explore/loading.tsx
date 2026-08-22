import { PublicHeader } from "@/components/pulserank/public-ui";

import styles from "./explore.module.css";

export default function ExploreLoading() {
  return (
    <div className={`${styles.exploreRoot} pr-app`}>
      <PublicHeader active="/explore" />
      <main aria-busy="true" aria-label="Loading the trusted product catalog" className={`${styles.main} ${styles.loadingState}`}>
        <span className="sr-only" role="status">Loading the trusted product catalog</span>
        <div className={styles.loadingRail} />
        <div className={styles.loadingCenter}>
          <span />
          <span />
          <span />
        </div>
        <div className={styles.loadingInspector} />
      </main>
    </div>
  );
}
