import type { LiveDataStats } from "@/server/products/queries";

export type RunTone = "success" | "warning" | "danger" | "muted";

export type LiveSummary = {
  label: string;
  value: string;
  detail: string;
  accent: "violet" | "blue" | "teal" | "green" | "amber";
  unavailable?: boolean;
};

export type PipelineStage = {
  label: string;
  status: string;
  detail: string;
  tone: RunTone;
};

export type TimelinePoint = {
  x: number;
  y: number;
  value: number;
  timestamp: string;
  label: string;
};

const SUCCESS_STATUSES = new Set(["complete", "completed", "passed", "succeeded", "validated"]);
const DANGER_STATUS_PARTS = ["fail", "error", "reject", "timeout", "timed_out"];
const ACTIVE_STATUS_PARTS = ["queued", "running", "processing", "pending", "waiting", "submitted"];

export function formatCount(value: number): string {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(value);
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return "Not available";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Not available";
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

export function formatShortDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown";
  return new Intl.DateTimeFormat("en-US", {
    day: "2-digit",
    month: "short",
  }).format(date);
}

export function formatRelative(value: string | null | undefined, now = new Date()): string {
  if (!value) return "No run recorded";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Not available";

  const seconds = Math.round((now.getTime() - date.getTime()) / 1000);
  if (seconds < 0) {
    const futureSeconds = Math.abs(seconds);
    if (futureSeconds < 60) return "In under a minute";
    const futureMinutes = Math.floor(futureSeconds / 60);
    if (futureMinutes < 60) return `In ${futureMinutes} min`;
    const futureHours = Math.floor(futureMinutes / 60);
    if (futureHours < 24) return `In ${futureHours} hr`;
    const futureDays = Math.floor(futureHours / 24);
    return `In ${futureDays} day${futureDays === 1 ? "" : "s"}`;
  }
  if (seconds < 60) return "Less than a minute ago";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

export function humanizeStatus(value: string | null | undefined): string {
  if (!value) return "Not available";
  return value
    .replaceAll("_", " ")
    .replaceAll("-", " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

export function statusTone(value: string | null | undefined): RunTone {
  if (!value) return "muted";
  const normalized = value.toLowerCase();
  if (SUCCESS_STATUSES.has(normalized)) return "success";
  if (DANGER_STATUS_PARTS.some((part) => normalized.includes(part))) return "danger";
  if (ACTIVE_STATUS_PARTS.some((part) => normalized.includes(part))) return "warning";
  return "muted";
}

export function summaryCards(stats: LiveDataStats): LiveSummary[] {
  const activeCount = stats.activeCollectors.length;
  const incidentCount = stats.openIncidentCount;
  return [
    {
      label: "Products tracked",
      value: formatCount(stats.trustedProductCount),
      detail: "trusted products",
      accent: "violet",
    },
    {
      label: "Trusted snapshots",
      value: formatCount(stats.observationCounts.trusted),
      detail: "public observations",
      accent: "blue",
    },
    {
      label: "Sources active",
      value: formatCount(activeCount),
      detail: activeCount === 1 ? "registered collector" : "registered collectors",
      accent: "teal",
    },
    {
      label: "Open incidents",
      value: formatCount(incidentCount),
      detail: incidentCount === 0 ? "none currently open" : "operator attention",
      accent: incidentCount === 0 ? "green" : "amber",
    },
    {
      label: "Quality score",
      value: "Not published",
      detail: "no derived score in public stats",
      accent: "amber",
      unavailable: true,
    },
  ];
}

function stageDetail(
  stage: string | undefined,
  value: number | null | undefined,
  valueLabel: string,
): string {
  if (typeof value === "number") return `${formatCount(value)} ${valueLabel}`;
  if (!stage || stage === "not_applicable") return "No public result";
  return "Count not reported";
}

export function pipelineStages(stats: LiveDataStats): PipelineStage[] {
  const run = stats.recentRuns[0];
  const stages = run?.stages;
  return [
    {
      label: "Collect",
      status: humanizeStatus(stages?.collect),
      detail: stageDetail(stages?.collect, run?.rowCounts.collected, "rows"),
      tone: statusTone(stages?.collect),
    },
    {
      label: "Validate",
      status: humanizeStatus(stages?.validate),
      detail: stageDetail(stages?.validate, run?.rowCounts.warnings, "warnings"),
      tone: statusTone(stages?.validate),
    },
    {
      label: "Normalize",
      status: humanizeStatus(stages?.ingest),
      detail: stageDetail(stages?.ingest, run?.rowCounts.parsed, "parsed"),
      tone: statusTone(stages?.ingest),
    },
    {
      label: "Rank",
      status: humanizeStatus(stages?.rebuild),
      detail: stages?.rebuild ? humanizeStatus(stages.rebuild) : "No public result",
      tone: statusTone(stages?.rebuild),
    },
    {
      label: "Publish",
      status: humanizeStatus(stages?.promote),
      detail: stageDetail(stages?.promote, run?.rowCounts.promoted, "promoted"),
      tone: statusTone(stages?.promote),
    },
  ];
}

export function pipelineSummary(stats: LiveDataStats): { label: string; tone: RunTone } {
  const run = stats.recentRuns[0];
  if (!run) return { label: "No collection run recorded", tone: "muted" };
  const stageValues = Object.values(run.stages);
  if (stageValues.some((stage) => statusTone(stage) === "danger")) {
    return { label: "Latest run needs attention", tone: "danger" };
  }
  if (stageValues.every((stage) => statusTone(stage) === "success" || stage === "not_applicable")) {
    return { label: "Latest run completed", tone: "success" };
  }
  return { label: `Latest run: ${humanizeStatus(run.status)}`, tone: statusTone(run.status) };
}

export function chartPoints(stats: LiveDataStats): TimelinePoint[] {
  const candidates = stats.recentRuns
    .map((run) => ({
      value: run.rowCounts.collected,
      timestamp: run.finishedAt ?? run.startedAt ?? run.createdAt,
    }))
    .filter((point): point is { value: number; timestamp: string } =>
      typeof point.value === "number" && point.timestamp !== null,
    )
    .sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp))
    .slice(-7);

  if (candidates.length === 0) return [];
  const max = Math.max(...candidates.map((point) => point.value));
  const min = Math.min(...candidates.map((point) => point.value));
  const range = max - min || Math.max(max, 1);
  const width = 440;
  const top = 16;
  const bottom = 136;
  const usableHeight = bottom - top;
  const divisor = Math.max(candidates.length - 1, 1);

  return candidates.map((point, index) => ({
    x: 18 + (index / divisor) * (width - 36),
    y: bottom - ((point.value - min) / range) * usableHeight,
    value: point.value,
    timestamp: point.timestamp,
    label: formatShortDate(point.timestamp),
  }));
}

export function chartPath(points: TimelinePoint[]): string {
  return points.map((point, index) => `${index === 0 ? "M" : "L"}${point.x.toFixed(2)} ${point.y.toFixed(2)}`).join(" ");
}

export function runStateCounts(stats: LiveDataStats): {
  completed: number;
  inProgress: number;
  needsAttention: number;
  unknown: number;
} {
  return stats.recentRuns.reduce(
    (counts, run) => {
      const tone = statusTone(run.status);
      if (tone === "success") counts.completed += 1;
      else if (tone === "danger") counts.needsAttention += 1;
      else if (tone === "warning") counts.inProgress += 1;
      else counts.unknown += 1;
      return counts;
    },
    { completed: 0, inProgress: 0, needsAttention: 0, unknown: 0 },
  );
}

export function triggerLabel(trigger: string): string {
  const normalized = trigger.replace(/^job:/, "").replaceAll(".", " / ").replaceAll("_", " ");
  return normalized.replace(/\b\w/g, (character) => character.toUpperCase());
}

export function recentRunDisplay(stats: LiveDataStats) {
  return stats.recentRuns.slice(0, 4).map((run) => ({
    ...run,
    title: `Collection run · ${humanizeStatus(run.status)}`,
    detail: triggerLabel(run.trigger),
    timestamp: run.finishedAt ?? run.startedAt ?? run.createdAt,
    tone: statusTone(run.status),
  }));
}

export function sourceStatusSummary(stats: LiveDataStats) {
  return {
    activeCount: stats.activeCollectors.length,
    sources: stats.activeCollectors,
    incidents: stats.openIncidentCount,
  };
}
