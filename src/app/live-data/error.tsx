"use client";

import Link from "next/link";
import { AlertCircle, RefreshCw } from "lucide-react";

import styles from "@/components/pulserank/live-data/live-data.module.css";

export default function LiveDataError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className={styles.page}>
      <main className={styles.main}>
        <section className={styles.panel} aria-labelledby="live-data-error-title">
          <div className={styles.emptyInline}>
            <AlertCircle aria-hidden="true" size={22} />
            <div>
              <h1 id="live-data-error-title">Live data is temporarily unavailable.</h1>
              <p>PulseRank could not read the public operational counters. No data has been inferred.</p>
            </div>
          </div>
          <div className={styles.headerActions}>
            <button className={styles.refreshButton} type="button" onClick={reset} aria-label="Try loading live data again">
              <RefreshCw aria-hidden="true" size={19} />
            </button>
            <Link className={styles.panelLink} href="/">Return to PulseRank home</Link>
          </div>
        </section>
      </main>
    </div>
  );
}
