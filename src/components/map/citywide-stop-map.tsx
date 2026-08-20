"use client";

import "maplibre-gl/dist/maplibre-gl.css";

import { useTheme } from "next-themes";
import { useEffect, useMemo, useRef, useState } from "react";
import type {
  AddLayerObject,
  GeoJSONSource,
  Map as MapLibreMap,
  MapLayerMouseEvent,
} from "maplibre-gl";

import { isStopMapFeedHash } from "@/domain/transit/stop-map";
import {
  CARTO_DARK_STYLE_URL,
  CARTO_LIGHT_STYLE_URL,
  CITYWIDE_STOP_HIT_LAYER,
  CITYWIDE_STOP_HIT_LAYER_ID,
  CITYWIDE_STOP_LABEL_LAYER,
  CITYWIDE_STOP_LABEL_LAYER_ID,
  CITYWIDE_STOP_POINT_LAYER,
  CITYWIDE_STOP_POINT_LAYER_ID,
  CITYWIDE_STOP_SOURCE,
  CITYWIDE_STOP_SOURCE_ID,
  cartoStyleUrl,
  type StopMapTheme,
} from "./stop-map-config";
import { usePrefersReducedMotion } from "./use-prefers-reduced-motion";
import {
  normalizeStopMapGeoJson,
  type PublicStopFeatureCollection,
} from "./stop-map-geojson";

export const CITYWIDE_STOP_MAP_FAILURE =
  "Map is unavailable. Use the trip steps instead.";

type StopFeatureCollection = PublicStopFeatureCollection;

export type CitywideStopMapProps = {
  feedHash: string;
  theme?: StopMapTheme;
  className?: string;
  height?: number | string;
};

function installStopLayers(map: MapLibreMap, document: StopFeatureCollection) {
  if (!map.getSource(CITYWIDE_STOP_SOURCE_ID)) {
    map.addSource(CITYWIDE_STOP_SOURCE_ID, {
      ...CITYWIDE_STOP_SOURCE,
      data: document,
    });
  } else {
    const source = map.getSource<GeoJSONSource>(CITYWIDE_STOP_SOURCE_ID);
    if (source) {
      void source.setData(document);
    }
  }

  if (!map.getLayer(CITYWIDE_STOP_POINT_LAYER_ID)) {
    map.addLayer(CITYWIDE_STOP_POINT_LAYER as unknown as AddLayerObject);
  }
  if (!map.getLayer(CITYWIDE_STOP_HIT_LAYER_ID)) {
    map.addLayer(CITYWIDE_STOP_HIT_LAYER as unknown as AddLayerObject);
  }
  if (!map.getLayer(CITYWIDE_STOP_LABEL_LAYER_ID)) {
    map.addLayer(CITYWIDE_STOP_LABEL_LAYER as unknown as AddLayerObject);
  }
}

