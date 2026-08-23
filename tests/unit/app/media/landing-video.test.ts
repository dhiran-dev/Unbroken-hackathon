import { describe, expect, it } from "vitest";

import { GET, HEAD } from "@/app/media/landing-video/route";

describe("landing video media route", () => {
  it("advertises byte-range support", async () => {
    const response = await HEAD();

    expect(response.status).toBe(200);
    expect(response.headers.get("accept-ranges")).toBe("bytes");
    expect(response.headers.get("content-type")).toBe("video/mp4");
    expect(Number(response.headers.get("content-length"))).toBeGreaterThan(0);
  });

  it("returns the requested byte range", async () => {
    const response = await GET(new Request("http://localhost/media/landing-video", {
      headers: { Range: "bytes=0-1023" },
    }));

    expect(response.status).toBe(206);
    expect(response.headers.get("content-range")).toMatch(/^bytes 0-1023\/\d+$/);
    expect(response.headers.get("content-length")).toBe("1024");
    expect((await response.arrayBuffer()).byteLength).toBe(1024);
  });

  it("rejects an impossible byte range", async () => {
    const response = await GET(new Request("http://localhost/media/landing-video", {
      headers: { Range: "bytes=999999999-" },
    }));

    expect(response.status).toBe(416);
    expect(response.headers.get("content-range")).toMatch(/^bytes \*\/\d+$/);
  });
});
