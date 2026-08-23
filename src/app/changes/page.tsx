import type { Metadata } from "next";
import Link from "next/link";
import { ArrowDownToLine, Bell, CalendarDays, ChevronDown, CircleHelp, Database, Menu, Search, ShieldCheck, UserCircle, Zap } from "lucide-react";

import { InvalidCursorError, listChanges } from "@/server/products/queries";

import { ChangesEmptyState, ChangesLedger } from "@/components/pulserank/changes/changes-ledger";
import { CHANGE_GROUPS, changeGroupForEventType, countChangeGroups, formatObservedAt } from "@/components/pulserank/changes/changes-model";
import styles from "@/components/pulserank/changes/changes.module.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Changes",
  description: "Trusted source-to-source product changes and their timestamps.",
};

type ChangesSearchParams = Promise<Record<string, string | string[] | undefined>>;

const NAV_ITEMS = [
  { href: "/", label: "Overview", icon: Database },
  { href: "/explore", label: "Explore", icon: Search },
  { href: "/compare", label: "Compare", icon: Zap },
  { href: "/changes", label: "Changes", icon: ArrowDownToLine },
  { href: "/my-pulse", label: "My Pulse", icon: UserCircle },
  { href: "/live-data", label: "Live Data", icon: Database },
] as const;

function getOneParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value.at(-1) : value;
}

function queryHref(group?: string, cursor?: string | null): string {
  const query = new URLSearchParams();
  if (group && group !== "all") query.set("group", group);
  if (cursor) query.set("cursor", cursor);
  const value = query.toString();
  return value ? `/changes?${value}` : "/changes";
}

function ChangesHeader() {
  return (
    <header className={styles.header}>
      <div className={styles.headerInner}>
        <Link href="/" className={styles.brand} aria-label="PulseRank home">
          <span className={styles.brandMark} aria-hidden="true">
            <svg viewBox="0 0 32 32" fill="none" role="presentation">
              <path d="M1 17h5l2.5-8 4.5 16 4.5-21 3.5 13H31" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
          <span className={styles.wordmark}>PulseRank</span>
        </Link>
        <form className={styles.headerSearch} action="/explore" method="get" role="search">
          <Search size={16} aria-hidden="true" />
          <label className="sr-only" htmlFor="changes-search">Search products, categories, flavours</label>
          <input id="changes-search" name="search" placeholder="Search products, categories, flavours…" />
          <kbd aria-hidden="true">/</kbd>
        </form>
        <div className={styles.headerLinks} aria-label="Account and notifications">
          <Link href="/live-data" className={styles.headerIconLink} aria-label="Open live data"><Bell size={19} /></Link>
          <Link href="/my-pulse" className={styles.headerIconLink} aria-label="Open My Pulse"><UserCircle size={22} /></Link>
        </div>
      </div>
    </header>
  );
}

function ChangesSidebar() {
  const links = (
    <>
      {NAV_ITEMS.map(({ href, label, icon: Icon }) => (
        <Link href={href} key={href} className={`${styles.sidebarLink}${href === "/changes" ? ` ${styles.sidebarLinkActive}` : ""}`} aria-current={href === "/changes" ? "page" : undefined}>
          <Icon size={18} aria-hidden="true" />
          <span>{label}</span>
        </Link>
      ))}
    </>
  );
  return (
    <aside className={styles.sidebar}>
      <nav className={styles.sidebarNav} aria-label="PulseRank sections">
        {links}
      </nav>
      <p className={styles.sidebarLabel}>Public data</p>
      <nav className={styles.sidebarNav} aria-label="PulseRank information">
        <Link href="/live-data" className={styles.sidebarLink}><ShieldCheck size={18} aria-hidden="true" /><span>Trust status</span></Link>
        <Link href="/live-data" className={styles.sidebarLink}><CircleHelp size={18} aria-hidden="true" /><span>About the data</span></Link>
      </nav>
      <details className={styles.mobileNav}>
        <summary><Menu size={16} aria-hidden="true" /> <span>PulseRank sections</span><ChevronDown size={16} aria-hidden="true" /></summary>
        <nav className={styles.mobileNavPanel} aria-label="PulseRank mobile sections">{links}</nav>
      </details>
    </aside>
  );
}

