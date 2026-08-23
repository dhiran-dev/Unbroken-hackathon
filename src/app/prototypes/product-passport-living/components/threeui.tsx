"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";

const SCENE_SOURCE =
  "/prototypes/product-passport-living/threeui/inner-green-3d.html";
const THREE_RUNTIME =
  "/prototypes/product-passport-living/threeui/three.min.js";
const LIQUID_BUTTON_SOURCE =
  "/prototypes/product-passport-living/threeui/liquid-metal-button.html";

const SCENE_MARKUP = `<main class="hero" id="hero"><canvas id="scene" role="img" aria-label="A procedural living forest with moss, ferns, flowers, spores, and a butterfly"></canvas><div class="stage" id="stage" aria-hidden="true"></div></main>`;
const SCENE_STYLE = `<style data-pulserank-scene>html,body{width:100%!important;height:100%!important;min-height:0!important;margin:0!important;overflow:hidden!important}body{position:relative!important;background:#07110d!important}.hero{height:100%!important;min-height:0!important}#scene{pointer-events:auto!important}</style>`;

function buildSceneDocument(
  html: string,
  runtime: string,
  reducedMotion: boolean,
) {
  const presentationStart = html.indexOf('<main class="hero" id="hero">');
  const runtimeStart = html.indexOf(
    '<script src="inner-green-assets/three.min.js"></script>',
  );

  if (presentationStart < 0 || runtimeStart <= presentationStart) {
    throw new Error("Living-world adapter could not isolate the Three.js scene.");
  }

  let source = `${html.slice(0, presentationStart)}${SCENE_MARKUP}\n${html.slice(runtimeStart)}`
    .replace("</head>", `${SCENE_STYLE}</head>`)
    .replace(
      '<script src="inner-green-assets/three.min.js"></script>',
      `<script data-threeui-runtime>${runtime}</script>`,
    );

  if (reducedMotion) {
    source = source.replace(
      "(function loop() { requestAnimationFrame(loop); tick(); })();",
      "(function loop() { tick(); })();",
    );
  }

  return source;
}

export function LivingGreenScene({
  className,
  style,
}: {
  className?: string;
  style?: CSSProperties;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [sources, setSources] = useState<{ html: string; runtime: string }>();
  const [visible, setVisible] = useState(true);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    void Promise.all([
      fetch(SCENE_SOURCE, { signal: controller.signal }).then((response) => {
        if (!response.ok) throw new Error("Unable to load the living-world source.");
        return response.text();
      }),
      fetch(THREE_RUNTIME, { signal: controller.signal }).then((response) => {
        if (!response.ok) throw new Error("Unable to load the Three.js runtime.");
        return response.text();
      }),
    ]).then(([html, runtime]) => setSources({ html, runtime })).catch(() => {
      if (!controller.signal.aborted) setSources(undefined);
    });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReducedMotion(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      ([entry]) => setVisible(entry?.isIntersecting ?? true),
      { rootMargin: "120px" },
    );
    observer.observe(host);
    return () => observer.disconnect();
  }, []);

  const source = useMemo(() => {
    if (!sources) return undefined;
    return buildSceneDocument(sources.html, sources.runtime, reducedMotion);
  }, [reducedMotion, sources]);

  return (
    <div
      ref={hostRef}
      aria-label="Procedural living forest environment"
      className={className}
      data-state={ready ? "ready" : "loading"}
      role="img"
      style={style}
    >
      {visible && source ? (
        <iframe
          key={reducedMotion ? "reduced" : "motion"}
          aria-hidden="true"
          loading="eager"
          onLoad={() => setReady(true)}
          sandbox="allow-scripts"
          srcDoc={source}
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            border: 0,
            background: "#07110d",
          }}
          tabIndex={-1}
          title="ThreeUI living green scene"
        />
      ) : null}
    </div>
  );
}

const LIQUID_BRIDGE = `
<script id="pulserank-liquid-bridge">
  window.addEventListener('message', event => {
    if (event.source !== parent) return;
    const config = event.data && event.data.pulseRankLiquid;
    if (!config) return;
    const label = btn.querySelector('.lbl');
    const text = typeof config.text === 'string' ? config.text.slice(0, 24) : 'Open source record';
    if (label) label.textContent = text;
    btn.setAttribute('aria-label', text);
    if (Number.isFinite(config.pillWidthUnits)) stage.style.setProperty('--bw', 'calc(' + config.pillWidthUnits + ' * var(--u))');
  });
  btn.addEventListener('click', () => parent.postMessage({ pulseRankLiquid: { type: 'activate' } }, '*'));
</script>`;

function buildLiquidDocument(source: string) {
  return source
    .replace(/<link rel="preconnect"[^>]*>/g, "")
    .replace(/<link href="https:\/\/fonts\.googleapis\.com[^>]*>/g, "")
    .replace("</head>", `<style>html,body{background:transparent!important}</style></head>`)
    .replace("</body>", `${LIQUID_BRIDGE}</body>`);
}

export function LiquidMetalButton({
  className,
  text = "Open source record",
  onClick,
}: {
  className?: string;
  text?: string;
  onClick?: () => void;
}) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [source, setSource] = useState<string>();
  const [ready, setReady] = useState(false);
  const pillWidthUnits = Math.min(3000, Math.max(1480, 900 + text.length * 94));

  useEffect(() => {
    const controller = new AbortController();
    void fetch(LIQUID_BUTTON_SOURCE, { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error("Unable to load the liquid-metal source.");
        return response.text();
      })
      .then((html) => setSource(buildLiquidDocument(html)))
      .catch(() => {
        if (!controller.signal.aborted) setSource(undefined);
      });
    return () => controller.abort();
  }, []);

  const sync = useCallback(() => {
    frameRef.current?.contentWindow?.postMessage(
      { pulseRankLiquid: { text, pillWidthUnits } },
      "*",
    );
  }, [pillWidthUnits, text]);

  useEffect(() => {
    if (ready) sync();
  }, [ready, sync]);

  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (event.source !== frameRef.current?.contentWindow) return;
      if (event.data?.pulseRankLiquid?.type === "activate") onClick?.();
    };
    window.addEventListener("message", receive);
    return () => window.removeEventListener("message", receive);
  }, [onClick]);

  return (
    <div className={className} data-state={ready ? "ready" : "loading"}>
      {source ? (
        <>
          <iframe
            ref={frameRef}
            loading="eager"
            onLoad={() => {
              setReady(true);
              sync();
            }}
            sandbox="allow-scripts"
            srcDoc={source}
            title="Open source record — liquid metal action"
          />
          <span aria-hidden="true" data-liquid-label>{text}</span>
        </>
      ) : (
        <button onClick={onClick} type="button">{text}</button>
      )}
    </div>
  );
}
