export const ACCESSIBILITY_SOURCE_URL =
  "https://www.sfmta.com/travel-transit-updates?field_transit_type_disrupted_value=Accessibility";

export function accessibilityAdvisoryRows(
  overrides: Record<string, unknown> = {},
) {
  return Array.from({ length: 11 }, (_, index) => {
    const detailUrl =
      index === 0
        ? "https://www.sfmta.com/travel-updates/accessibility-%E2%80%93-change-1"
        : `https://www.sfmta.com/travel-updates/accessibility-change-${index + 1}`;
    return {
      body_text: `Use the marked boarding area for advisory ${index + 1}.`,
      detail_url: detailUrl,
      input: { url: ACCESSIBILITY_SOURCE_URL },
      neighborhoods_affected: ["Downtown"],
      product_page_url: detailUrl,
      relocation_rows: [],
      routes_affected: index % 2 === 0 ? [`Route ${index + 1}`] : [],
      scraped_at: "2026-08-19T17:30:00.000Z",
      service_affected: ["Accessibility"],
      source_url: detailUrl,
      stops_affected: index % 2 === 0 ? [] : [`Stop ${index + 1}`],
      title: `Accessibility change ${index + 1}`,
      ...overrides,
    };
  });
}
