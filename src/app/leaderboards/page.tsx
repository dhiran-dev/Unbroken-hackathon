import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import {
  ArrowRight,
  CheckCircle2,
  ChevronRight,
  CircleSlash2,
  Clock3,
  ExternalLink,
  Info,
  Search,
  Sun,
  Trophy,
  Zap,
} from "lucide-react";

import { categoryLabel } from "@/components/pulserank/public-ui";
import { CANONICAL_CATEGORIES, type CanonicalCategory } from "@/server/ingestion/normalize";
import { toPublicProductDto, type PublicProductDto } from "@/server/products/dto";
import {
  getLeaderboard,
  getLeaderboardFacets,
  getTrustedProductsBySlugs,
  listCategories,
  type LeaderboardEntryDto,
} from "@/server/products/queries";

import {
  LEADERBOARD_BOARDS,
  isEligibleForBoard,
  type LeaderboardBoardKey,
} from "./leaderboard-model";
import { LeaderboardResults } from "./leaderboard-results";
import styles from "./leaderboards.module.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Leaderboards",
  description: "Exact caffeine rankings built from trusted source observations.",
};

type SearchParams = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function boardHref(
  board: LeaderboardBoardKey,
  filters: { category: string; serving: string; completeOnly: boolean },
): string {
  const params = new URLSearchParams({ board });
  if (filters.category) params.set("category", filters.category);
  if (filters.serving) params.set("serving", filters.serving);
  params.set("complete", filters.completeOnly ? "1" : "0");
  return `/leaderboards?${params.toString()}`;
}

function boardIcon(board: LeaderboardBoardKey) {
  if (board === "highest-total-caffeine") return Trophy;
  if (board === "highest-exact-concentration") return Zap;
  return CircleSlash2;
}

function formatRebuiltAt(value: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(value);
}

function Logo() {
  return (
    <span className={styles.logo}>
      <Image
        alt=""
        aria-hidden="true"
        height={44}
        priority
        src="/pulserank/logo.png"
        style={{ height: 38, objectFit: "contain", width: 38 }}
        width={44}
      />
      <span>Pulse<strong>Rank</strong></span>
    </span>
  );
}

function LeaderboardsHeader() {
  const nav = [
    ["/", "Home"],
    ["/explore", "Explore"],
    ["/leaderboards", "Leaderboards"],
    ["/compare", "Compare"],
    ["/my-pulse", "My Pulse"],
    ["/changes", "Changes"],
    ["/game", "Arcade"],
  ] as const;

  return (
    <header className={styles.header}>
      <div className={styles.headerInner}>
        <Link href="/" className={styles.logoLink} aria-label="PulseRank home">
          <Logo />
        </Link>
        <nav className={styles.navigation} aria-label="Primary navigation">
          {nav.map(([href, label]) => (
            <Link
              key={href}
              href={href}
              className={href === "/leaderboards" ? styles.activeNav : undefined}
              aria-current={href === "/leaderboards" ? "page" : undefined}
            >
              {label}
            </Link>
          ))}
        </nav>
        <form className={styles.search} action="/explore" method="get" role="search">
          <label className="sr-only" htmlFor="leaderboard-product-search">Search products</label>
          <input id="leaderboard-product-search" name="search" placeholder="Search products..." />
          <button type="submit" aria-label="Search products">
            <Search size={20} aria-hidden="true" />
          </button>
        </form>
        <button
          className={styles.themeButton}
          type="button"
          aria-label="Dark theme is active"
          title="PulseRank uses a dark-only theme"
          disabled
        >
          <Sun aria-hidden="true" />
        </button>
      </div>
    </header>
  );
}

