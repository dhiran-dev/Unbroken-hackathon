export type TransitCoverageState = "current" | "older";

function pacificDate(at: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(at);
  const value = Object.fromEntries(
    parts.map((part) => [part.type, part.value]),
  );
  return `${value.year}-${value.month}-${value.day}`;
}

export function classifyTransitCoverage(
  serviceDate: string,
  at: Date,
): TransitCoverageState {
  return serviceDate === pacificDate(at) ? "current" : "older";
}
