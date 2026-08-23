import Link from "next/link";
import {
  Activity,
  AlertCircle,
  ArrowUpRight,
  Check,
  CircleHelp,
  Database,
  Download,
  Filter,
  GitCompareArrows,
  History,
  Home,
  Layers3,
  Radio,
  RadioTower,
  RefreshCw,
  Search,
  Server,
  Settings2,
  ShieldCheck,
  Trophy,
  UserRound,
  Wifi,
  XCircle,
  type LucideIcon,
} from "lucide-react";

import type { LiveDataStats } from "@/server/products/queries";

import {
  chartPath,
  chartPoints,
  formatCount,
  formatDateTime,
  formatRelative,
  humanizeStatus,
  pipelineStages,
  pipelineSummary,
  recentRunDisplay,
  runStateCounts,
  sourceStatusSummary,
  statusTone,
  summaryCards,
} from "./live-data-model";
import styles from "./live-data.module.css";

type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
};

const primaryNav: readonly NavItem[] = [
  { href: "/", label: "Overview", icon: Home },
  { href: "/explore", label: "Explore", icon: Search },
  { href: "/compare", label: "Compare", icon: GitCompareArrows },
  { href: "/changes", label: "Changes", icon: History },
  { href: "/live-data", label: "Live Data", icon: Activity },
  { href: "/my-pulse", label: "My Pulse", icon: UserRound },
  { href: "/leaderboards", label: "Leaderboards", icon: Trophy },
];

const summaryIcons = {
  violet: Layers3,
  blue: Database,
  teal: RadioTower,
  green: Check,
  amber: ShieldCheck,
} as const;

const stageIcons = [Download, ShieldCheck, Filter, Trophy, Wifi] as const;

function statusClass(tone: ReturnType<typeof statusTone>): string {
  if (tone === "success") return styles.toneSuccess ?? "";
  if (tone === "warning") return styles.toneWarning ?? "";
  if (tone === "danger") return styles.toneDanger ?? "";
  return styles.toneMuted ?? "";
}

function accentClass(accent: "violet" | "blue" | "teal" | "green" | "amber"): string {
  if (accent === "blue") return styles.accentBlue ?? "";
  if (accent === "teal") return styles.accentTeal ?? "";
  if (accent === "green") return styles.accentGreen ?? "";
  if (accent === "amber") return styles.accentAmber ?? "";
  return styles.accentViolet ?? "";
}

function Timestamp({ value, className }: { value: string | null; className?: string }) {
  return value ? (
    <time className={className} dateTime={value} title={formatDateTime(value)}>
      {formatDateTime(value)}
    </time>
  ) : (
    <span className={className}>Not available</span>
  );
}

function Sidebar() {
  return (
    <aside className={styles.sidebar} aria-label="Primary navigation">
      <Link href="/" className={styles.brand} aria-label="PulseRank home">
        <span className={styles.brandGlyph} aria-hidden="true">
          <Activity size={24} strokeWidth={2.4} />
        </span>
        <span>PulseRank</span>
      </Link>

      <nav className={styles.nav} aria-label="PulseRank">
        {primaryNav.map(({ href, label, icon: Icon }) => {
          const isActive = href === "/live-data";
          return (
            <Link
              key={href}
              href={href}
              className={`${styles.navItem} ${isActive ? styles.navItemActive : ""}`}
              aria-label={label}
              aria-current={isActive ? "page" : undefined}
            >
              <Icon aria-hidden="true" size={19} strokeWidth={1.7} />
              <span>{label}</span>
            </Link>
          );
        })}
        <span className={`${styles.navItem} ${styles.navItemDisabled}`} aria-disabled="true" title="Settings are not part of the public surface">
          <Settings2 aria-hidden="true" size={19} strokeWidth={1.7} />
          <span>Settings</span>
        </span>
      </nav>

      <div className={styles.sidebarNote}>
        <span className={styles.sidebarNoteLabel}>Public operations</span>
        <strong>Trusted data only</strong>
        <span>Sanitized run history</span>
      </div>
    </aside>
  );
}

