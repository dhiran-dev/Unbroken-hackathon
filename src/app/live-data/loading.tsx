import styles from "@/components/pulserank/live-data/live-data.module.css";
import { PulseLogo } from "@/components/pulserank/pulse-logo";

export default function LiveDataLoading() {
  return (
    <div className={styles.page} aria-busy="true" aria-live="polite">
      <aside className={styles.sidebar} aria-hidden="true">
        <div className={styles.brand}><span className={styles.brandGlyph}><PulseLogo size={31} /></span><span>PulseRank</span></div>
      </aside>
      <main className={styles.main}>
        <p className={styles.panelSubhead}>Loading live data…</p>
      </main>
    </div>
  );
}
