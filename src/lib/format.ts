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

export function formatDuration(start: Date | null, end: Date | null) {
  if (!start || !end) return "—";
  const milliseconds = Math.max(0, end.getTime() - start.getTime());
  if (milliseconds < 1_000) return `${milliseconds} ms`;
  return `${(milliseconds / 1_000).toFixed(1)} s`;
}
