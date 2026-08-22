import sharp from "sharp";

import { authorizeProductImage } from "@/server/products/image-policy";

const MAX_SOURCE_BYTES = 5 * 1024 * 1024;
const MAX_SOURCE_PIXELS = 16_000_000;
const MAX_RENDER_EDGE = 640;
const LIGHT_EDGE_MIN = 210;
const LIGHT_EDGE_FULLY_TRANSPARENT = 245;
const LIGHT_EDGE_MAX_CHANNEL_SPREAD = 38;
const PRODUCT_IMAGE_CACHE_LIMIT = 128;
const PRODUCT_IMAGE_REDIRECT_LIMIT = 3;

type MatteResult = {
  data: Buffer;
  changedPixels: number;
};

type ProductImageGlobal = typeof globalThis & {
  pulserankProductImageCache?: Map<string, Promise<Uint8Array>>;
};

type ProductImageFetcher = (
  input: string,
  init: RequestInit,
) => Promise<Response>;

const globalForProductImages = globalThis as ProductImageGlobal;
const renderedImageCache =
  globalForProductImages.pulserankProductImageCache ??
  new Map<string, Promise<Uint8Array>>();
globalForProductImages.pulserankProductImageCache = renderedImageCache;

function channel(data: Uint8Array, index: number): number {
  return data[index] ?? 0;
}

function isLightNeutralPixel(
  data: Uint8Array,
  pixelIndex: number,
  channels: number,
): boolean {
  const offset = pixelIndex * channels;
  const red = channel(data, offset);
  const green = channel(data, offset + 1);
  const blue = channel(data, offset + 2);
  const minimum = Math.min(red, green, blue);
  const maximum = Math.max(red, green, blue);
  return (
    minimum >= LIGHT_EDGE_MIN &&
    maximum - minimum <= LIGHT_EDGE_MAX_CHANNEL_SPREAD
  );
}

function removalStrength(red: number, green: number, blue: number): number {
  const minimum = Math.min(red, green, blue);
  const maximum = Math.max(red, green, blue);
  const lightness = Math.max(
    0,
    Math.min(
      1,
      (minimum - LIGHT_EDGE_MIN) /
        (LIGHT_EDGE_FULLY_TRANSPARENT - LIGHT_EDGE_MIN),
    ),
  );
  const neutrality = Math.max(
    0,
    Math.min(1, 1 - (maximum - minimum) / LIGHT_EDGE_MAX_CHANNEL_SPREAD),
  );
  const featheredLightness = lightness * lightness * (3 - 2 * lightness);
  return featheredLightness * neutrality;
}

/**
 * Derive an alpha matte from light, neutral pixels connected to the image
 * border. Flood-filling from the edge removes the source canvas while keeping
 * disconnected white package labels and typography opaque.
 */
export function deriveLightEdgeAlpha(
  data: Uint8Array,
  width: number,
  height: number,
  channels: number,
): MatteResult {
  if (channels !== 4) {
    throw new Error("product image matte requires RGBA input");
  }
  if (data.length !== width * height * channels) {
    throw new Error("product image matte dimensions do not match its buffer");
  }

  const output = Buffer.from(data);
  const pixelCount = width * height;
  const visited = new Uint8Array(pixelCount);
  const queue = new Int32Array(pixelCount);
  let queueHead = 0;
  let queueTail = 0;

  function enqueue(pixelIndex: number) {
    if (
      visited[pixelIndex] === 1 ||
      !isLightNeutralPixel(data, pixelIndex, channels)
    ) {
      return;
    }
    visited[pixelIndex] = 1;
    queue[queueTail] = pixelIndex;
    queueTail += 1;
  }

  for (let x = 0; x < width; x += 1) {
    enqueue(x);
    enqueue((height - 1) * width + x);
  }
  for (let y = 1; y < height - 1; y += 1) {
    enqueue(y * width);
    enqueue(y * width + width - 1);
  }

  while (queueHead < queueTail) {
    const pixelIndex = queue[queueHead] ?? 0;
    queueHead += 1;
    const x = pixelIndex % width;
    const y = Math.floor(pixelIndex / width);
    if (x > 0) enqueue(pixelIndex - 1);
    if (x + 1 < width) enqueue(pixelIndex + 1);
    if (y > 0) enqueue(pixelIndex - width);
    if (y + 1 < height) enqueue(pixelIndex + width);
  }

  let changedPixels = 0;
  for (let pixelIndex = 0; pixelIndex < pixelCount; pixelIndex += 1) {
    if (visited[pixelIndex] !== 1) continue;
    const offset = pixelIndex * channels;
    const strength = removalStrength(
      channel(data, offset),
      channel(data, offset + 1),
      channel(data, offset + 2),
    );
    if (strength <= 0) continue;
    const originalAlpha = channel(data, offset + 3);
    output[offset + 3] = Math.round(originalAlpha * (1 - strength));
    changedPixels += 1;
  }

  return { data: output, changedPixels };
}

