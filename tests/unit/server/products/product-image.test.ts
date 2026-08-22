import sharp from "sharp";
import { describe, expect, it } from "vitest";

import {
  createSeamlessProductImage,
  deriveLightEdgeAlpha,
  fetchAuthorizedProductImageResponse,
} from "@/server/products/product-image";

function rgbaCanvas(width: number, height: number, color: [number, number, number, number]) {
  const data = new Uint8Array(width * height * 4);
  for (let pixel = 0; pixel < width * height; pixel += 1) {
    data.set(color, pixel * 4);
  }
  return data;
}

function setPixel(
  data: Uint8Array,
  width: number,
  x: number,
  y: number,
  color: [number, number, number, number],
) {
  data.set(color, (y * width + x) * 4);
}

function alphaAt(data: Uint8Array, width: number, x: number, y: number): number {
  return data[(y * width + x) * 4 + 3] ?? -1;
}

describe("product image edge matte", () => {
  it("rejects an off-boundary redirect before requesting its destination", async () => {
    const requested: string[] = [];
    const fetcher = async (input: string): Promise<Response> => {
      requested.push(input);
      return new Response(null, {
        status: 302,
        headers: { location: "http://127.0.0.1/private-image" },
      });
    };

    await expect(
      fetchAuthorizedProductImageResponse(
        "https://www.caffeineinformer.com/images/content/example-can.jpg",
        fetcher,
      ),
    ).rejects.toThrow("redirected outside the publication boundary");
    expect(requested).toEqual([
      "https://www.caffeineinformer.com/images/content/example-can.jpg",
    ]);
  });

  it("allows bounded redirects that remain on the authorized source host", async () => {
    const requested: string[] = [];
    const fetcher = async (input: string): Promise<Response> => {
      requested.push(input);
      if (requested.length === 1) {
        return new Response(null, {
          status: 302,
          headers: { location: "/images/content/final-can.jpg" },
        });
      }
      return new Response(new Uint8Array([1, 2, 3]), {
        status: 200,
        headers: { "content-type": "image/jpeg" },
      });
    };

    const response = await fetchAuthorizedProductImageResponse(
      "https://www.caffeineinformer.com/images/content/example-can.jpg",
      fetcher,
    );

    expect(response.status).toBe(200);
    expect(requested).toEqual([
      "https://www.caffeineinformer.com/images/content/example-can.jpg",
      "https://www.caffeineinformer.com/images/content/final-can.jpg",
    ]);
  });

  it("removes light canvas pixels connected to the edge", () => {
    const width = 7;
    const height = 7;
    const data = rgbaCanvas(width, height, [255, 255, 255, 255]);
    for (let y = 1; y <= 5; y += 1) {
      for (let x = 2; x <= 4; x += 1) {
        setPixel(data, width, x, y, [24, 32, 48, 255]);
      }
    }

    const result = deriveLightEdgeAlpha(data, width, height, 4);

    expect(result.changedPixels).toBeGreaterThan(0);
    expect(alphaAt(result.data, width, 0, 0)).toBe(0);
    expect(alphaAt(result.data, width, 3, 3)).toBe(255);
  });

  it("preserves disconnected white package details", () => {
    const width = 7;
    const height = 7;
    const data = rgbaCanvas(width, height, [255, 255, 255, 255]);
    for (let y = 1; y <= 5; y += 1) {
      for (let x = 1; x <= 5; x += 1) {
        setPixel(data, width, x, y, [18, 26, 38, 255]);
      }
    }
    setPixel(data, width, 3, 3, [255, 255, 255, 255]);

    const result = deriveLightEdgeAlpha(data, width, height, 4);

    expect(alphaAt(result.data, width, 0, 0)).toBe(0);
    expect(alphaAt(result.data, width, 3, 3)).toBe(255);
  });

  it("leaves dark source canvases opaque", () => {
    const width = 5;
    const height = 5;
    const data = rgbaCanvas(width, height, [8, 12, 20, 255]);

    const result = deriveLightEdgeAlpha(data, width, height, 4);

    expect(result.changedPixels).toBe(0);
    expect(alphaAt(result.data, width, 0, 0)).toBe(255);
  });

  it("emits a transparent WebP for a white-backed source image", async () => {
    const source = await sharp({
      create: {
        width: 40,
        height: 60,
        channels: 3,
        background: { r: 255, g: 255, b: 255 },
      },
    })
      .composite([
        {
          input: {
            create: {
              width: 12,
              height: 38,
              channels: 4,
              background: { r: 38, g: 80, b: 150, alpha: 1 },
            },
          },
          left: 14,
          top: 11,
        },
      ])
      .jpeg()
      .toBuffer();

    const rendered = await createSeamlessProductImage(source);
    const metadata = await sharp(rendered).metadata();
    const { data, info } = await sharp(rendered)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    expect(metadata.format).toBe("webp");
    expect(metadata.hasAlpha).toBe(true);
    expect(alphaAt(data, info.width, 0, 0)).toBe(0);
  });
});
