import { afterEach, describe, expect, it, vi } from "vitest";

import { downloadBrightDataDataset } from "@/server/services/bright-data";

const originalFetch = globalThis.fetch;
const originalSetTimeout = globalThis.setTimeout;

const config = {
  BRIGHTDATA_API_TOKEN: "synthetic-token",
  BRIGHTDATA_COLLECTOR_ID: "c_msyjsllt1r9ej5tdub" as const,
  SFMTA_SOURCE_URL:
    "https://www.sfmta.com/elevator-status/elevatorstatus.php?src=prod" as const,
};

afterEach(() => {
  globalThis.fetch = originalFetch;
  globalThis.setTimeout = originalSetTimeout;
});

describe("Bright Data dataset downloads", () => {
  it("accepts a bounded finished JSONL dataset", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response('{"title":"First"}\n{"title":"Second"}\n', {
          headers: { "content-type": "application/jsonl; charset=utf-8" },
        }),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await expect(
      downloadBrightDataDataset(config, "j_Synthetic123"),
    ).resolves.toEqual([{ title: "First" }, { title: "Second" }]);
  });

  it("waits through a pending envelope before parsing JSONL", async () => {
    globalThis.setTimeout = ((callback: TimerHandler) => {
      if (typeof callback === "function") callback();
      return 0;
    }) as unknown as typeof setTimeout;
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response('{"status":"building","message":"pending"}', {
          status: 202,
          headers: { "content-type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response('{"title":"Ready"}\n', {
          headers: { "content-type": "application/jsonl" },
        }),
      );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const result = downloadBrightDataDataset(config, "j_Synthetic123");
    await expect(result).resolves.toEqual([{ title: "Ready" }]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("rejects malformed JSONL without echoing source content", async () => {
    globalThis.fetch = vi.fn(
      async () =>
        new Response('{"title":"must-not-leak"}\nnot-json', {
          headers: { "content-type": "application/jsonl" },
        }),
    ) as unknown as typeof fetch;

    const result = downloadBrightDataDataset(config, "j_Synthetic123");
    await expect(result).rejects.toMatchObject({
      name: "BrightDataError",
      code: "BRIGHT_DATA_NON_JSON_RESPONSE",
    });
    await expect(result).rejects.not.toThrow(/must-not-leak/);
  });
});