function SummaryCard({
  label,
  value,
  detail,
  accent,
  unavailable,
}: {
  label: string;
  value: string;
  detail: string;
  accent: "violet" | "blue" | "teal" | "green" | "amber";
  unavailable?: boolean;
}) {
  const Icon = summaryIcons[accent] ?? Layers3;
  return (
    <article className={`${styles.summaryCard} ${accentClass(accent)}`}>
      <div className={styles.summaryCardTop}>
        <span>{label}</span>
        <span className={styles.summaryIcon} aria-hidden="true">
          <Icon size={24} strokeWidth={1.7} />
        </span>
      </div>
      <strong className={unavailable ? styles.summaryUnavailable : undefined}>{value}</strong>
      <span className={styles.summaryDetail}>{detail}</span>
    </article>
  );
}

function PipelineHealth({ stats }: { stats: LiveDataStats }) {
  const stages = pipelineStages(stats);
  const summary = pipelineSummary(stats);
  const run = stats.recentRuns[0] ?? null;

  return (
    <section className={`${styles.panel} ${styles.pipelinePanel}`} aria-labelledby="pipeline-title">
      <div className={styles.panelHeader}>
        <div>
          <h2 id="pipeline-title">Pipeline health</h2>
          <p className={styles.panelSubhead}>
            {run ? `Run status · ${humanizeStatus(run.status)}` : "No collection run is recorded"}
          </p>
        </div>
        <span className={`${styles.inlineStatus} ${statusClass(summary.tone)}`}>
          <span className={styles.statusDot} aria-hidden="true" />
          {summary.label}
        </span>
      </div>

      <ol className={styles.pipelineStages} aria-label="Latest public pipeline stages">
        {stages.map((stage, index) => {
          const Icon = stageIcons[index] ?? Activity;
          return (
            <li className={styles.pipelineStage} key={stage.label}>
              <div className={`${styles.stageCircle} ${statusClass(stage.tone)}`}>
                <Icon aria-hidden="true" size={26} strokeWidth={1.7} />
              </div>
              <strong>{stage.label}</strong>
              <span>{stage.detail}</span>
              <em className={statusClass(stage.tone)}>{stage.status}</em>
            </li>
          );
        })}
      </ol>

      <p className={styles.panelFootnote}>
        Stages reflect the latest sanitized run record. Missing stage evidence remains unavailable.
      </p>
    </section>
  );
}

function SnapshotTimeline({ stats }: { stats: LiveDataStats }) {
  const points = chartPoints(stats);
  const path = chartPath(points);
  const counts = runStateCounts(stats);

  return (
    <section className={`${styles.panel} ${styles.timelinePanel}`} aria-labelledby="timeline-title">
      <div className={styles.panelHeader}>
        <div>
          <h2 id="timeline-title">Collection timeline</h2>
          <p className={styles.panelSubhead}>Reported row counts from recent runs</p>
        </div>
        <a className={styles.panelLink} href="/api/public/live-data">
          Open JSON <ArrowUpRight aria-hidden="true" size={15} />
        </a>
      </div>

      {points.length > 0 ? (
        <div className={styles.chartWrap}>
          <svg className={styles.timelineChart} viewBox="0 0 440 180" role="img" aria-label={`Reported collected row counts across ${points.length} recent runs`}>
            <line className={styles.chartGrid} x1="18" y1="16" x2="422" y2="16" />
            <line className={styles.chartGrid} x1="18" y1="76" x2="422" y2="76" />
            <line className={styles.chartGrid} x1="18" y1="136" x2="422" y2="136" />
            <path className={styles.chartArea} d={`${path} L${points.at(-1)?.x ?? 18} 136 L18 136 Z`} />
            <path className={styles.chartPath} d={path} />
            {points.map((point) => (
              <g key={`${point.timestamp}-${point.x}`}>
                <circle className={styles.chartPointHalo} cx={point.x} cy={point.y} r="8" />
                <circle className={styles.chartPoint} cx={point.x} cy={point.y} r="4" />
                <title>{`${point.label}: ${formatCount(point.value)} collected rows`}</title>
              </g>
            ))}
          </svg>
          <div className={styles.chartAxis} aria-hidden="true">
            {points.map((point) => <span key={`${point.timestamp}-label`}>{point.label}</span>)}
          </div>
        </div>
      ) : (
        <div className={styles.chartEmpty}>
          <CircleHelp aria-hidden="true" size={22} />
          <strong>No reported row counts yet</strong>
          <span>Recent runs remain available below when public timestamps or counts are present.</span>
        </div>
      )}

      <div className={styles.runLegend} aria-label="Recent run state counts">
        <div><span className={`${styles.legendDot} ${styles.legendSuccess}`} /><span>Completed</span><strong>{counts.completed}</strong></div>
        <div><span className={`${styles.legendDot} ${styles.legendWarning}`} /><span>In progress</span><strong>{counts.inProgress}</strong></div>
        <div><span className={`${styles.legendDot} ${styles.legendDanger}`} /><span>Needs attention</span><strong>{counts.needsAttention}</strong></div>
        <div><span className={`${styles.legendDot} ${styles.legendMuted}`} /><span>Unknown</span><strong>{counts.unknown}</strong></div>
      </div>
    </section>
  );
}

