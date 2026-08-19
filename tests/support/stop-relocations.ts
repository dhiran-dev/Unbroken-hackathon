export const STOP_RELOCATION_SOURCE_URL =
  "https://www.sfmta.com/travel-updates/temporary-stop-relocations";

export function stopRelocationEnvelope(
  rowOverrides: Record<string, unknown> = {},
) {
  return {
    metadata: { lastCompiled: "2026-08-20T00:30:00.000Z" },
    stopRelocationData: Array.from({ length: 6 }, (_, index) => ({
      Applicant: index === 0 ? null : `Project ${index + 1}`,
      Dates: index === 0 ? "Jul 13 - Aug 28" : "Jan 1 - Dec 31",
      Hours: "7:30 am - 6:00 pm",
      Routes:
        index === 0
          ? "Inbound: 12, 14"
          : index % 2 === 0
            ? "Inbound: 12"
            : "Outbound: 14",
      Status: index === 0 ? "Closing Today" : "Currently Closed",
      StopID: `1${index + 1}001`,
      StopName: `Market Street stop ${index + 1}`,
      TemporaryStop: `the marked temporary stop ${index + 1}`,
      Workdays: "Mon; Tue; Wed; Thu; Fri",
      ...rowOverrides,
    })),
  };
}