function CitywideStopMapInstance({
  feedHash,
  theme,
  className,
  height = 420,
}: CitywideStopMapProps) {
  const { resolvedTheme } = useTheme();
  const reducedMotion = usePrefersReducedMotion();
  const initialReducedMotionRef = useRef(reducedMotion);
  const themeMode: StopMapTheme =
    theme ?? (resolvedTheme === "dark" ? "dark" : "light");
  const styleUrl = useMemo(
    () =>
      cartoStyleUrl(themeMode, {
        NEXT_PUBLIC_CARTO_LIGHT_STYLE_URL:
          process.env.NEXT_PUBLIC_CARTO_LIGHT_STYLE_URL,
        NEXT_PUBLIC_CARTO_DARK_STYLE_URL:
          process.env.NEXT_PUBLIC_CARTO_DARK_STYLE_URL,
      }),
    [themeMode],
  );
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const dataRef = useRef<StopFeatureCollection | null>(null);
  const styleRef = useRef(styleUrl);
  const initialStyleUrlRef = useRef(styleUrl);
  const [document, setDocument] = useState<StopFeatureCollection | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [selectedStopId, setSelectedStopId] = useState<string | null>(null);
  const [textAlternativeOpen, setTextAlternativeOpen] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    let mounted = true;

    if (!isStopMapFeedHash(feedHash)) {
      queueMicrotask(() => {
        if (mounted) setFailed(true);
      });
      return () => controller.abort();
    }

    void fetch(
      `/api/public/map/stops.geojson?v=${encodeURIComponent(feedHash)}`,
      {
        signal: controller.signal,
        cache: "force-cache",
      },
    )
      .then(async (response) => {
        if (!response.ok) throw new Error("stop-map-unavailable");
        const contentType = response.headers
          .get("content-type")
          ?.split(";", 1)[0]
          ?.trim()
          .toLowerCase();
        if (contentType !== "application/geo+json") {
          throw new Error("stop-map-content-type");
        }
        const value: unknown = await response.json();
        const normalized = normalizeStopMapGeoJson(value);
        if (!normalized) throw new Error("stop-map-invalid");
        return normalized;
      })
      .then((value) => {
        if (!mounted) return;
        dataRef.current = value;
        setDocument(value);
        const map = mapRef.current;
        if (map?.isStyleLoaded()) installStopLayers(map, value);
      })
      .catch(() => {
        if (mounted) setFailed(true);
      });

    return () => {
      mounted = false;
      controller.abort();
    };
  }, [feedHash]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    if (!isStopMapFeedHash(feedHash)) return;
    let disposed = false;
    let map: MapLibreMap | null = null;
    let cleanupMap: (() => void) | undefined;

    void import("maplibre-gl")
      .then(({ Map }) => {
        if (disposed) return;
        map = new Map({
          container,
          style: initialStyleUrlRef.current,
          center: [-122.42, 37.77],
          zoom: 11,
          cooperativeGestures: true,
          fadeDuration: initialReducedMotionRef.current ? 0 : 300,
          attributionControl: {
            compact: false,
            customAttribution: "© CARTO, © OpenStreetMap contributors",
          },
        });
        mapRef.current = map;
        const onLoad = () => {
          if (disposed || !map) return;
          setMapReady(true);
          if (dataRef.current) installStopLayers(map, dataRef.current);
        };
        const onError = () => {
          if (!disposed) setFailed(true);
        };
        const onStopClick = (event: MapLayerMouseEvent) => {
          const id = event.features?.[0]?.properties?.id;
          if (typeof id === "string") setSelectedStopId(id);
        };
        map.on("load", onLoad);
        map.on("error", onError);
        map.on("click", CITYWIDE_STOP_HIT_LAYER_ID, onStopClick);
        if (map.isStyleLoaded()) onLoad();

        const cleanup = () => {
          map?.off("load", onLoad);
          map?.off("error", onError);
          map?.off("click", CITYWIDE_STOP_HIT_LAYER_ID, onStopClick);
          map?.remove();
          map = null;
          mapRef.current = null;
          cleanupMap = undefined;
        };
        cleanupMap = cleanup;
      })
      .catch(() => {
        if (!disposed) setFailed(true);
      });

    return () => {
      disposed = true;
      cleanupMap?.();
    };
  }, [feedHash]);

  useEffect(() => {
    initialStyleUrlRef.current = styleUrl;
    const map = mapRef.current;
    if (!map || !mapReady || styleRef.current === styleUrl) return;
    styleRef.current = styleUrl;
    let disposed = false;
    const onStyleLoad = () => {
      if (!disposed && dataRef.current) installStopLayers(map, dataRef.current);
    };
    map.on("style.load", onStyleLoad);
    map.setStyle(styleUrl, { diff: true });
    return () => {
      disposed = true;
      map.off("style.load", onStyleLoad);
    };
  }, [mapReady, styleUrl]);

  const selectedStop = document?.features.find(
    (feature) => feature.id === selectedStopId,
  );

  return (
    <section
      aria-label="Citywide active Muni stop map"
      className={className}
      data-map-style={styleUrl}
      data-stop-cluster="false"
      data-stop-count={document?.features.length ?? 0}
      data-stop-feed-hash={feedHash}
    >
      <div
        ref={containerRef}
        aria-busy={!mapReady && !failed}
        className="relative w-full overflow-hidden rounded-xl border bg-muted/20"
        style={{ height }}
      />
      {failed && (
        <p
          aria-live="polite"
          className="mt-3 text-sm text-muted-foreground"
          role="status"
        >
          {CITYWIDE_STOP_MAP_FAILURE}
        </p>
      )}
      {selectedStop && (
        <p aria-live="polite" className="mt-3 text-sm" role="status">
          Selected stop: {selectedStop.properties.name}
        </p>
      )}
      <details
        className="mt-3 rounded-xl border p-4"
        onToggle={(event) => setTextAlternativeOpen(event.currentTarget.open)}
        open={textAlternativeOpen}
      >
        <summary className="cursor-pointer font-medium">
          Text alternative
        </summary>
        <p className="mt-2 text-sm text-muted-foreground">
          Every active Muni stop is shown as an individual map point. Use this
          list to review stops without the map canvas.
        </p>
        {textAlternativeOpen && document && (
          <ol
            className="mt-3 max-h-72 space-y-1 overflow-auto text-sm"
            aria-label="Active Muni stops"
          >
            {document.features.map((feature) => (
              <li key={feature.id}>
                <button
                  className="text-left text-primary hover:underline"
                  onClick={() => setSelectedStopId(feature.id)}
                  type="button"
                >
                  {feature.properties.name}
                  {feature.properties.code
                    ? ` (${feature.properties.code})`
                    : ""}
                </button>
              </li>
            ))}
          </ol>
        )}
      </details>
    </section>
  );
}

export function CitywideStopMap(props: CitywideStopMapProps) {
  return <CitywideStopMapInstance key={props.feedHash} {...props} />;
}

export default CitywideStopMap;

export {
  normalizeStopMapGeoJson,
  type PublicStopFeatureCollection,
} from "./stop-map-geojson";

export {
  CARTO_DARK_STYLE_URL,
  CARTO_LIGHT_STYLE_URL,
  CITYWIDE_STOP_HIT_LAYER,
  CITYWIDE_STOP_LABEL_LAYER,
  CITYWIDE_STOP_POINT_LAYER,
  CITYWIDE_STOP_SOURCE,
};
