import { describe, expect, it } from "vitest";

import {
  createBrightDataProvider,
  type BrightDataProviderConfig,
} from "@/server/collection/bright-data-provider";

const config: BrightDataProviderConfig = {
  apiToken: "secret-token",
  collectorId: "c_mt33nlnkq376z132b",
};

describe("Bright Data async provider adapter", () => {
  it("refuses every collector except the consented PulseRank collector", () => {
    expect(() =>
      createBrightDataProvider({
        apiToken: "secret-token",
        collectorId: "c_msyjsllt1r9ej5tdub",
      }),
    ).toThrow(/not permitted/i);
  });

  it("submits discovery and returns only the persisted collection identity", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const provider = createBrightDataProvider(config, async (input, init) => {
      requests.push({ url: String(input), init });
      return Response.json({ collection_id: "j_abc123" });
    });

    await expect(
      provider.submit({ url: "https://www.caffeineinformer.com/the-caffeine-database" }),
    ).resolves.toEqual({ collectionId: "j_abc123" });
    expect(requests[0]?.url).toContain("/dca/trigger");
    expect(requests[0]?.url).toContain("collector=c_mt33nlnkq376z132b");
    expect(requests[0]?.url).toContain("deadline=60m");
    expect(requests[0]?.init?.method).toBe("POST");
  });

  it("distinguishes in-progress responses from ready dataset arrays", async () => {
    let polls = 0;
    const provider = createBrightDataProvider(config, async (input) => {
      if (String(input).includes("/dca/log/")) {
        return Response.json({
          status: "done",
          inputs: 1,
          dup_inputs: 0,
          lines: 1,
          fails: 0,
          pages: 1,
          pages_left: 0,
          success: 1,
          success_rate: 1,
        });
      }
      polls += 1;
      return polls === 1
        ? Response.json({ status: "building" })
        : Response.json([{ product_name: "Example" }]);
    });

    await expect(provider.poll("j_abc123")).resolves.toEqual({ status: "pending" });
    const ready = await provider.poll("j_abc123");
    expect(ready).toMatchObject({
      status: "ready",
      rows: [{ product_name: "Example" }],
      manifest: { status: "done", lines: 1, fails: 0, pagesLeft: 0 },
    });
    expect(ready.status === "ready" && ready.fingerprint).toMatch(/^sha256:/);
  });
});
