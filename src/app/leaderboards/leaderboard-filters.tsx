"use client";

import { Download, SlidersHorizontal } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo } from "react";

import styles from "./leaderboards.module.css";

export type LeaderboardExportRow = {
  rank: number;
  product: string;
  category: string;
  metric: string;
  serving: string;
  observedAt: string;
  source: string;
};

type FilterOption = { value: string; label: string };

function csvCell(value: string | number): string {
  return `"${String(value).replaceAll('"', '""')}"`;
}

export function LeaderboardFilters({
  board,
  category,
  serving,
  completeOnly,
  categories,
  servingForms,
  exportRows,
}: {
  board: string;
  category: string;
  serving: string;
  completeOnly: boolean;
  categories: FilterOption[];
  servingForms: FilterOption[];
  exportRows: LeaderboardExportRow[];
}) {
  const router = useRouter();
  const toggleHref = useMemo(() => {
    const params = new URLSearchParams({ board });
    if (category) params.set("category", category);
    if (serving) params.set("serving", serving);
    params.set("complete", completeOnly ? "0" : "1");
    return `/leaderboards?${params.toString()}`;
  }, [board, category, completeOnly, serving]);

  function submitSelect(name: "category" | "serving", value: string) {
    const params = new URLSearchParams({ board });
    const nextCategory = name === "category" ? value : category;
    const nextServing = name === "serving" ? value : serving;
    if (nextCategory) params.set("category", nextCategory);
    if (nextServing) params.set("serving", nextServing);
    params.set("complete", completeOnly ? "1" : "0");
    router.push(`/leaderboards?${params.toString()}`);
  }

  function exportCsv() {
    const headers = [
      "Rank",
      "Product",
      "Category",
      "Metric",
      "Serving",
      "Observed",
      "Source",
    ];
    const lines = [
      headers.map(csvCell).join(","),
      ...exportRows.map((row) =>
        [
          row.rank,
          row.product,
          row.category,
          row.metric,
          row.serving,
          row.observedAt,
          row.source,
        ]
          .map(csvCell)
          .join(","),
      ),
    ];
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `pulserank-${board}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className={styles.filters} aria-label="Leaderboard filters">
      <span className={styles.mobileFilterLabel}>
        <SlidersHorizontal size={16} aria-hidden="true" /> Filters
      </span>
      <label className={styles.selectControl}>
        <span className="sr-only">Filter by category</span>
        <select
          value={category}
          onChange={(event) => submitSelect("category", event.target.value)}
        >
          <option value="">All categories</option>
          {categories.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      <label className={styles.selectControl}>
        <span className="sr-only">Filter by serving type</span>
        <select
          value={serving}
          onChange={(event) => submitSelect("serving", event.target.value)}
        >
          <option value="">All serving types</option>
          {servingForms.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      <button
        className={`${styles.completeToggle}${completeOnly ? ` ${styles.isActive}` : ""}`}
        type="button"
        onClick={() => router.push(toggleHref)}
        aria-pressed={completeOnly}
      >
        <span className={styles.switchTrack} aria-hidden="true">
          <span />
        </span>
        Complete data only
      </button>
      <button
        className={styles.exportButton}
        type="button"
        onClick={exportCsv}
        disabled={exportRows.length === 0}
      >
        <Download size={17} aria-hidden="true" /> Export
      </button>
    </div>
  );
}