function SourcesByStatus({ stats }: { stats: LiveDataStats }) {
  const summary = sourceStatusSummary(stats);
  return (
    <section className={`${styles.panel} ${styles.sourcesPanel}`} aria-labelledby="sources-title">
      <div className={styles.panelHeader}>
        <div>
          <h2 id="sources-title">Sources by status</h2>
          <p className={styles.panelSubhead}>Active source records only</p>
        </div>
        <Server aria-hidden="true" size={18} className={styles.headerIcon} />
      </div>

      <div className={styles.sourceSummary}>
        <div className={styles.sourceRing} aria-hidden="true">
          <div>
            <strong>{formatCount(summary.activeCount)}</strong>
            <span>Active</span>
          </div>
        </div>
        <div className={styles.sourceLegend}>
          <div><span className={`${styles.legendDot} ${styles.legendSuccess}`} /><strong>{formatCount(summary.activeCount)}</strong><span>Active collectors</span></div>
          <div><span className={`${styles.legendDot} ${styles.legendMuted}`} /><strong>—</strong><span>Other states not exposed</span></div>
          <div><span className={`${styles.legendDot} ${styles.legendDanger}`} /><strong>{formatCount(summary.incidents)}</strong><span>Open incidents</span></div>
        </div>
      </div>

      {summary.sources.length > 0 ? (
        <ul className={styles.sourceList} aria-label="Active source records">
          {summary.sources.map((collector, index) => (
            <li key={`${collector.source}-${index}`}>
              <span><Radio aria-hidden="true" size={14} />{collector.source}</span>
              <em>Active</em>
            </li>
          ))}
        </ul>
      ) : (
        <p className={styles.emptyInline}>No active source record is available.</p>
      )}
      <p className={styles.panelFootnote}>Collector identifiers and quarantined history stay private.</p>
    </section>
  );
}

function RecentActivity({ stats }: { stats: LiveDataStats }) {
  const runs = recentRunDisplay(stats);
  return (
    <section className={`${styles.panel} ${styles.activityPanel}`} aria-labelledby="activity-title">
      <div className={styles.panelHeader}>
        <div>
          <h2 id="activity-title">Recent activity</h2>
          <p className={styles.panelSubhead}>Sanitized collection-run history</p>
        </div>
        <a className={styles.panelLink} href="/api/public/live-data">
          View all <ArrowUpRight aria-hidden="true" size={15} />
        </a>
      </div>

      {runs.length > 0 ? (
        <ol className={styles.activityList}>
          {runs.map((run, index) => {
            const Icon = run.tone === "success" ? Check : run.tone === "danger" ? XCircle : run.tone === "warning" ? AlertCircle : Activity;
            return (
              <li key={`${run.createdAt}-${index}`}>
                <span className={`${styles.activityIcon} ${statusClass(run.tone)}`}><Icon aria-hidden="true" size={16} strokeWidth={2} /></span>
                <span className={styles.activityCopy}>
                  <strong>{run.title}</strong>
                  <small>{run.detail}</small>
                </span>
                <span className={styles.activityTime}>
                  {run.timestamp ? <Timestamp value={run.timestamp} /> : "Not available"}
                  <small>{run.rowCounts.collected !== null ? `${formatCount(run.rowCounts.collected)} rows` : "Rows not reported"}</small>
                </span>
              </li>
            );
          })}
        </ol>
      ) : (
        <div className={styles.emptyInline}>
          <History aria-hidden="true" size={18} />
          <span>No public collection runs are recorded.</span>
        </div>
      )}
    </section>
  );
}

