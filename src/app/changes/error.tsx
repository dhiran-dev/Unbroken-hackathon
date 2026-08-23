"use client";

import Link from "next/link";
import { AlertTriangle, RefreshCw } from "lucide-react";

import styles from "@/components/pulserank/changes/changes.module.css";

export default function ChangesError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className={styles.errorSurface} aria-labelledby="changes-error-title">
      <section className={styles.errorState} role="alert">
        <div className={styles.emptyIcon} aria-hidden="true"><AlertTriangle size={21} /></div>
        <div>
          <h1 id="changes-error-title">Changes are temporarily unavailable</h1>
          <p>The trusted change ledger could not be read right now. No event or source detail has been invented.</p>
          <div className={styles.errorActions}>
            <button type="button" className={styles.heroAction} onClick={reset}><RefreshCw size={15} aria-hidden="true" /> Try again</button>
            <Link href="/live-data" className={styles.textLink}>Check trust status</Link>
          </div>
        </div>
      </section>
    </main>
  );
}
