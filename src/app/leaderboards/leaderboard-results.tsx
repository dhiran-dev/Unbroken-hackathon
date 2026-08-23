"use client";

import {
  ArrowDown,
  Bookmark,
  ExternalLink,
  Sparkles,
} from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { categoryLabel, formatNumber } from "@/components/pulserank/public-ui";
import type { PublicProductDto } from "@/server/products/dto";

import {
  LeaderboardFilters,
  type LeaderboardExportRow,
} from "./leaderboard-filters";
import {
  isEligibleForBoard,
  servingText,
  type LeaderboardBoardKey,
} from "./leaderboard-model";
import { LeaderboardProductImage } from "./leaderboard-product-image";
import {
  emptyLeaderboardCopy,
  mergeLeaderboardRows,
  sourceForDisplay,
  type LeaderboardClientRow,
} from "./leaderboard-results-model";
import styles from "./leaderboards.module.css";

type FilterOption = { value: string; label: string };

type LeaderboardResultsProps = {
  board: LeaderboardBoardKey;
  category: string;
  serving: string;
  completeOnly: boolean;
  categories: FilterOption[];
  servingForms: FilterOption[];
  initialRows: LeaderboardClientRow[];
  initialNextCursor: string | null;
  pageSize: number;
  hasSnapshot: boolean;
};

function metricText(board: LeaderboardBoardKey, value: number): string {
  return board === "highest-exact-concentration"
    ? `${formatNumber(value)} mg/100 ml`
    : `${formatNumber(value)} mg`;
}

function formatObservationDate(value: string): string {
  return new Intl.DateTimeFormat("en-US", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(value));
}

export function LeaderboardResults({
  board,
  category,
  serving,
  completeOnly,
  categories,
  servingForms,
  initialRows,
  initialNextCursor,
  pageSize,
  hasSnapshot,
}: LeaderboardResultsProps) {
  const [rows, setRows] = useState(initialRows);
  const [nextCursor, setNextCursor] = useState(initialNextCursor);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const exportRows: LeaderboardExportRow[] = rows.map(({ entry, product }) => {
    const servingValue = servingText(product);
    return {
      rank: entry.rank,
      product: product.name,
      category: categoryLabel(product.category),
      metric: metricText(board, entry.metricValue),
      serving: `${servingValue.primary} ${servingValue.secondary}`,
      observedAt: product.observedAt,
      source: sourceForDisplay(product.sourceUrl),
    };
  });

  async function loadMore() {
    if (!nextCursor || loading) return;
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        board,
        limit: String(pageSize),
        cursor: nextCursor,
        complete: completeOnly ? "1" : "0",
      });
      if (category) params.set("category", category);
      if (serving) params.set("serving", serving);
      const response = await fetch(`/api/public/leaderboards?${params.toString()}`, {
        headers: { Accept: "application/json" },
      });
      if (!response.ok) throw new Error("Unable to load more rankings.");
      const payload = (await response.json()) as {
        nextCursor?: string | null;
        entries?: LeaderboardClientRow["entry"][];
        products?: Record<string, PublicProductDto>;
      };
      const nextRows = (payload.entries ?? [])
        .map((entry) => ({
          entry,
          product: payload.products?.[entry.product.slug],
        }))
        .filter(
          (row): row is LeaderboardClientRow =>
            row.product !== undefined && isEligibleForBoard(board, row.product),
        );
      setRows((current) => mergeLeaderboardRows(current, nextRows));
      setNextCursor(payload.nextCursor ?? null);
    } catch {
      setError("Unable to load more rankings. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  const emptyCopy = emptyLeaderboardCopy(hasSnapshot);

  return (
    <>
      <LeaderboardFilters
        board={board}
        category={category}
        serving={serving}
        completeOnly={completeOnly}
        categories={categories}
        servingForms={servingForms}
        exportRows={exportRows}
      />

      <p className={styles.scrollerLabel} id="leaderboard-scroll-label">
        Swipe horizontally to inspect every evidence column.
      </p>
      {rows.length > 0 ? (
        <div
          className={styles.tableScroller}
          role="region"
          aria-labelledby="board-heading leaderboard-scroll-label"
          tabIndex={0}
        >
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col">#</th>
                <th scope="col">Product</th>
                <th scope="col">Category</th>
                <th scope="col">{board === "highest-exact-concentration" ? "Concentration" : "Total caffeine"}<small>{board === "highest-exact-concentration" ? "mg / 100 ml" : "mg / serving"}</small></th>
                <th scope="col">Serving size</th>
                <th scope="col" className={styles.sortedColumn}>Observed <ArrowDown size={14} aria-hidden="true" /></th>
                <th scope="col">Source</th>
                <th scope="col"><span className="sr-only">Product actions</span></th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ entry, product }) => {
                const servingValue = servingText(product);
                return (
                  <tr key={entry.productId}>
                    <td className={styles.rank}><span className={entry.rank <= 3 ? styles.topRank : undefined}>{entry.rank}</span></td>
                    <td>
                      <Link href={`/products/${product.slug}`} className={styles.productLink}>
                        <LeaderboardProductImage slug={product.slug} name={product.name} />
                        <span><strong>{product.name}</strong><small>Exact observation</small></span>
                      </Link>
                    </td>
                    <td><span className={styles.categoryChip}>{categoryLabel(product.category)}</span></td>
                    <td className={styles.metric}>{metricText(board, entry.metricValue)}</td>
                    <td className={styles.servingCell}><span>{servingValue.primary}</span><small>{servingValue.secondary}</small></td>
                    <td><time dateTime={product.observedAt}>{formatObservationDate(product.observedAt)}</time></td>
                    <td>
                      {product.sourceUrl ? (
                        <a className={styles.sourceLink} href={product.sourceUrl} target="_blank" rel="noreferrer noopener">
                          {product.sourceAttribution}<ExternalLink size={12} aria-hidden="true" />
                        </a>
                      ) : (
                        <span className={styles.sourceUnavailable}>{sourceForDisplay(product.sourceUrl)}</span>
                      )}
                    </td>
                    <td>
                      <Link className={styles.rowAction} href={`/products/${product.slug}`} aria-label={`Open ${product.name} Product Passport`}>
                        <Bookmark aria-hidden="true" />
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className={styles.tableFooter}>
            {nextCursor ? (
              <button className={styles.loadMoreButton} type="button" onClick={loadMore} disabled={loading}>
                {loading ? "Loading…" : "Load more"} <ArrowDown size={15} aria-hidden="true" />
              </button>
            ) : (
              <span>Showing {rows.length.toLocaleString("en-US")} exact eligible {rows.length === 1 ? "product" : "products"}</span>
            )}
            <Sparkles size={14} aria-hidden="true" />
          </div>
          {error ? <p className={styles.loadMoreError} role="alert">{error}</p> : null}
        </div>
      ) : (
        <div className={styles.emptyState}>
          <span aria-hidden="true">∅</span>
          <h3>{emptyCopy.title}</h3>
          <p>{emptyCopy.description}</p>
          {hasSnapshot ? <a href={`/leaderboards?board=${board}&complete=1`}>Reset filters</a> : null}
        </div>
      )}
    </>
  );
}
