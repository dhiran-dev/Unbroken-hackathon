const pacificDateTime = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Los_Angeles",
  month: "short",
  day: "numeric",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZoneName: "short",
});

export function formatPacific(value: Date | null) {
  return value ? pacificDateTime.format(value) : "Not available";
}

export function formatAge(seconds: number) {
  const safeSeconds = Math.max(0, Math.floor(seconds));
  if (safeSeconds < 60) return "less than a minute old";
  if (safeSeconds < 60 * 60) {
    const minutes = Math.floor(safeSeconds / 60);
    return `${minutes} minute${minutes === 1 ? "" : "s"} old`;
  }
  if (safeSeconds < 24 * 60 * 60) {
    const hours = Math.floor(safeSeconds / (60 * 60));
    return `${hours} hour${hours === 1 ? "" : "s"} old`;
  }
  const days = Math.floor(safeSeconds / (24 * 60 * 60));
  return `${days} day${days === 1 ? "" : "s"} old`;
}

export function formatDuration(start: Date | null, end: Date | null) {
  if (!start || !end) return "—";
  const milliseconds = Math.max(0, end.getTime() - start.getTime());
  if (milliseconds < 1_000) return `${milliseconds} ms`;
  return `${(milliseconds / 1_000).toFixed(1)} s`;
}
