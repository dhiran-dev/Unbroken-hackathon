export const CARTO_LIGHT_STYLE_URL =
  "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json";
export const CARTO_DARK_STYLE_URL =
  "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json";

export const CITYWIDE_STOP_SOURCE_ID = "citywide-active-stops";
export const CITYWIDE_STOP_POINT_LAYER_ID = "citywide-stop-points";
export const CITYWIDE_STOP_HIT_LAYER_ID = "citywide-stop-hit-areas";
export const CITYWIDE_STOP_LABEL_LAYER_ID = "citywide-stop-labels";

const publicStyleEnvironmentKeys = {
  light: "NEXT_PUBLIC_CARTO_LIGHT_STYLE_URL",
  dark: "NEXT_PUBLIC_CARTO_DARK_STYLE_URL",
} as const;

type ThemeMode = keyof typeof publicStyleEnvironmentKeys;

export function isSafeCartoStyleUrl(
  value: string | undefined,
): value is string {
  if (!value || value.trim() !== value) return false;
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      url.hostname === "basemaps.cartocdn.com" &&
      url.username === "" &&
      url.password === "" &&
      url.port === "" &&
      url.search === "" &&
      url.hash === ""
    );
  } catch {
    return false;
  }
}

export function cartoStyleUrl(
  theme: ThemeMode,
  environment: Record<string, string | undefined> = process.env,
) {
  const override = environment[publicStyleEnvironmentKeys[theme]];
  return isSafeCartoStyleUrl(override)
    ? override
    : theme === "dark"
      ? CARTO_DARK_STYLE_URL
      : CARTO_LIGHT_STYLE_URL;
}

export const CITYWIDE_STOP_SOURCE = {
  type: "geojson",
  cluster: false,
  promoteId: "id",
} as const;

export const CITYWIDE_STOP_POINT_LAYER = {
  id: CITYWIDE_STOP_POINT_LAYER_ID,
  type: "circle",
  source: CITYWIDE_STOP_SOURCE_ID,
  paint: {
    "circle-color": "#1b4ed8",
    "circle-radius": 4,
    "circle-stroke-color": "#ffffff",
    "circle-stroke-width": 1,
    "circle-opacity": 0.92,
  },
} as const;

export const CITYWIDE_STOP_HIT_LAYER = {
  id: CITYWIDE_STOP_HIT_LAYER_ID,
  type: "circle",
  source: CITYWIDE_STOP_SOURCE_ID,
  paint: {
    "circle-radius": 12,
    "circle-opacity": 0,
    "circle-stroke-opacity": 0,
  },
} as const;

export const CITYWIDE_STOP_LABEL_LAYER = {
  id: CITYWIDE_STOP_LABEL_LAYER_ID,
  type: "symbol",
  source: CITYWIDE_STOP_SOURCE_ID,
  minzoom: 12,
  layout: {
    "text-field": ["get", "name"],
    "text-size": ["interpolate", ["linear"], ["zoom"], 12, 10, 16, 14],
    "text-offset": [0, 1.15],
    "text-anchor": "top",
  },
  paint: {
    "text-color": "#27272a",
    "text-halo-color": "#ffffff",
    "text-halo-width": 1,
  },
} as const;

export type StopMapTheme = ThemeMode;
