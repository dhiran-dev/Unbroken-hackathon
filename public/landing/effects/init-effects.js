import { createClouds } from "./Clouds/CloudsVanilla.js";
import { createFrost } from "./Frost/FrostVanilla.js";
import { createDroplets } from "./Droplets/DropletsVanilla.js";

const source = (id) => document.getElementById(id);

function initClouds() {
  const region = source("heroCloudRegion");
  const output = source("heroCloudCanvas");
  const capture = source("heroCloudSource");
  if (!region || !output || !capture) return null;

  return createClouds(
    { source: capture, content: region, output },
    {
      scale: 0.78,
      speed: 0.34,
      cover: 0.035,
      density: 2.15,
      shading: 0.24,
      color: [0.44, 0.45, 0.5],
      opacity: 0.34,
      shadow: 0.1,
      shadowOffsetX: 34,
      shadowOffsetY: 16,
      shadowSoftness: 1,
      wind: 0.42,
      windRadius: 260,
      refraction: 0,
      fogBlur: 0,
      quality: 0.46,
    },
  );
}

function initFrost() {
  const panel = source("heroFrostPanel");
  const output = source("heroFrostCanvas");
  const capture = source("heroFrostSource");
  if (!panel || !output || !capture) return null;

  const instance = createFrost(
    { source: capture, content: panel, output },
    {
      frost: 0.022,
      strength: 0.32,
      contrast: 1.55,
      crispness: 0.52,
      highlight: 0.06,
      highlightStrength: 0.3,
      haze: 0.05,
      tintThin: [0.76, 0.82, 0.94],
      tintThick: [0.92, 0.95, 1.0],
      tintStrength: 0.06,
      saturation: 0.92,
      brightness: 0.6,
      refraction: 0.38,
      ior: 1.31,
      detail: 1.15,
      textureScale: 1.3,
      fresnel: 0.62,
      meltRadius: 0.22,
      meltNoise: 0.28,
      meltStrength: 0.58,
      refreeze: 1.65,
      edgeFade: 0.14,
      meltEdges: false,
      introDuration: 1.8,
      opacity: 0.22,
      shimmer: 0.018,
      quality: 0.48,
    },
  );

  panel.classList.toggle("has-frost-webgl", Boolean(instance));
  return instance;
}

function fitContainBottom(context, image, width, height) {
  const scale = Math.min(width / image.naturalWidth, height / image.naturalHeight);
  const drawWidth = image.naturalWidth * scale;
  const drawHeight = image.naturalHeight * scale;
  context.clearRect(0, 0, width, height);
  context.drawImage(
    image,
    (width - drawWidth) / 2,
    height - drawHeight,
    drawWidth,
    drawHeight,
  );
}

async function initDroplets() {
  const stage = source("canStage");
  const output = source("canDropletsCanvas");
  const capture = source("canDropletsSource");
  const image = stage?.querySelector(".layer-can");
  if (!stage || !output || !capture || !image) return null;

  if (!image.complete || !image.naturalWidth) {
    await new Promise((resolve) => {
      image.addEventListener("load", resolve, { once: true });
      image.addEventListener("error", resolve, { once: true });
    });
  }
  if (!image.naturalWidth) return null;

  /* CanvasUI normally captures DOM through the experimental html-in-canvas
     API. Chrome treats file:// image pixels as an opaque origin, so use the
     shader's neutral fallback there; the CSS silhouette still confines every
     drop to the can. Served pages retain real-pixel refraction. */
  if (location.protocol !== "file:") {
    const context = capture.getContext("2d");
    if (!context) return null;
    context.drawElementImage = () =>
      fitContainBottom(context, image, capture.width, capture.height);
    capture.requestPaint = () => capture.onpaint?.();
    output.style.webkitMask =
      'url("/landing/assets/new_can.png") center bottom / contain no-repeat';
    output.style.mask =
      'url("/landing/assets/new_can.png") center bottom / contain no-repeat';
  }

  return createDroplets(
    { source: capture, content: stage, output },
    {
      intensity: 0.52,
      speed: 0.82,
      scale: 0.58,
      dropWidth: 0.9,
      dropLength: 1.05,
      refraction: 0.16,
      blur: 0,
      vignette: 0,
      fallSpeed: 0.72,
      wiggle: 0.78,
      staticDrops: 0.3,
      interactive: false,
      interactionRadius: 0.2,
      interactionStrength: 0,
      interactionDistortion: 0,
      tint: [1, 1, 1],
      tintStrength: 0,
    },
  );
}

const instances = [initClouds(), initFrost()].filter(Boolean);
initDroplets().then((instance) => {
  if (instance) instances.push(instance);
});

window.addEventListener(
  "pagehide",
  () => instances.forEach((instance) => instance.destroy()),
  { once: true },
);