export default async function LeaderboardsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const raw = await searchParams;
  const requestedBoard = first(raw.board);
  const selectedBoard = LEADERBOARD_BOARDS.find((board) => board.key === requestedBoard) ?? LEADERBOARD_BOARDS[0];
  const categoryValue = first(raw.category) ?? "";
  const category = (CANONICAL_CATEGORIES as readonly string[]).includes(categoryValue)
    ? categoryValue as CanonicalCategory
    : "";
  const serving = first(raw.serving) ?? "";
  const completeOnly = first(raw.complete) !== "0";
  const requestedLimit = Number(first(raw.limit) ?? "7");
  const visibleLimit = Number.isFinite(requestedLimit)
    ? Math.min(Math.max(Math.trunc(requestedLimit), 7), 200)
    : 7;

  const [leaderboard, categories, facets] = await Promise.all([
    getLeaderboard(selectedBoard.key, {
      limit: visibleLimit,
      category: category || undefined,
      servingForm: serving || undefined,
      completeOnly,
    }),
    listCategories(),
    getLeaderboardFacets(selectedBoard.key),
  ]);
  const products = await getTrustedProductsBySlugs(
    (leaderboard?.entries ?? []).map((entry) => entry.product.slug),
  );
  const productsBySlug = new Map(products.map((row) => {
    const product = toPublicProductDto(row);
    return [product.slug, product] as const;
  }));

  const initialRows = (leaderboard?.entries ?? [])
    .map((entry) => ({ entry, product: productsBySlug.get(entry.product.slug) }))
    .filter(
      (row): row is { entry: LeaderboardEntryDto; product: PublicProductDto } =>
        row.product !== undefined && isEligibleForBoard(selectedBoard.key, row.product),
    );

  const filters = { category, serving, completeOnly };

  return (
    <div className={styles.root}>
      <LeaderboardsHeader />
      <main className={styles.main}>
        <section className={styles.intro} aria-labelledby="leaderboards-title">
          <div>
            <h1 id="leaderboards-title">Leaderboards</h1>
            <p>
              Rankings you can trust. Exact data only.
              <span className={styles.infoIcon} title="Only exact, trusted caffeine values are ranked">
                <Info size={15} aria-hidden="true" />
              </span>
            </p>
          </div>
          <div className={styles.introActions}>
            <div className={styles.rebuildStatus}>
              <Clock3 aria-hidden="true" />
              <span>
                <small>Last rebuilt</small>
                <strong>{leaderboard ? formatRebuiltAt(leaderboard.rebuiltAt) : "No snapshot yet"}</strong>
              </span>
              <em><CheckCircle2 size={13} aria-hidden="true" /> Trusted snapshot</em>
            </div>
            <a className={styles.methodologyButton} href="/api/public/source-methodology">
              View methodology <ExternalLink size={16} aria-hidden="true" />
            </a>
          </div>
        </section>

        <div className={styles.workspace}>
          <aside className={styles.sidebar} aria-label="Leaderboard selection and eligibility">
            <nav className={styles.boardSelector} aria-label="Leaderboard boards">
              {LEADERBOARD_BOARDS.map((board) => {
                const Icon = boardIcon(board.key);
                const active = board.key === selectedBoard.key;
                return (
                  <Link
                    key={board.key}
                    href={boardHref(board.key, filters)}
                    className={active ? styles.activeBoard : undefined}
                    aria-current={active ? "page" : undefined}
                  >
                    <Icon aria-hidden="true" />
                    <span><strong>{board.label}</strong><small>{board.detail}</small></span>
                    <ChevronRight aria-hidden="true" />
                  </Link>
                );
              })}
            </nav>

            <section className={styles.eligibilityCard} aria-labelledby="eligibility-title">
              <h2 id="eligibility-title">Ranking eligibility <span>(this board)</span></h2>
              <dl className={styles.eligibilityTotals}>
                <div><dt>Eligible products</dt><dd>{facets.eligibleCount.toLocaleString("en-US")}</dd></div>
                <div><dt>Excluded products</dt><dd>{facets.excludedCount.toLocaleString("en-US")}</dd></div>
              </dl>
              <div className={styles.exclusionReasons}>
                <h3>Exclusion reasons</h3>
                {facets.reasons.length > 0 ? (
                  <ul>
                    {facets.reasons.map((reason) => (
                      <li key={reason.label}>
                        <span><i aria-hidden="true" /> {reason.label}</span>
                        <strong>{reason.count.toLocaleString("en-US")}</strong>
                      </li>
                    ))}
                  </ul>
                ) : <p>No trusted products are excluded from this board.</p>}
              </div>
              <a href="/api/public/source-methodology" className={styles.learnLink}>
                Learn how rankings work <ArrowRight size={17} aria-hidden="true" />
              </a>
            </section>
          </aside>

          <section className={styles.boardContent} aria-labelledby="board-heading">
            <h2 id="board-heading" className="sr-only">{selectedBoard.label}</h2>
            <LeaderboardResults
              board={selectedBoard.key}
              category={category}
              serving={serving}
              completeOnly={completeOnly}
              categories={categories.map((item) => ({ value: item.category, label: `${categoryLabel(item.category)} · ${item.productCount}` }))}
              servingForms={facets.servingForms.map((form) => ({
                value: form,
                label: form.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase()),
              }))}
              initialRows={initialRows}
              initialNextCursor={leaderboard?.nextCursor ?? null}
              pageSize={visibleLimit}
              hasSnapshot={leaderboard !== null}
            />
          </section>
        </div>
      </main>
    </div>
  );
}