export async function createSeamlessProductImage(
  source: Uint8Array,
): Promise<Uint8Array> {
  if (source.byteLength === 0 || source.byteLength > MAX_SOURCE_BYTES) {
    throw new Error("product image source size is outside the allowed range");
  }

  const decoded = await sharp(source, {
    failOn: "error",
    limitInputPixels: MAX_SOURCE_PIXELS,
    sequentialRead: true,
  })
    .rotate()
    .resize({
      width: MAX_RENDER_EDGE,
      height: MAX_RENDER_EDGE,
      fit: "inside",
      withoutEnlargement: true,
    })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const matte = deriveLightEdgeAlpha(
    decoded.data,
    decoded.info.width,
    decoded.info.height,
    decoded.info.channels,
  );
  let rendered = sharp(matte.data, {
    raw: {
      width: decoded.info.width,
      height: decoded.info.height,
      channels: 4,
    },
  });

  if (matte.changedPixels > 0) {
    rendered = rendered
      .trim({
        background: { r: 0, g: 0, b: 0, alpha: 0 },
        threshold: 4,
      })
      .extend({
        top: 8,
        right: 8,
        bottom: 8,
        left: 8,
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      });
  }

  const output = await rendered
    .webp({ quality: 88, alphaQuality: 92, effort: 4 })
    .toBuffer();
  return new Uint8Array(output);
}

export async function fetchAuthorizedProductImageResponse(
  imageUrl: string,
  fetcher: ProductImageFetcher = (input, init) => fetch(input, init),
): Promise<Response> {
  const authorized = authorizeProductImage(imageUrl);
  if (authorized.publicationState !== "allowed" || authorized.imageUrl === null) {
    throw new Error("product image is not authorized for publication");
  }

  const signal = AbortSignal.timeout(5_000);
  let currentUrl = authorized.imageUrl;
  for (let redirectCount = 0; redirectCount <= PRODUCT_IMAGE_REDIRECT_LIMIT; redirectCount += 1) {
    const response = await fetcher(currentUrl, {
      headers: { Accept: "image/avif,image/webp,image/png,image/jpeg" },
      redirect: "manual",
      signal,
    });
    if (![301, 302, 303, 307, 308].includes(response.status)) {
      if (!response.ok) throw new Error("product image source was unavailable");
      return response;
    }

    if (redirectCount === PRODUCT_IMAGE_REDIRECT_LIMIT) {
      throw new Error("product image exceeded the redirect limit");
    }
    const location = response.headers.get("location");
    if (location === null) {
      throw new Error("product image redirect did not include a destination");
    }
    const destination = authorizeProductImage(new URL(location, currentUrl).toString());
    if (destination.publicationState !== "allowed" || destination.imageUrl === null) {
      throw new Error("product image redirected outside the publication boundary");
    }
    await response.body?.cancel();
    currentUrl = destination.imageUrl;
  }

  throw new Error("product image source was unavailable");
}

async function readResponseBody(response: Response): Promise<Uint8Array> {
  const reader = response.body?.getReader();
  if (!reader) return new Uint8Array();

  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    totalBytes += value.byteLength;
    if (totalBytes > MAX_SOURCE_BYTES) {
      await reader.cancel();
      throw new Error("product image source exceeded the size limit");
    }
    chunks.push(value);
  }

  const source = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    source.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return source;
}

async function fetchAndRenderProductImage(imageUrl: string): Promise<Uint8Array> {
  const response = await fetchAuthorizedProductImageResponse(imageUrl);
  const contentType = response.headers.get("content-type")?.split(";", 1)[0];
  if (
    contentType === undefined ||
    !["image/avif", "image/gif", "image/jpeg", "image/png", "image/webp"].includes(
      contentType,
    )
  ) {
    throw new Error("product image source returned an unsupported media type");
  }
  const declaredLength = Number(response.headers.get("content-length") ?? "0");
  if (declaredLength > MAX_SOURCE_BYTES) {
    throw new Error("product image source exceeded the size limit");
  }

  const source = await readResponseBody(response);
  return createSeamlessProductImage(source);
}

export function getRenderedProductImage(imageUrl: string): Promise<Uint8Array> {
  const existing = renderedImageCache.get(imageUrl);
  if (existing) return existing;

  if (renderedImageCache.size >= PRODUCT_IMAGE_CACHE_LIMIT) {
    const oldestKey = renderedImageCache.keys().next().value;
    if (typeof oldestKey === "string") renderedImageCache.delete(oldestKey);
  }

  const rendering = fetchAndRenderProductImage(imageUrl).catch((error) => {
    renderedImageCache.delete(imageUrl);
    throw error;
  });
  renderedImageCache.set(imageUrl, rendering);
  return rendering;
}
