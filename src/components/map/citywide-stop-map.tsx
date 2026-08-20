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

import {
  normalizeJourneyPlan,
  type SafeJourneyPlan,
} from "@/domain/journey/citywide-journey-form";
import { isStopMapFeedHash } from "@/domain/transit/stop-map";
import {
  fitMapToJourney,
  moveMapToSelectedCoordinate,
  journeyOverlayForPlan,
  JOURNEY_MAP_LEGEND,
  liveVehicleRequestUrl,
  normalizeLiveVehicleGeoJson,
  updateLiveVehicleSource,
  type JourneyMapOverlay,
  type LiveVehicleFeatureCollection,
} from "./journey-map-overlay";
import {
  CITYWIDE_JOURNEY_MARKER_LABEL_LAYER,
  CITYWIDE_JOURNEY_MARKER_LABEL_LAYER_ID,
  CITYWIDE_JOURNEY_MARKER_POINT_LAYER,
  CITYWIDE_JOURNEY_MARKER_POINT_LAYER_ID,
  CITYWIDE_JOURNEY_MARKER_SOURCE,
  CITYWIDE_JOURNEY_MARKER_SOURCE_ID,
  CITYWIDE_JOURNEY_ROUTE_LAYER,
  CITYWIDE_JOURNEY_ROUTE_LAYER_ID,
  CITYWIDE_JOURNEY_ROUTE_SOURCE,
  CITYWIDE_JOURNEY_ROUTE_SOURCE_ID,
  CITYWIDE_LIVE_VEHICLE_LABEL_LAYER,
  CITYWIDE_LIVE_VEHICLE_LABEL_LAYER_ID,
  CITYWIDE_LIVE_VEHICLE_POINT_LAYER,
  CITYWIDE_LIVE_VEHICLE_POINT_LAYER_ID,
  CITYWIDE_LIVE_VEHICLE_SOURCE,
  CITYWIDE_LIVE_VEHICLE_SOURCE_ID,
} from "./journey-map-config";
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
const LIVE_REFRESH_TIMEOUT_MS = 10_000;

function riderLegType(
  type: JourneyMapOverlay["routes"]["features"][number]["properties"]["legType"],
) {
  return type.charAt(0).toUpperCase() + type.slice(1);
}

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

function installJourneyOverlayLayers(
  map: MapLibreMap,
  overlay: JourneyMapOverlay,
) {
  if (!map.getSource(CITYWIDE_JOURNEY_ROUTE_SOURCE_ID)) {
    map.addSource(CITYWIDE_JOURNEY_ROUTE_SOURCE_ID, {
      ...CITYWIDE_JOURNEY_ROUTE_SOURCE,
      data: overlay.routes,
    });
  } else {
    const source = map.getSource<GeoJSONSource>(
      CITYWIDE_JOURNEY_ROUTE_SOURCE_ID,
    );
    if (source) void source.setData(overlay.routes as never);
  }
  if (!map.getSource(CITYWIDE_JOURNEY_MARKER_SOURCE_ID)) {
    map.addSource(CITYWIDE_JOURNEY_MARKER_SOURCE_ID, {
      ...CITYWIDE_JOURNEY_MARKER_SOURCE,
      data: overlay.markers,
    });
  } else {
    const source = map.getSource<GeoJSONSource>(
      CITYWIDE_JOURNEY_MARKER_SOURCE_ID,
    );
    if (source) void source.setData(overlay.markers as never);
  }
  if (!map.getLayer(CITYWIDE_JOURNEY_ROUTE_LAYER_ID)) {
    map.addLayer(CITYWIDE_JOURNEY_ROUTE_LAYER as unknown as AddLayerObject);
  }
  if (!map.getLayer(CITYWIDE_JOURNEY_MARKER_POINT_LAYER_ID)) {
    map.addLayer(
      CITYWIDE_JOURNEY_MARKER_POINT_LAYER as unknown as AddLayerObject,
    );
  }
  if (!map.getLayer(CITYWIDE_JOURNEY_MARKER_LABEL_LAYER_ID)) {
    map.addLayer(
      CITYWIDE_JOURNEY_MARKER_LABEL_LAYER as unknown as AddLayerObject,
    );
  }
}

