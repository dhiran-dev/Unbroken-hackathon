import type { Metadata } from "next";
import { ArrowUpRight, BarChart3, Check, SlidersHorizontal } from "lucide-react";

import { CANONICAL_CATEGORIES } from "@/server/ingestion/normalize";
import { getLeaderboard, listCategories } from "@/server/products/queries";
import {
  EmptyState,
  PublicHeader,
  categoryLabel,
  formatNumber,
} from "@/components/pulserank/public-ui";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Leaderboards",
  description: "Transparent caffeine rankings built from trusted observations.",
};

const BOARDS = [
  { key: "highest-total-caffeine", label: "Highest total caffeine", detail: "mg per listed serving" },
  { key: "highest-exact-concentration", label: "Highest exact concentration", detail: "mg per 100 ml" },
  { key: "caffeine-free", label: "Caffeine-free", detail: "explicit zero only" },
] as const;

type SearchParams = Record<string, string | string[] | undefined>;
function first(value: string | string[] | undefined): string | undefined { return Array.isArray(value) ? value[0] : value; }

export default async function LeaderboardsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const raw = await searchParams;
  const boardKey = first(raw.board) ?? BOARDS[0].key;
  const selectedBoard = BOARDS.find((board) => board.key === boardKey) ?? BOARDS[0];
  const categoryValue = first(raw.category);
  const category = (CANONICAL_CATEGORIES as readonly string[]).includes(categoryValue ?? "") ? categoryValue as (typeof CANONICAL_CATEGORIES)[number] : undefined;
  const [leaderboard, categories] = await Promise.all([getLeaderboard(selectedBoard.key, 100, category), listCategories()]);

  return (
    <div className="pr-app">
      <PublicHeader active="/leaderboards" />
      <main className="pr-shell pr-main">
        <div className="pr-page-heading"><p className="pr-eyebrow">Ranked from trusted snapshots</p><h1>See what rises.</h1><p className="pr-page-description">Three boards, one source, explicit qualifiers. Every entry is a product that passed the board’s deterministic eligibility gate.</p></div>
        <div className="pr-board-tabs">{BOARDS.map((board) => <a key={board.key} href={`/leaderboards?board=${board.key}${category ? `&category=${category}` : ""}`} className={`pr-board-tab${board.key === selectedBoard.key ? " is-active" : ""}`}><BarChart3 size={14} aria-hidden="true" /> {board.label}</a>)}</div>
        <div className="pr-board-layout"><section>
          <div className="pr-results-meta"><span>{selectedBoard.detail}</span><form action="/leaderboards" method="get"><input type="hidden" name="board" value={selectedBoard.key} /><label className="pr-inline-filter"><SlidersHorizontal size={13} aria-hidden="true" /><select name="category" defaultValue={category ?? ""}><option value="">All categories</option>{categories.map((item) => <option key={item.category} value={item.category}>{categoryLabel(item.category)} · {item.productCount}</option>)}</select><button className="pr-button pr-button-ghost" type="submit">Apply</button></label></form></div>
          {leaderboard && leaderboard.entries.length > 0 ? <div className="pr-table-wrap"><table className="pr-data-table"><thead><tr><th>Rank</th><th>Product</th><th>Metric</th><th>Qualifier</th><th>Eligibility</th></tr></thead><tbody>{leaderboard.entries.map((entry) => <tr key={entry.productId}><td><strong className="pr-rank">{String(entry.rank).padStart(2, "0")}</strong></td><td><a href={`/products/${entry.product.slug}`} className="pr-table-product"><span><strong>{entry.product.name}</strong><small>{categoryLabel(entry.product.category)}</small></span><ArrowUpRight size={14} aria-hidden="true" /></a></td><td><strong>{formatNumber(entry.metricValue)} {selectedBoard.key === "highest-exact-concentration" ? "mg/100 ml" : "mg"}</strong></td><td><span className="pr-eligibility-chip is-eligible">{entry.eligibilityFlags.join(" · ")}</span></td><td><span className="pr-eligibility-chip is-eligible"><Check size={12} /> Eligible</span></td></tr>)}</tbody></table></div> : <EmptyState title="This board has no eligible entries" description="The board is backed by an immutable trusted snapshot. It will populate only when source observations meet its exact rules." action="Inspect live data" />}
        </section><aside className="pr-methodology"><h2>Board method</h2><p>{selectedBoard.detail}. Exclusions stay explainable; no confidence score or health index is calculated.</p>{leaderboard ? <dl><div><dt>Snapshot rebuilt</dt><dd>{leaderboard.rebuiltAt.toLocaleString()}</dd></div><div><dt>Eligible entries</dt><dd>{leaderboard.eligibleCount}</dd></div><div><dt>Excluded trusted products</dt><dd>{leaderboard.excludedCount}</dd></div><div><dt>Schema</dt><dd>v1.0</dd></div></dl> : <p>No rebuild has produced a public snapshot yet.</p>}<a href="/api/public/source-methodology" className="pr-button pr-button-ghost">Read source policy <ArrowUpRight size={14} /></a></aside></div>
      </main>
    </div>
  );
}
