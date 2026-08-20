import { describe, expect, it } from "vitest";

import { create511RealtimeSource } from "../../src/server/transit/realtime-source";

const token = "synthetic-secret-token";
const startedAt = new Date("2026-08-20T12:04:00.000Z");

describe("fixed 511 realtime source", () => {
  it.each([
    [
      "trip_updates" as const,
      "/transit/tripupdates",
      "application/x-google-protobuf",
      ["agency", "api_key"],
    ],
    [
      "vehicles" as const,
      "/transit/vehiclepositions",
      "application/x-google-protobuf",
      ["agency", "api_key"],
    ],
    [
      "alerts" as const,
      "/transit/servicealerts",
      "application/json",
      ["agency", "api_key", "format"],
    ],
  ])(
    "uses only the pinned %s endpoint, query keys, and Accept type",
    async (feedType, path, accept, keys) => {
      const requested: { url?: URL; headers?: Headers } = {};
      const source = create511RealtimeSource({
        token,
        clock: () => new Date("2026-08-20T12:04:02.000Z"),
        fetcher: async (input, init) => {
          requested.url = new URL(String(input));
          requested.headers = new Headers(init.headers);
          return new Response(new Uint8Array([1]), {
            status: 200,
            headers: {
              "content-type": accept,
            },
          });
        },
      });

      const result = await source.load(feedType, startedAt);
      expect(requested.url?.origin).toBe("https://api.511.org");
      expect(requested.url?.pathname).toBe(path);
      expect([...requested.url!.searchParams.keys()].sort()).toEqual(keys);
      expect(requested.url?.searchParams.get("agency")).toBe("SF");
      expect(requested.headers?.get("accept")).toBe(accept);
      expect(JSON.stringify(result)).not.toContain(token);
    },
  );

  it("bounds streamed bodies and hides fetch errors and token values", async () => {
    const oversized = create511RealtimeSource({
      token,
      fetcher: async () =>
        new Response(new Uint8Array(2 * 1024 * 1024 + 1), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    });
    await expect(oversized.load("alerts", startedAt)).rejects.toThrow(
      "Realtime response is too large.",
    );

    const failed = create511RealtimeSource({
      token,
      fetcher: async () => {
        throw new Error(`provider failed ${token}`);
      },
    });
    await expect(failed.load("vehicles", startedAt)).rejects.toThrow(
      "Realtime source is unavailable.",
    );
  });
});
