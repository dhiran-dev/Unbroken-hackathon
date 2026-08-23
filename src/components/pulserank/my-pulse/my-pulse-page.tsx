"use client";

import Link from "next/link";
import {
  Activity,
  ArrowRight,
  BarChart3,
  BookOpen,
  Bookmark,
  CalendarClock,
  ChevronRight,
  CircleHelp,
  Clock3,
  Database,
  Download,
  Folder,
  Gamepad2,
  Gauge,
  GitCompareArrows,
  Home,
  Info,
  LockKeyhole,
  Menu,
  RefreshCw,
  Search,
  Settings2,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import type { PublicProductDto } from "@/server/products/dto";
import { PublishedProductImage } from "@/components/pulserank/product-image";
import {
  clearCompare,
  getCompareSlugs,
} from "@/lib/local-state/compare";
import { exportAll, importAll } from "@/lib/local-state/export-import";
import {
  clearPreferences,
  DEFAULT_PREFERENCES,
  loadPreferences,
  updatePreferences,
  type PulsePreferences,
} from "@/lib/local-state/preferences";
import {
  clearMyDay,
  listMyDayRecordsForDate,
  type MyDayRecord,
  utcDateKey,
} from "@/lib/local-state/my-day";
import {
  clearRecentlyViewed,
  listRecentlyViewed,
  type RecentlyViewedRecord,
} from "@/lib/local-state/recently-viewed";
import {
  clearSavedProducts,
  listSavedProducts,
  type StoredSavedProduct,
} from "@/lib/local-state/saved-products";
import { inspectLocalStorage, type BrowserStorageStatus } from "@/lib/local-state/storage";
import { inspectIndexedDb, type IndexedDbStatus } from "@/lib/local-state/db";
import { PULSERANK_LOCAL_STATE_VERSION } from "@/lib/local-state/keys";
import { categoryLabel, formatNumber } from "@/components/pulserank/public-ui";
import { PulseLogo } from "@/components/pulserank/pulse-logo";

import {
  buildDayTimeline,
  localStoreCountText,
  storageBadgeText,
  utcMinute,
  nextMyDayRecord,
  sumMyDayCaffeine,
} from "./my-pulse-model";
import styles from "./my-pulse.module.css";

type Lookup = Record<string, PublicProductDto | null | undefined>;

type StorageEstimate = {
  usage: number;
  quota: number;
};

type StorageHealth = {
  local: { status: BrowserStorageStatus; error?: Error };
  indexedDb: { status: IndexedDbStatus; error?: Error };
  estimate: StorageEstimate | null;
};

const MAX_PRODUCT_LOOKUPS = 12;

const CATEGORY_OPTIONS = [
  "energy-drink",
  "energy-shot",
  "coffee",
  "tea",
  "soda",
  "water",
  "food",
  "gum",
  "other",
] as const;

const NAV_ITEMS = [
  { href: "/", label: "Home", icon: Home },
  { href: "/explore", label: "Explore", icon: Search },
  { href: "/explore", label: "Passport", icon: BookOpen },
  { href: "/leaderboards", label: "Leaderboards", icon: BarChart3 },
  { href: "/compare", label: "Compare", icon: GitCompareArrows },
  { href: "/changes", label: "Changes", icon: Activity },
  { href: "/my-pulse", label: "My Pulse", icon: Gauge },
  { href: "/live-data", label: "Live Data", icon: Activity },
  { href: "/game", label: "Arcade", icon: Gamepad2 },
] as const;

function dateKey(date: Date): string {
  return utcDateKey(date);
}

function formatMg(value: number): string {
  return `${formatNumber(value)} mg`;
}

function formatRelative(timestamp: number): string {
  const delta = Math.max(0, Date.now() - timestamp);
  const minutes = Math.floor(delta / 60_000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return days === 1 ? "Yesterday" : `${days}d ago`;
}

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function preferenceLabel(value: string | undefined): string {
  if (!value) return "Not set";
  return value
    .replaceAll("-", " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function sourceQualifier(value: string): string {
  return value
    .replaceAll("_", " ")
    .replaceAll("-", " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

async function fetchCurrentProducts(slugs: readonly string[], signal: AbortSignal): Promise<Lookup> {
  const entries = await Promise.all(
    Array.from(new Set(slugs)).slice(0, MAX_PRODUCT_LOOKUPS).map(async (slug) => {
      try {
        const response = await fetch(`/api/public/products/${encodeURIComponent(slug)}`, {
          cache: "no-store",
          signal,
        });
        if (!response.ok) return [slug, null] as const;
        const body = (await response.json()) as { product?: PublicProductDto };
        return [slug, body.product ?? null] as const;
      } catch {
        return [slug, null] as const;
      }
    }),
  );
  return Object.fromEntries(entries);
}

function AppIcon({ size = 17 }: { size?: number }) {
  return <Activity size={size} strokeWidth={2.1} aria-hidden="true" />;
}

function ProductThumb({
  slug,
  name,
  category,
  product,
}: {
  slug: string;
  name: string;
  category: string;
  product: PublicProductDto | null | undefined;
}) {
  return (
    <span className={styles.productThumb} aria-hidden="true">
      {product ? (
        <PublishedProductImage
          alt=""
          fallback={(
            <span className={`${styles.productFallback} ${styles[`category-${category}`] ?? ""}`}>
              <AppIcon size={17} />
            </span>
          )}
          height={38}
          name={name}
          sizes="38px"
          slug={slug}
          width={38}
        />
      ) : (
        <span className={`${styles.productFallback} ${styles[`category-${category}`] ?? ""}`}>
          <AppIcon size={17} />
        </span>
      )}
      <span className="sr-only">{name}</span>
    </span>
  );
}

function DayChart({ records }: { records: readonly MyDayRecord[] }) {
  const timeline = useMemo(() => buildDayTimeline(records), [records]);
  if (timeline.points.length < 2 || timeline.maxMg <= 0) {
    return (
      <div className={styles.chartEmpty}>
        <CalendarClock size={18} aria-hidden="true" />
        <p>
          {records.length > 0
            ? "Entries are stored, but there is no positive caffeine total to plot."
            : "Nothing has been logged for this day."}
        </p>
      </div>
    );
  }

  const width = 720;
  const height = 210;
  const left = 42;
  const right = 16;
  const top = 20;
  const bottom = 34;
  const chartWidth = width - left - right;
  const chartHeight = height - top - bottom;
  const points = timeline.points.map((point) => ({
    ...point,
    x: left + (point.minute / 1_440) * chartWidth,
    y: top + chartHeight - (point.totalMg / timeline.maxMg) * chartHeight,
  }));
  const line = points.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`).join(" ");
  const area = `${line} L ${points.at(-1)?.x.toFixed(2) ?? left} ${top + chartHeight} L ${left} ${top + chartHeight} Z`;
  const latest = points.at(-1);
  const yTicks = [0, 0.5, 1];
  const xTicks = [0, 360, 720, 1_080, 1_440];
  const labelForMinute = (minute: number) => {
    const hour = (minute / 60) % 24;
    if (hour === 0 || hour === 24) return "12 AM";
    if (hour === 12) return "12 PM";
    return hour < 12 ? `${hour} AM` : `${hour - 12} PM`;
  };

  return (
    <div className={styles.chartFrame}>
      <svg
        className={styles.chart}
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-labelledby="my-day-chart-title my-day-chart-description"
      >
        <title id="my-day-chart-title">Caffeine logged across the day</title>
        <desc id="my-day-chart-description">
          Cumulative caffeine from the stored My Day entries with parseable times.
        </desc>
        {yTicks.map((tick) => {
          const y = top + chartHeight - tick * chartHeight;
          return (
            <g key={tick}>
              <line className={styles.chartGrid} x1={left} x2={width - right} y1={y} y2={y} />
              <text className={styles.chartAxis} x={left - 10} y={y + 4} textAnchor="end">
                {formatNumber(timeline.maxMg * tick)}
              </text>
            </g>
          );
        })}
        <path className={styles.chartArea} d={area} />
        <path className={styles.chartLine} d={line} />
        {latest ? (
          <g>
            <line className={styles.chartLatest} x1={latest.x} x2={latest.x} y1={top} y2={top + chartHeight} />
            <circle className={styles.chartLatestDot} cx={latest.x} cy={latest.y} r="4.5" />
            <text className={styles.chartLatestLabel} x={latest.x} y={top - 6} textAnchor="middle">
              Latest {latest.record?.timeLabel}
            </text>
          </g>
        ) : null}
        {xTicks.map((tick) => {
          const x = left + (tick / 1_440) * chartWidth;
          return (
            <text className={styles.chartAxis} key={tick} x={x} y={height - 8} textAnchor={tick === 0 ? "start" : tick === 1_440 ? "end" : "middle"}>
              {labelForMinute(tick)}
            </text>
          );
        })}
      </svg>
      {records.length !== timeline.points.length - 1 ? (
        <p className={styles.chartNote}>Some stored entries have a time label the chart cannot position.</p>
      ) : null}
    </div>
  );
}

function ProductRow({
  href,
  slug,
  name,
  category,
  caffeineMg,
  qualifier,
  timestamp,
  currentProduct,
  timestampLabel,
}: {
  href: string;
  slug: string;
  name: string;
  category: string;
  caffeineMg: number;
  qualifier: string;
  timestamp: number;
  currentProduct: PublicProductDto | null | undefined;
  timestampLabel: string;
}) {
  return (
    <Link className={styles.productRow} href={href}>
      <ProductThumb slug={slug} name={name} category={category} product={currentProduct} />
      <span className={styles.productRowCopy}>
        <strong>{name}</strong>
        <small>{categoryLabel(category)} · {sourceQualifier(qualifier)}</small>
        <small className={styles.productCitation} title={currentProduct ? `${currentProduct.sourceAttribution} · current trusted record` : "Browser-local snapshot; open passport for source record"}>
          {currentProduct ? `${currentProduct.sourceAttribution} · current trusted record` : "Browser-local snapshot · open passport for source record"}
        </small>
      </span>
      <span className={styles.productRowMetric}>
        <strong>{formatMg(caffeineMg)}</strong>
        <time dateTime={new Date(timestamp).toISOString()}>{timestampLabel}</time>
      </span>
      <ChevronRight className={styles.rowArrow} size={16} aria-hidden="true" />
    </Link>
  );
}

function PanelHeading({
  icon: Icon,
  title,
  count,
  action,
}: {
  icon: typeof Bookmark;
  title: string;
  count?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className={styles.panelHeading}>
      <div className={styles.panelHeadingTitle}>
        <span className={styles.panelIcon}><Icon size={18} aria-hidden="true" /></span>
        <div>
          <h2>{title}</h2>
          {count ? <p>{count}</p> : null}
        </div>
      </div>
      {action}
    </div>
  );
}

export function MyPulsePage() {
  const [saved, setSaved] = useState<StoredSavedProduct[]>([]);
  const [recent, setRecent] = useState<RecentlyViewedRecord[]>([]);
  const [day, setDay] = useState<MyDayRecord[]>([]);
  const [compareSlugs, setCompareSlugs] = useState<string[]>([]);
  const [currentProducts, setCurrentProducts] = useState<Lookup>({});
  const [preferences, setPreferences] = useState<PulsePreferences>(() => ({ ...DEFAULT_PREFERENCES }));
  const [storageEstimate, setStorageEstimate] = useState<StorageEstimate | null>(null);
  const [localStorageStatus, setLocalStorageStatus] = useState<BrowserStorageStatus>("unavailable");
  const [indexedDbStatus, setIndexedDbStatus] = useState<IndexedDbStatus>("unavailable");
  const [readIssues, setReadIssues] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<"clear" | "import" | null>(null);
  const [editingPreferences, setEditingPreferences] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [showAllSaved, setShowAllSaved] = useState(false);
  const [showAllRecent, setShowAllRecent] = useState(false);
  const uploadRef = useRef<HTMLInputElement>(null);
  const reloadIdRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const [today, setToday] = useState("");
  const [nowMinute, setNowMinute] = useState<number | null>(null);

  const readStorageHealth = useCallback(async () => {
    const local = inspectLocalStorage();
    const indexedDb = await inspectIndexedDb();
    if (typeof navigator === "undefined" || !navigator.storage?.estimate) {
      return { local, indexedDb, estimate: null } satisfies StorageHealth;
    }
    try {
      const estimate = await navigator.storage.estimate();
      if (typeof estimate.usage === "number" && typeof estimate.quota === "number") {
        return { local, indexedDb, estimate: { usage: estimate.usage, quota: estimate.quota } } satisfies StorageHealth;
      } else {
        return { local, indexedDb, estimate: null } satisfies StorageHealth;
      }
    } catch {
      return { local, indexedDb, estimate: null } satisfies StorageHealth;
    }
  }, []);

  const commitStorageHealth = useCallback((health: StorageHealth) => {
    setLocalStorageStatus(health.local.status);
    setIndexedDbStatus(health.indexedDb.status);
    setStorageEstimate(health.estimate);
  }, []);

  const reload = useCallback(async () => {
    if (!today) return;
    const requestId = ++reloadIdRef.current;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);
    const health = await readStorageHealth();
    if (requestId !== reloadIdRef.current) return;
    commitStorageHealth(health);
    const issues: string[] = [];
    const savedProducts = health.indexedDb.status === "available"
      ? await listSavedProducts().catch(() => { issues.push("saved products"); return []; })
      : [];
    const recentlyViewed = health.indexedDb.status === "available"
      ? await listRecentlyViewed(50).catch(() => { issues.push("recent views"); return []; })
      : [];
    const myDay = health.indexedDb.status === "available"
      ? await listMyDayRecordsForDate(today).catch(() => { issues.push("My Day"); return []; })
      : [];
    if (health.indexedDb.status !== "available") {
      issues.push(health.indexedDb.status === "error" ? "IndexedDB" : "IndexedDB unavailable");
    }
    const nextCompare = health.local.status === "available" ? getCompareSlugs() : [];
    const slugs = [
      ...savedProducts.slice(0, MAX_PRODUCT_LOOKUPS).map((item) => item.slug),
      ...recentlyViewed.slice(0, MAX_PRODUCT_LOOKUPS).map((item) => item.slug),
      ...nextCompare,
    ];
    const lookup = await fetchCurrentProducts(slugs, controller.signal);
    if (requestId !== reloadIdRef.current) return;
    setSaved(savedProducts);
    setRecent(recentlyViewed);
    setDay(myDay);
    setCompareSlugs(nextCompare);
    setCurrentProducts(lookup);
    setPreferences(health.local.status === "available" ? loadPreferences() : { ...DEFAULT_PREFERENCES });
    setReadIssues(issues);
    setMessage(issues.length > 0 ? `Some local data could not be read: ${issues.join(", ")}.` : null);
    setLoading(false);
  }, [commitStorageHealth, readStorageHealth, today]);

  useEffect(() => {
    const updateClock = () => {
      const now = new Date();
      setToday(dateKey(now));
      setNowMinute(utcMinute(now));
    };
    updateClock();
    const interval = window.setInterval(updateClock, 30_000);
    return () => {
      window.clearInterval(interval);
      abortRef.current?.abort();
      reloadIdRef.current += 1;
    };
  }, []);

  useEffect(() => {
    if (!today) return undefined;
    const handle = window.setTimeout(() => void reload(), 0);
    return () => window.clearTimeout(handle);
  }, [reload, today]);

  async function clearLocalData() {
    if (!window.confirm("Clear saved products, compare, My Day, recent views, and preferences from this browser?")) return;
    setBusyAction("clear");
    reloadIdRef.current += 1;
    abortRef.current?.abort();
    const health = await readStorageHealth();
    commitStorageHealth(health);
    const failures: string[] = [];
    if (health.indexedDb.status === "available") {
      const results = await Promise.allSettled([clearSavedProducts(), clearRecentlyViewed(), clearMyDay()]);
      results.forEach((result, index) => {
        if (result.status === "rejected") failures.push(["saved products", "recent views", "My Day"][index] ?? "IndexedDB");
      });
    } else {
      failures.push(health.indexedDb.status === "error" ? "IndexedDB" : "IndexedDB unavailable");
    }
    if (health.local.status === "available") {
      if (!clearCompare()) failures.push("compare");
      if (!clearPreferences()) failures.push("preferences");
    } else {
      failures.push(health.local.status === "error" ? "localStorage" : "localStorage unavailable");
    }
    setSaved([]);
    setRecent([]);
    setDay([]);
    setCompareSlugs([]);
    setPreferences({ ...DEFAULT_PREFERENCES });
    setReadIssues(failures);
    try {
      await reload();
    } finally {
      setBusyAction(null);
    }
    setMessage(failures.length > 0
      ? `Clear incomplete; these sections could not be cleared: ${failures.join(", ")}.`
      : "Local data cleared from this browser.");
  }

  async function downloadBackup() {
    try {
      const envelope = await exportAll();
      const blob = new Blob([JSON.stringify(envelope, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `pulserank-local-${today}.json`;
      anchor.click();
      URL.revokeObjectURL(url);
      setMessage("Versioned local backup downloaded.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Export unavailable; no backup was created.");
    }
  }

  async function importBackup(file: File) {
    setBusyAction("import");
    reloadIdRef.current += 1;
    abortRef.current?.abort();
    try {
      const summary = await importAll(JSON.parse(await file.text()));
      setMessage(summary.errors.length > 0
        ? `Import partially restored ${summary.savedProducts} saved products, ${summary.myDay} My Day entries, and ${summary.recentlyViewed} recent views. Failed sections: ${summary.errors.join(", ")}.`
        : `Imported ${summary.savedProducts} saved products, ${summary.myDay} My Day entries, and ${summary.recentlyViewed} recent views.`);
      await reload();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Import failed; no local data was changed.");
    } finally {
      if (uploadRef.current) uploadRef.current.value = "";
      setBusyAction(null);
    }
  }

  function updatePreference(patch: Partial<PulsePreferences>) {
    const next = updatePreferences(patch);
    if (!next) {
      setMessage("Preferences could not be saved because browser storage is unavailable.");
      return;
    }
    setPreferences(next);
    setMessage("Preference saved in this browser.");
  }

  const totalToday = sumMyDayCaffeine(day);
  const timeline = useMemo(() => buildDayTimeline(day), [day]);
  const nextItem = useMemo(() => nowMinute === null ? null : nextMyDayRecord(day, nowMinute), [day, nowMinute]);
  const storageAvailable = localStorageStatus === "available" && indexedDbStatus === "available";
  const localStorageBadge = storageBadgeText(localStorageStatus, indexedDbStatus);
  const idbReadUnavailable = indexedDbStatus !== "available";
  const myDayUnavailable = idbReadUnavailable || readIssues.includes("My Day") || readIssues.includes("IndexedDB");
  const myDayUnavailableLabel = indexedDbStatus === "error" || readIssues.includes("My Day") || readIssues.includes("IndexedDB")
    ? "My Day could not be read."
    : "My Day is unavailable.";
  const indexedDbMarker = indexedDbStatus === "error" || readIssues.includes("IndexedDB") ? "Error" : "Unavailable";
  const localStorageMarker = localStorageStatus === "error" ? "Error" : "Unavailable";
  const savedCount = indexedDbStatus === "available" && !readIssues.includes("saved products") ? saved.length : indexedDbMarker;
  const recentCount = indexedDbStatus === "available" && !readIssues.includes("recent views") ? recent.length : indexedDbMarker;
  const myDayCount = indexedDbStatus === "available" && !readIssues.includes("My Day") ? day.length : indexedDbMarker;
  const compareCount = localStorageStatus === "available" ? compareSlugs.length : localStorageMarker;
  const preferenceCount = localStorageStatus === "available" ? "Available" : localStorageMarker;
  const visibleSaved = showAllSaved ? saved : saved.slice(0, 4);
  const visibleRecent = showAllRecent ? recent : recent.slice(0, 4);

  return (
    <div className={styles.page}>
      <aside className={styles.sidebar} aria-label="PulseRank navigation">
        <div className={styles.sidebarInner}>
          <div className={styles.brandRow}>
            <Link href="/" className={styles.brand} aria-label="PulseRank home">
              <span className={styles.brandMark}><PulseLogo size={27} /></span>
              <span>PulseRank</span>
            </Link>
            <button
              type="button"
              className={styles.mobileMenuButton}
              aria-expanded={mobileNavOpen}
              aria-controls="my-pulse-navigation"
              aria-label={mobileNavOpen ? "Close navigation" : "Open navigation"}
              onClick={() => setMobileNavOpen((open) => !open)}
            >
              {mobileNavOpen ? <X size={19} aria-hidden="true" /> : <Menu size={19} aria-hidden="true" />}
            </button>
          </div>
          <nav id="my-pulse-navigation" className={`${styles.nav} ${mobileNavOpen ? styles.navOpen : ""}`} aria-label="Primary">
            {NAV_ITEMS.map(({ href, label, icon: Icon }) => (
              <Link
                key={label}
                href={href}
                className={`${styles.navItem} ${label === "My Pulse" ? styles.navItemActive : ""}`}
                aria-current={label === "My Pulse" ? "page" : undefined}
                onClick={() => setMobileNavOpen(false)}
              >
                <Icon size={17} aria-hidden="true" />
                <span>{label}</span>
              </Link>
            ))}
          </nav>
          <div className={styles.sidebarLower}>
            <p className={styles.sidebarLabel}>About PulseRank</p>
            <Link href="/" className={styles.secondaryNavItem}><Info size={16} aria-hidden="true" /> How it works</Link>
            <Link href="/live-data" className={styles.secondaryNavItem}><BookOpen size={16} aria-hidden="true" /> Data explained</Link>
            <Link href="#preferences" className={styles.secondaryNavItem}><Settings2 size={16} aria-hidden="true" /> Settings</Link>
          </div>
          <div className={styles.sidebarStorage}>
            <div className={styles.storageCardTop}>
              <Database size={17} aria-hidden="true" />
              <span>Local storage</span>
              <span className={`${styles.storageDot} ${storageAvailable ? styles.storageDotActive : ""}`} aria-hidden="true" />
            </div>
            <strong>{localStorageStatus === "error" || indexedDbStatus === "error" ? "Browser storage access error" : storageAvailable ? "Active in this browser" : "Browser storage unavailable"}</strong>
            <small>localStorage: {localStorageStatus}; IndexedDB: {indexedDbStatus}</small>
            <span className={styles.storageProgress} aria-hidden="true"><span style={{ width: storageEstimate && storageEstimate.quota > 0 ? `${Math.min(100, (storageEstimate.usage / storageEstimate.quota) * 100)}%` : "0%" }} /></span>
          </div>
        </div>
      </aside>

      <main className={styles.main}>
        <header className={styles.topbar}>
          <div>
            <h1>My Pulse</h1>
            <div className={styles.subtitleRow}>
              <p>Your personal workspace. Private to this browser.</p>
              <span className={`${styles.localBadge} ${localStorageBadge === "Stored locally" ? "" : styles.localBadgeAttention}`}>
                {localStorageBadge === "Stored locally" ? <LockKeyhole size={13} aria-hidden="true" /> : <Database size={13} aria-hidden="true" />}
                {localStorageBadge}
              </span>
            </div>
          </div>
          <div className={styles.topActions}>
            <button type="button" className={styles.secondaryButton} onClick={() => void reload()} disabled={loading || busyAction !== null}>
              <RefreshCw size={15} aria-hidden="true" /> Refresh
            </button>
            <button type="button" className={styles.dangerButton} onClick={() => void clearLocalData()} disabled={busyAction !== null}>
              <Trash2 size={15} aria-hidden="true" /> {busyAction === "clear" ? "Clearing…" : "Clear local data"}
            </button>
          </div>
        </header>

        {message ? <p className={styles.liveMessage} aria-live="polite">{message}</p> : null}

        <section className={styles.dayPanel} aria-labelledby="my-day-heading">
          <div className={styles.dayHeader}>
            <div>
              <div className={styles.headingWithInfo}>
                <h2 id="my-day-heading">My Day</h2>
                <span title="My Day entries are stored only in this browser."><CircleHelp size={15} aria-hidden="true" /></span>
              </div>
              <p>Caffeine timeline · {today || "UTC day"}</p>
            </div>
            <span className={styles.dateChip}><CalendarClock size={14} aria-hidden="true" /> UTC day</span>
          </div>

          <div className={styles.dayLayout}>
            <div className={styles.chartWrap}>
              {loading ? <div className={styles.loadingBlock}>Reading today&apos;s local entries…</div> : myDayUnavailable ? (
                <div className={styles.chartEmpty}>
                  <Database size={18} aria-hidden="true" />
                  <p>{myDayUnavailableLabel}</p>
                  <small>Stored entries are not being treated as an empty diary.</small>
                </div>
              ) : <DayChart records={day} />}
            </div>
            <aside className={styles.daySummary} aria-label="My Day summary">
              <p>Today so far</p>
              <strong>{myDayUnavailable ? "Unavailable" : day.length > 0 ? formatMg(totalToday) : "No entries"}</strong>
              <div className={styles.summaryDivider} />
              <dl>
                <div><dt>Logged items</dt><dd>{myDayUnavailable ? "—" : day.length}</dd></div>
                <div><dt>Latest entry</dt><dd>{myDayUnavailable ? "—" : timeline.latest?.timeLabel ?? "—"}</dd></div>
              </dl>
            </aside>
          </div>

          <div className={styles.dayFootnotes}>
            <div className={styles.dayFootnote}>
              <Clock3 size={22} aria-hidden="true" />
              <div><span>Next item</span><strong>{myDayUnavailable ? "Unavailable" : nextItem ? `${nextItem.timeLabel} · ${nextItem.name}` : "No upcoming item"}</strong></div>
            </div>
            <div className={styles.dayFootnote}>
              <Gauge size={22} aria-hidden="true" />
              <div><span>Pacing target</span><strong>No target configured</strong><small>PulseRank does not invent a daily caffeine limit.</small></div>
            </div>
          </div>
        </section>

        <div className={styles.panelGrid}>
          <section className={styles.panel} aria-labelledby="saved-heading">
            <PanelHeading
              icon={Bookmark}
              title="Saved products"
              count={loading ? "Reading local shelf…" : localStoreCountText(saved.length, indexedDbStatus, readIssues.includes("saved products"), "saved locally")}
              action={saved.length > 4 ? <button type="button" className={styles.textButton} onClick={() => setShowAllSaved((show) => !show)}>{showAllSaved ? "Show less" : "See all"}</button> : null}
            />
            <h2 id="saved-heading" className="sr-only">Saved products</h2>
            {loading ? <div className={styles.listLoading}>Reading saved products…</div> : idbReadUnavailable || readIssues.includes("saved products") ? (
              <div className={styles.emptyPanel}><Database size={21} aria-hidden="true" /><p>{indexedDbStatus === "error" ? "Saved products could not be read." : "IndexedDB is unavailable."}</p><small>PulseRank will not treat a storage failure as an empty shelf.</small></div>
            ) : saved.length === 0 ? (
              <div className={styles.emptyPanel}><Bookmark size={21} aria-hidden="true" /><p>No saved products yet.</p><small>Save an exact numeric product from Explore to build this shelf.</small><Link className={styles.inlineLink} href="/explore">Explore products <ArrowRight size={14} aria-hidden="true" /></Link></div>
            ) : (
              <div className={styles.productList}>
                {visibleSaved.map((item) => <ProductRow key={item.slug} href={`/products/${item.slug}`} slug={item.slug} name={item.name} category={item.category} caffeineMg={item.caffeine.mg} qualifier={item.caffeine.qualifier} timestamp={item.savedAt} timestampLabel={formatRelative(item.savedAt)} currentProduct={currentProducts[item.slug]} />)}
              </div>
            )}
          </section>

          <section className={styles.panel} aria-labelledby="recent-heading">
            <PanelHeading
              icon={Clock3}
              title="Recently viewed"
              count={loading ? "Reading local history…" : localStoreCountText(recent.length, indexedDbStatus, readIssues.includes("recent views"), "recent locally")}
              action={recent.length > 4 ? <button type="button" className={styles.textButton} onClick={() => setShowAllRecent((show) => !show)}>{showAllRecent ? "Show less" : "See all"}</button> : null}
            />
            <h2 id="recent-heading" className="sr-only">Recently viewed</h2>
            {loading ? <div className={styles.listLoading}>Reading recent views…</div> : idbReadUnavailable || readIssues.includes("recent views") ? (
              <div className={styles.emptyPanel}><Database size={21} aria-hidden="true" /><p>{indexedDbStatus === "error" ? "Recent views could not be read." : "IndexedDB is unavailable."}</p><small>PulseRank will not treat a storage failure as an empty history.</small></div>
            ) : recent.length === 0 ? (
              <div className={styles.emptyPanel}><Clock3 size={21} aria-hidden="true" /><p>No recent views yet.</p><small>Trusted product pages you open are kept in this browser when they have an exact numeric record.</small><Link className={styles.inlineLink} href="/explore">Explore products <ArrowRight size={14} aria-hidden="true" /></Link></div>
            ) : (
              <div className={styles.productList}>
                {visibleRecent.map((item) => <ProductRow key={item.slug} href={`/products/${item.slug}`} slug={item.slug} name={item.ref.name} category={item.ref.category} caffeineMg={item.ref.caffeine.mg} qualifier={item.ref.caffeine.qualifier} timestamp={item.viewedAt} timestampLabel={formatRelative(item.viewedAt)} currentProduct={currentProducts[item.slug]} />)}
              </div>
            )}
          </section>

          <section className={styles.panel} aria-labelledby="compare-heading">
            <PanelHeading icon={Folder} title="Compare tray" count={localStoreCountText(compareSlugs.length, localStorageStatus, false, "of 4 local slots used")} action={<Link className={styles.textButton} href="/compare">Open compare</Link>} />
            <h2 id="compare-heading" className="sr-only">Compare tray</h2>
            {localStorageStatus !== "available" ? (
              <div className={styles.emptyPanel}><Database size={21} aria-hidden="true" /><p>Compare tray unavailable.</p><small>{localStorageStatus === "error" ? "Browser localStorage returned an access error." : "Browser localStorage is unavailable."}</small></div>
            ) : compareSlugs.length === 0 ? (
              <div className={styles.emptyPanel}><GitCompareArrows size={21} aria-hidden="true" /><p>No products selected for comparison.</p><small>Choose Compare on trusted product pages; the four-slot tray stays in this browser.</small><Link className={styles.inlineLink} href="/explore">Explore products <ArrowRight size={14} aria-hidden="true" /></Link></div>
            ) : (
              <div className={styles.compareList}>
                {compareSlugs.map((slug) => {
                  const product = currentProducts[slug];
                  return <Link key={slug} href={`/products/${slug}`} className={styles.compareRow}><span>{product?.name ?? slug}</span><ChevronRight size={16} aria-hidden="true" /></Link>;
                })}
              </div>
            )}
          </section>

          <section className={styles.panel} id="preferences" aria-labelledby="preferences-heading">
            <PanelHeading icon={Settings2} title="Preferences" action={<button type="button" className={styles.textButton} onClick={() => setEditingPreferences((editing) => !editing)}>{editingPreferences ? "Done" : "Edit"}</button>} />
            <h2 id="preferences-heading" className="sr-only">Preferences</h2>
            {!editingPreferences ? (
              <dl className={styles.preferenceList}>
                <div><dt>Theme preference</dt><dd>{preferenceLabel(preferences.theme)}</dd></div>
                <div><dt>Reduced motion</dt><dd>{preferenceLabel(preferences.reducedMotionOverride ?? "auto")}</dd></div>
                <div><dt>Default category</dt><dd>{preferences.defaultCategory ? categoryLabel(preferences.defaultCategory) : "Not set"}</dd></div>
                <div><dt>Local state version</dt><dd>v{PULSERANK_LOCAL_STATE_VERSION}</dd></div>
              </dl>
            ) : (
              <div className={styles.preferenceEditor}>
                <label>Theme preference<select value={preferences.theme} onChange={(event) => updatePreference({ theme: event.target.value as PulsePreferences["theme"] })}><option value="system">System</option><option value="dark">Dark</option><option value="light">Light</option></select></label>
                <label>Reduced motion<select value={preferences.reducedMotionOverride ?? "auto"} onChange={(event) => updatePreference({ reducedMotionOverride: event.target.value as NonNullable<PulsePreferences["reducedMotionOverride"]> })}><option value="auto">Auto</option><option value="on">On</option><option value="off">Off</option></select></label>
                <label>Default category<select value={preferences.defaultCategory ?? ""} onChange={(event) => updatePreference({ defaultCategory: event.target.value || undefined })}><option value="">Not set</option>{CATEGORY_OPTIONS.map((category) => <option key={category} value={category}>{categoryLabel(category)}</option>)}</select></label>
                <p className={styles.preferenceNote}>This route stays dark so the approved My Pulse workspace remains consistent; your saved preference is still shown and exported.</p>
              </div>
            )}
          </section>
        </div>

        <section className={styles.storagePanel} aria-labelledby="storage-heading">
          <div className={styles.storagePanelIntro}>
            <PanelHeading icon={Database} title="Local storage status" count={storageAvailable ? "Browser-local, not synced" : "Storage availability needs attention"} />
            <h2 id="storage-heading" className="sr-only">Local storage status</h2>
            <ul className={styles.storageChecks}>
              <li><span className={styles.checkMark} aria-hidden="true">✓</span><span>All personal entries stay in this browser.</span></li>
              <li><span className={styles.checkMark} aria-hidden="true">✓</span><span>Nothing is synced to a PulseRank account.</span></li>
              <li><span className={styles.checkMark} aria-hidden="true">✓</span><span>Clear or export this data whenever you choose.</span></li>
            </ul>
            <div className={styles.transferActions}>
              <button type="button" className={styles.primaryButton} onClick={() => void downloadBackup()}><Download size={15} aria-hidden="true" /> Export backup</button>
              <button type="button" className={styles.secondaryButton} onClick={() => uploadRef.current?.click()} disabled={busyAction !== null}><Upload size={15} aria-hidden="true" /> {busyAction === "import" ? "Importing…" : "Import backup"}</button>
              <input ref={uploadRef} type="file" accept="application/json" hidden disabled={busyAction !== null} onChange={(event) => { const file = event.target.files?.[0]; if (file) void importBackup(file); }} />
            </div>
          </div>
          <div className={styles.storagePanelList}>
            <h3>What&apos;s stored locally</h3>
            <ul>
              <li><Bookmark size={15} aria-hidden="true" /><span>Saved products</span><strong>{savedCount}</strong></li>
              <li><Folder size={15} aria-hidden="true" /><span>Compare tray</span><strong>{compareCount}</strong></li>
              <li><Clock3 size={15} aria-hidden="true" /><span>Recently viewed</span><strong>{recentCount}</strong></li>
              <li><Activity size={15} aria-hidden="true" /><span>My Day entries</span><strong>{myDayCount}</strong></li>
              <li><Settings2 size={15} aria-hidden="true" /><span>Preferences</span><strong>{preferenceCount}</strong></li>
            </ul>
            {storageEstimate ? <p className={styles.storageEstimate}>{formatBytes(storageEstimate.usage)} of {formatBytes(storageEstimate.quota)} origin storage estimated</p> : <p className={styles.storageEstimate}>Origin storage usage estimate is unavailable in this browser.</p>}
          </div>
        </section>
      </main>
    </div>
  );
}
