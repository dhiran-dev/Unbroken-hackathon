import { describe, expect, it } from "vitest";

import { authorizeProductSourceUrl } from "@/server/products/source-policy";

describe("public product source URL policy", () => {
  it("returns one canonical HTTPS product URL", () => {
    expect(
      authorizeProductSourceUrl(
        " https://www.caffeineinformer.com/caffeine-content/red-bull/?utm_source=private#facts ",
      ),
    ).toBe("https://www.caffeineinformer.com/caffeine-content/red-bull");
  });

  it.each([
    "http://www.caffeineinformer.com/caffeine-content/red-bull",
    "https://caffeineinformer.com/caffeine-content/red-bull",
    "https://media.caffeineinformer.com/caffeine-content/red-bull",
    "https://user:pass@www.caffeineinformer.com/caffeine-content/red-bull",
    "https://www.caffeineinformer.com/about",
    "https://www.caffeineinformer.com/caffeine-content/",
    "not a URL",
  ])("rejects unsafe source URL %s", (value) => {
    expect(authorizeProductSourceUrl(value)).toBeNull();
  });
});