function DataFreshness({ stats }: { stats: LiveDataStats }) {
  const { freshness } = stats;
  const hasTimestamp = freshness.latestTrustedObservationAt !== null || freshness.latestSuccessfulCollectionAt !== null;
  return (
    <section className={`${styles.panel} ${styles.freshnessPanel}`} aria-labelledby="freshness-title">
      <div className={styles.panelHeader}>
        <div>
          <h2 id="freshness-title">Data freshness</h2>
          <p className={styles.panelSubhead}>Public timestamps, not an age score</p>
        </div>
        <span className={styles.schemaBadge}>Schema {stats.schemaVersion}</span>
      </div>

      <div className={styles.freshnessBody}>
        <div className={`${styles.freshnessRing} ${hasTimestamp ? styles.freshnessRingRecorded : ""}`} aria-hidden="true">
          <div>
            <strong>{hasTimestamp ? "Recorded" : "—"}</strong>
            <span>{hasTimestamp ? "timestamps" : "No data"}</span>
          </div>
        </div>
        <dl className={styles.freshnessList}>
          <div><dt>Latest trusted observation</dt><dd><Timestamp value={freshness.latestTrustedObservationAt} /></dd></div>
          <div><dt>Latest successful collection</dt><dd><Timestamp value={freshness.latestSuccessfulCollectionAt} /></dd></div>
          <div><dt>Active collectors</dt><dd>{formatCount(stats.activeCollectors.length)}</dd></div>
          <div><dt>Open incidents</dt><dd>{formatCount(stats.openIncidentCount)}</dd></div>
        </dl>
      </div>
      <p className={styles.freshnessNote}><Wifi aria-hidden="true" size={15} /> Freshness targets and age bands are not part of the public stats contract.</p>
    </section>
  );
}

function TrustCallout() {
  return (
    <aside className={styles.trustCallout} aria-labelledby="trust-title">
      <span className={styles.trustIcon} aria-hidden="true"><ShieldCheck size={27} strokeWidth={1.7} /></span>
      <div>
        <strong id="trust-title">We only show data from trusted snapshots.</strong>
        <p>Candidate, quarantined, rejected, and superseded observations never become public product records.</p>
      </div>
      <Link href="/api/public/source-methodology" className={styles.trustLink}>
        Learn more about our data trust model <ArrowUpRight aria-hidden="true" size={17} />
      </Link>
    </aside>
  );
}

export function LiveDataDashboard({ stats }: { stats: LiveDataStats }) {
  const summaries = summaryCards(stats);
  const lastRunAt = stats.lastCollectionRunAt;
  const latestStatus = stats.lastCollectionRun?.status ?? stats.recentRuns[0]?.status ?? null;

  return (
    <div className={styles.page}>
      <Sidebar />
      <div className={styles.content}>
        <main className={styles.main}>
          <header className={styles.pageHeader}>
            <div className={styles.headingCopy}>
              <div className={styles.titleLine}>
                <h1>Live Data</h1>
                <span className={`${styles.healthPill} ${statusClass(statusTone(latestStatus))}`}>
                  <span className={styles.statusDot} aria-hidden="true" />
                  {latestStatus ? `Latest run · ${humanizeStatus(latestStatus)}` : "No run recorded"}
                </span>
              </div>
              <p>Operational overview of the trusted collection, validation, and publication pipeline.</p>
            </div>
            <div className={styles.headerActions}>
              <div className={styles.lastUpdated}>
                <span>Last collection event</span>
                <strong>{formatRelative(lastRunAt)}</strong>
              </div>
              <form action="/live-data" method="get">
                <button className={styles.refreshButton} type="submit" aria-label="Refresh live data" title="Refresh live data">
                  <RefreshCw aria-hidden="true" size={20} />
                </button>
              </form>
            </div>
          </header>

          <section className={styles.summaryGrid} aria-label="Live data summary">
            {summaries.map((summary) => <SummaryCard key={summary.label} {...summary} />)}
          </section>

          <div className={styles.topGrid}>
            <PipelineHealth stats={stats} />
            <SnapshotTimeline stats={stats} />
          </div>

          <div className={styles.lowerGrid}>
            <SourcesByStatus stats={stats} />
            <RecentActivity stats={stats} />
            <DataFreshness stats={stats} />
          </div>

          <TrustCallout />
        </main>
      </div>
    </div>
  );
}
