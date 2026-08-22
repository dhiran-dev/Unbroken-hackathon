import { describe, expect, it } from "vitest";

import {
  authorizeProductImage,
  normalizeProductMedia,
} from "@/server/products/image-policy";

describe("PulseRank product image publication policy", () => {
  it("allows HTTPS product images hosted by Caffeine Informer", () => {
    const imageUrl = "https://www.caffeineinformer.com/images/content/example-can.jpg";
    expect(authorizeProductImage(imageUrl)).toEqual({
      imageUrl,
      publicationState: "allowed",
    });
  });

  it("blocks non-HTTPS and unrelated hosts without reflecting their URLs", () => {
    expect(authorizeProductImage("http://www.caffeineinformer.com/example.jpg")).toEqual({
      imageUrl: null,
      publicationState: "blocked",
    });
    expect(authorizeProductImage("https://caffeineinformer.com.example.test/example.jpg")).toEqual({
      imageUrl: null,
      publicationState: "blocked",
    });
    expect(authorizeProductImage("https://media.caffeineinformer.com/example.jpg")).toEqual({
      imageUrl: null,
      publicationState: "blocked",
    });
  });

  it("keeps missing images private and revalidates an allowed media block", () => {
    expect(authorizeProductImage(null)).toEqual({
      imageUrl: null,
      publicationState: "audit_only",
    });
    expect(
      normalizeProductMedia({
        imageUrl: "https://untrusted.example/product.jpg",
        publicationState: "allowed",
      }),
    ).toEqual({ imageUrl: null, publicationState: "blocked" });
  });
});