function installLiveVehicleLayers(
  map: MapLibreMap,
  vehicles: LiveVehicleFeatureCollection,
) {
  if (!map.getSource(CITYWIDE_LIVE_VEHICLE_SOURCE_ID)) {
    map.addSource(CITYWIDE_LIVE_VEHICLE_SOURCE_ID, {
      ...CITYWIDE_LIVE_VEHICLE_SOURCE,
      data: vehicles,
    });
  } else {
    updateLiveVehicleSource(map, vehicles);
  }
  if (!map.getLayer(CITYWIDE_LIVE_VEHICLE_POINT_LAYER_ID)) {
    map.addLayer(
      CITYWIDE_LIVE_VEHICLE_POINT_LAYER as unknown as AddLayerObject,
    );
  }
  if (!map.getLayer(CITYWIDE_LIVE_VEHICLE_LABEL_LAYER_ID)) {
    map.addLayer(
      CITYWIDE_LIVE_VEHICLE_LABEL_LAYER as unknown as AddLayerObject,
    );
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
  const [journeyOverlay, setJourneyOverlay] =
    useState<JourneyMapOverlay | null>(null);
  const [liveStatus, setLiveStatus] = useState<
    "idle" | "current" | "unavailable" | "not_applicable"
  >("idle");
  const [liveVehicleCount, setLiveVehicleCount] = useState(0);
  const journeyOverlayRef = useRef<JourneyMapOverlay | null>(null);
  const liveVehiclesRef = useRef<LiveVehicleFeatureCollection | null>(null);
  const liveControllerRef = useRef<AbortController | null>(null);
  const liveTimerRef = useRef<number | null>(null);
  const liveRefreshInFlightRef = useRef<AbortController | null>(null);
  const selectedStopIdRef = useRef<string | null>(null);
  const selectStopRef = useRef<(id: string) => void>(() => undefined);
  const reducedMotionRef = useRef(reducedMotion);
  useEffect(() => {
    reducedMotionRef.current = reducedMotion;
  }, [reducedMotion]);

  useEffect(() => {
    selectStopRef.current = (id: string) => {
      selectedStopIdRef.current = id;
      setSelectedStopId(id);
      const selected = dataRef.current?.features.find(
        (feature) => feature.id === id,
      );
      const map = mapRef.current;
      if (selected && map?.isStyleLoaded()) {
        moveMapToSelectedCoordinate(
          map,
          selected.geometry.coordinates,
          reducedMotionRef.current,
        );
      }
    };
  }, []);

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
    const emptyLiveVehicles = (): LiveVehicleFeatureCollection => ({
      type: "FeatureCollection",
      features: [],
    });

    const clearLiveVehicles = () => {
      const empty = emptyLiveVehicles();
      liveVehiclesRef.current = empty;
      setLiveVehicleCount(0);
      const map = mapRef.current;
      if (map?.isStyleLoaded()) updateLiveVehicleSource(map, empty);
    };

    const clearLiveRefresh = () => {
      liveControllerRef.current?.abort();
      liveControllerRef.current = null;
      liveRefreshInFlightRef.current = null;
      if (liveTimerRef.current !== null) {
        window.clearInterval(liveTimerRef.current);
        liveTimerRef.current = null;
      }
    };

    const refreshVehicles = async (
      plan: SafeJourneyPlan,
      overlay: JourneyMapOverlay,
      controller: AbortController,
    ) => {
      if (liveRefreshInFlightRef.current) return "skipped" as const;
      liveRefreshInFlightRef.current = controller;
      let timedOut = false;
      const timeout = window.setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, LIVE_REFRESH_TIMEOUT_MS);
      try {
        const url = liveVehicleRequestUrl(plan.map.bounds, overlay.routeIds);
        if (!url) throw new Error("live-url-unavailable");
        const response = await fetch(url, {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!response.ok) throw new Error("live-unavailable");
        const contentType = response.headers
          .get("content-type")
          ?.split(";", 1)[0]
          ?.trim()
          .toLowerCase();
        if (contentType !== "application/geo+json") {
          throw new Error("live-content-type");
        }
        const value = normalizeLiveVehicleGeoJson(
          await response.json(),
          overlay.routeIds,
        );
        if (!value) throw new Error("live-invalid");
        if (
          liveControllerRef.current !== controller ||
          controller.signal.aborted
        ) {
          if (timedOut) throw new Error("live-timeout");
          return "aborted" as const;
        }
        liveVehiclesRef.current = value;
        setLiveVehicleCount(value.features.length);
        const map = mapRef.current;
        if (map?.isStyleLoaded()) updateLiveVehicleSource(map, value);
        setLiveStatus("current");
        return "updated" as const;
      } catch {
        if (!timedOut && controller.signal.aborted) {
          return "aborted" as const;
        }
        clearLiveVehicles();
        setLiveStatus("unavailable");
        clearLiveRefresh();
        return "failed" as const;
      } finally {
        window.clearTimeout(timeout);
        if (liveRefreshInFlightRef.current === controller) {
          liveRefreshInFlightRef.current = null;
        }
      }
    };

    const onJourneyPlan = (event: Event) => {
      const detail = (event as CustomEvent<unknown>).detail;
      const plan = normalizeJourneyPlan(detail);
      const overlay = plan ? journeyOverlayForPlan(plan) : null;
      if (!plan || !overlay) return;

      clearLiveRefresh();
      clearLiveVehicles();
      journeyOverlayRef.current = overlay;
      setJourneyOverlay(overlay);
      const hasRideRoutes = overlay.routeIds.length > 0;
      setLiveStatus(hasRideRoutes ? "idle" : "not_applicable");
      const map = mapRef.current;
      if (map?.isStyleLoaded()) {
        installJourneyOverlayLayers(map, overlay);
        fitMapToJourney(map, overlay.bounds, reducedMotionRef.current);
        if (liveVehiclesRef.current) {
          installLiveVehicleLayers(map, liveVehiclesRef.current);
        }
      }
      if (!hasRideRoutes) return;

      const controller = new AbortController();
      liveControllerRef.current = controller;
      void refreshVehicles(plan, overlay, controller).then((result) => {
        if (result !== "updated" || liveControllerRef.current !== controller) {
          return;
        }
        liveTimerRef.current = window.setInterval(() => {
          if (
            liveControllerRef.current !== controller ||
            liveRefreshInFlightRef.current
          ) {
            return;
          }
          void refreshVehicles(plan, overlay, controller).then((updated) => {
            if (
              (updated === "failed" || updated === "aborted") &&
              liveControllerRef.current === controller
            ) {
              clearLiveRefresh();
            }
          });
        }, 180_000);
      });
    };

    window.addEventListener("unbroken:journey-plan", onJourneyPlan);
    return () => {
      window.removeEventListener("unbroken:journey-plan", onJourneyPlan);
      clearLiveRefresh();
    };
  }, []);
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
          if (journeyOverlayRef.current) {
            installJourneyOverlayLayers(map, journeyOverlayRef.current);
            fitMapToJourney(
              map,
              journeyOverlayRef.current.bounds,
              reducedMotionRef.current,
            );
          }
          if (liveVehiclesRef.current) {
            installLiveVehicleLayers(map, liveVehiclesRef.current);
          }
          const selected = dataRef.current?.features.find(
            (feature) => feature.id === selectedStopIdRef.current,
          );
          if (selected) {
            moveMapToSelectedCoordinate(
              map,
              selected.geometry.coordinates,
              reducedMotionRef.current,
            );
          }
        };
        const onError = () => {
          if (!disposed) setFailed(true);
        };
        const onStopClick = (event: MapLayerMouseEvent) => {
          const id = event.features?.[0]?.properties?.id;
          if (typeof id === "string") selectStopRef.current(id);
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
      if (!disposed) {
        if (dataRef.current) installStopLayers(map, dataRef.current);
        if (journeyOverlayRef.current) {
          installJourneyOverlayLayers(map, journeyOverlayRef.current);
        }
        if (liveVehiclesRef.current) {
          installLiveVehicleLayers(map, liveVehiclesRef.current);
        }
      }
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
      {journeyOverlay && (
        <section
          aria-label="Journey map details"
          className="mt-4 rounded-xl border p-4"
          data-journey-overlay="true"
          data-live-status={liveStatus}
          data-journey-route-count={journeyOverlay.routes.features.length}
          data-journey-marker-count={journeyOverlay.markers.features.length}
          data-live-vehicle-count={liveVehicleCount}
        >
          <h3 className="font-medium">Journey map details</h3>
          <p className="mt-2 text-sm text-muted-foreground">
            The map shows your route, start, destination, transfers, and stops
            that need attention. The steps remain available below if the map
            cannot load.
          </p>
          <ol
            aria-label="Mapped journey steps"
            className="mt-3 space-y-1 text-sm"
          >
            {journeyOverlay.routes.features.map((route) => (
              <li key={route.properties.legIndex}>
                Step {route.properties.legIndex + 1}:{" "}
                {riderLegType(route.properties.legType)} from{" "}
                {route.properties.from} to {route.properties.to}
                {route.properties.routeName
                  ? ` on ${route.properties.routeName}`
                  : ""}
              </li>
            ))}
          </ol>
          <h4 className="mt-4 font-medium">Map symbols</h4>
          <ul
            aria-label="Map symbols"
            className="mt-2 grid gap-1 text-sm sm:grid-cols-2"
          >
            {JOURNEY_MAP_LEGEND.map((item) => (
              <li key={item.shape}>
                <span aria-hidden="true" className="mr-2 font-semibold">
                  {item.shape === "origin"
                    ? "A"
                    : item.shape === "destination"
                      ? "D"
                      : item.shape === "transfer"
                        ? "↔"
                        : item.shape === "endpoint"
                          ? "•"
                          : item.shape === "accessible-stop"
                            ? "✓"
                            : item.shape === "warning"
                              ? "!"
                              : item.shape === "vehicle"
                                ? "▲"
                                : "●"}
                </span>
                <span className="font-medium">{item.label}.</span>{" "}
                {item.description}
              </li>
            ))}
          </ul>
          {(journeyOverlay.warnings.length > 0 ||
            journeyOverlay.changes.length > 0 ||
            liveStatus === "unavailable") && (
            <div aria-live="polite" className="mt-4 text-sm" role="status">
              {journeyOverlay.warnings.map((warning, index) => (
                <p key={"warning-" + index}>Current warning: {warning}</p>
              ))}
              {journeyOverlay.changes.map((change, index) => (
                <p key={"change-" + index}>Current change: {change}</p>
              ))}
              {liveStatus === "unavailable" && (
                <p className="mt-1">
                  Current vehicle updates are unavailable. The journey steps
                  remain available.
                </p>
              )}
            </div>
          )}
        </section>
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
                  onClick={() => selectStopRef.current(feature.id)}
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