export default async function ChangesPage({ searchParams }: { searchParams?: ChangesSearchParams }) {
  const params = searchParams ? await searchParams : {};
  const requestedGroup = getOneParam(params.group);
  const activeGroup = CHANGE_GROUPS.some(({ id }) => id === requestedGroup) ? requestedGroup as (typeof CHANGE_GROUPS)[number]["id"] : "all";
  const cursor = getOneParam(params.cursor) ?? null;
  let cursorWasRepaired = false;
  let changes;
  try {
    changes = await listChanges({ limit: 7, cursor });
  } catch (error) {
    if (!(error instanceof InvalidCursorError)) throw error;
    cursorWasRepaired = true;
    changes = await listChanges({ limit: 7 });
  }
  const items = activeGroup === "all" ? changes.items : changes.items.filter((change) => changeGroupForEventType(change.eventType) === activeGroup);
  const facets = countChangeGroups(changes.items);
  const latest = changes.items.at(0)?.occurredAt;
  const hasCursor = Boolean(cursor) && !cursorWasRepaired;

  return (
    <div className={styles.surface}>
      <ChangesHeader />
      <div className={styles.pageGrid}>
        <ChangesSidebar />
        <main className={styles.main} id="main-content">
          <section className={styles.hero} aria-labelledby="changes-title">
            <div>
              <h1 id="changes-title">PulseRank Changes</h1>
              <p>Track how products change over time across trusted snapshots.</p>
            </div>
            <a className={styles.heroAction} href="/api/public/changes?limit=100">
              <ArrowDownToLine size={16} aria-hidden="true" />
              Export feed
            </a>
          </section>

          {cursorWasRepaired ? <div className={styles.notice} role="status">That pagination link was invalid, so the newest trusted events are shown instead. <Link href="/changes">Start at the first page</Link></div> : null}

          <section className={styles.controls} aria-label="Change stream controls">
            <nav className={styles.filterList} aria-label="Filter loaded change events">
              {facets.map(({ id, label, count }) => (
                <Link href={queryHref(id)} key={id} className={`${styles.filter}${activeGroup === id ? ` ${styles.filterActive}` : ""}`} aria-current={activeGroup === id ? "page" : undefined}>
                  {label} <span className={styles.filterCount}>{count}</span>
                </Link>
              ))}
            </nav>
            <div className={styles.controlTools} aria-label="Change stream range and sort">
              <span className={styles.controlMetaItem}><CalendarDays size={14} aria-hidden="true" /> All time</span>
              <span className={styles.controlMetaItem}><ArrowDownToLine size={14} aria-hidden="true" /> Newest first</span>
              <span className={styles.legendItem}><span className={styles.legendDot} aria-hidden="true" /> Trusted event</span>
              <span className={styles.legendItem}><span className={styles.legendDotQuiet} aria-hidden="true" /> Ranking impact not available</span>
            </div>
            <div className={styles.controlMeta}>
              <span><strong>{items.length}</strong> {activeGroup === "all" ? "trusted events" : CHANGE_GROUPS.find(({ id }) => id === activeGroup)?.label.toLowerCase()} in this page</span>
              {activeGroup !== "all" ? <Link href="/changes" className={styles.textLink}>Clear filter</Link> : null}
            </div>
          </section>

          {items.length > 0 ? <ChangesLedger items={items} /> : <ChangesEmptyState filtered={activeGroup !== "all"} hasCursor={hasCursor} hasNextPage={Boolean(changes.nextCursor)} rawPageHasItems={changes.items.length > 0} />}

          {changes.nextCursor ? <Link href={queryHref(activeGroup, changes.nextCursor)} className={styles.olderLink}>Load older trusted events</Link> : null}

          <section className={styles.policyPanel} aria-labelledby="changes-policy-title">
            <div className={styles.policyIcon} aria-hidden="true"><Database size={24} /></div>
            <div>
              <h2 id="changes-policy-title">{hasCursor && changes.items.length === 0 && !changes.nextCursor ? "No more events in the available history" : items.length === 0 && changes.items.length > 0 && activeGroup !== "all" ? "No loaded events match this filter" : items.length === 0 ? "No verified changes in the available history" : "Changes stay tied to trusted history"}</h2>
              <p>PulseRank creates a ledger entry only when two trusted snapshots for the same product differ. Candidate, quarantined, and failed observations stay out of this public view. Exact source access time is not stored; timestamps use the trusted observation.</p>
              <Link href="/live-data" className={styles.textLink}>Read the trust pipeline</Link>
            </div>
          </section>

          <footer className={styles.footer}>
            <span className={styles.footerTrust}><ShieldCheck size={14} aria-hidden="true" /> Only trusted-to-trusted observations create entries.</span>
            <span>Source context appears on each product passport{latest ? ` · Latest loaded ${formatObservedAt(latest)}` : ""}.</span>
          </footer>
        </main>
      </div>
    </div>
  );
}
