import { describe, expect, it, vi } from "vitest";

import { createCommutePreviewPost } from "@/app/api/me/commutes/[slot]/preview/route";
import { createEmailHistoryGet } from "@/app/api/me/email-history/route";

const rider = { userId: "rider-a", role: "rider" as const };

function request(path: string, init: RequestInit = {}) {
  return new Request(`https://unbroken.test${path}`, {
    ...init,
    headers: {
      Origin: "https://unbroken.test",
      "Sec-Fetch-Site": "same-origin",
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
}

describe("POST /api/me/commutes/:slot/preview", () => {
  it("returns only the safe subject and text for the current rider", async () => {
    const previewForRider = vi.fn(async () => ({
      subject: "Your 8:30 AM trip is unchanged",
      html: "<p>private HTML projection</p>",
      text: "Trip summary\n\nYour journey is unchanged.",
    }));
    const post = createCommutePreviewPost({
      readRider: vi.fn(async () => rider),
      preview: { previewForRider },
    });

    const response = await post(
      request("/api/me/commutes/first/preview", {
        method: "POST",
        body: "{}",
      }),
      { params: Promise.resolve({ slot: "first" }) },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("cache-control")).toBe("no-store, max-age=0");
    await expect(response.json()).resolves.toEqual({
      subject: "Your 8:30 AM trip is unchanged",
      text: "Trip summary\n\nYour journey is unchanged.",
    });
    expect(previewForRider).toHaveBeenCalledWith("rider-a", "first");
  });

  it("rejects malicious subject projections from the preview dependency", async () => {
    for (const subject of [" Preview ", "Preview\n", "<Preview>"]) {
      const post = createCommutePreviewPost({
        readRider: vi.fn(async () => rider),
        preview: {
          previewForRider: vi.fn(async () => ({
            subject,
            html: "<p>safe</p>",
            text: "Safe preview",
          })),
        },
      });
      const response = await post(
        request("/api/me/commutes/first/preview", {
          method: "POST",
          body: "{}",
        }),
        { params: Promise.resolve({ slot: "first" }) },
      );
      expect(response.status).toBe(503);
      await expect(response.json()).resolves.toEqual({
        code: "COMMUTE_UNAVAILABLE",
        message: "Your trips are unavailable right now.",
      });
    }
  });

  it("denies anonymous and operator sessions before calling the preview seam", async () => {
    const previewForRider = vi.fn(async () => null);
    const post = createCommutePreviewPost({
      readRider: vi.fn(async () => null),
      preview: { previewForRider },
    });

    const anonymous = await post(
      request("/api/me/commutes/first/preview", {
        method: "POST",
        body: "{}",
      }),
      { params: Promise.resolve({ slot: "first" }) },
    );

    expect(anonymous.status).toBe(401);
    await expect(anonymous.json()).resolves.toEqual({
      code: "COMMUTE_AUTH_REQUIRED",
      message: "Sign in with Google to manage your trips.",
    });
    expect(previewForRider).not.toHaveBeenCalled();

    const operator = createCommutePreviewPost({
      readRider: vi.fn(
        async () =>
          ({
            userId: "operator-a",
            role: "owner",
          }) as never,
      ),
      preview: { previewForRider },
    });
    const deniedOperator = await operator(
      request("/api/me/commutes/first/preview", {
        method: "POST",
        body: "{}",
      }),
      { params: Promise.resolve({ slot: "first" }) },
    );
    expect(deniedOperator.status).toBe(401);
    expect(previewForRider).not.toHaveBeenCalled();
  });

  it("requires the exact slot, empty JSON object, and same-origin mutation", async () => {
    const previewForRider = vi.fn(async () => ({
      subject: "Preview",
      html: "<p>Preview</p>",
      text: "Ready",
    }));
    const post = createCommutePreviewPost({
      readRider: vi.fn(async () => rider),
      preview: { previewForRider },
    });

    const invalidSlot = await post(
      request("/api/me/commutes/other/preview", {
        method: "POST",
        body: "{}",
      }),
      { params: Promise.resolve({ slot: "other" }) },
    );
    expect(invalidSlot.status).toBe(400);

    const extraBody = await post(
      request("/api/me/commutes/first/preview", {
        method: "POST",
        body: '{"ignored":true}',
      }),
      { params: Promise.resolve({ slot: "first" }) },
    );
    expect(extraBody.status).toBe(400);

    const crossSite = await post(
      new Request("https://unbroken.test/api/me/commutes/first/preview", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: "https://evil.test",
          "Sec-Fetch-Site": "cross-site",
        },
        body: "{}",
      }),
      { params: Promise.resolve({ slot: "first" }) },
    );
    expect(crossSite.status).toBe(403);
    await expect(crossSite.json()).resolves.toEqual({
      code: "COMMUTE_CSRF_FORBIDDEN",
      message: "This request could not be verified. Try again.",
    });
    expect(previewForRider).not.toHaveBeenCalled();
  });

  it("rejects malformed and oversized bodies even without Content-Length", async () => {
    const previewForRider = vi.fn(async () => ({
      subject: "Preview",
      html: "<p>Preview</p>",
      text: "Ready",
    }));
    const post = createCommutePreviewPost({
      readRider: vi.fn(async () => rider),
      preview: { previewForRider },
    });

    const malformed = await post(
      request("/api/me/commutes/first/preview", {
        method: "POST",
        body: "{not-json",
      }),
      { params: Promise.resolve({ slot: "first" }) },
    );
    expect(malformed.status).toBe(400);

    const oversized = await post(
      request("/api/me/commutes/first/preview", {
        method: "POST",
        body: `{"padding":"${"x".repeat(70 * 1024)}"}`,
      }),
      { params: Promise.resolve({ slot: "first" }) },
    );
    expect(oversized.status).toBe(400);
    expect(previewForRider).not.toHaveBeenCalled();
  });

  it("fails closed for a missing or malformed preview and hides dependency errors", async () => {
    const missing = createCommutePreviewPost({
      readRider: vi.fn(async () => rider),
      preview: { previewForRider: vi.fn(async () => null) },
    });
    const missingResponse = await missing(
      request("/api/me/commutes/first/preview", {
        method: "POST",
        body: "{}",
      }),
      { params: Promise.resolve({ slot: "first" }) },
    );
    expect(missingResponse.status).toBe(503);

    const malformed = createCommutePreviewPost({
      readRider: vi.fn(async () => rider),
      preview: {
        previewForRider: vi.fn(
          async () =>
            ({
              subject: "ok",
              text: "\u0000private",
            }) as never,
        ),
      },
    });
    const malformedResponse = await malformed(
      request("/api/me/commutes/first/preview", {
        method: "POST",
        body: "{}",
      }),
      { params: Promise.resolve({ slot: "first" }) },
    );
    expect(malformedResponse.status).toBe(503);

    const thrown = createCommutePreviewPost({
      readRider: vi.fn(async () => rider),
      preview: {
        previewForRider: vi.fn(async () => {
          throw new Error("private planner URL and provider token");
        }),
      },
    });
    const thrownResponse = await thrown(
      request("/api/me/commutes/first/preview", {
        method: "POST",
        body: "{}",
      }),
      { params: Promise.resolve({ slot: "first" }) },
    );
    expect(thrownResponse.status).toBe(503);
    const thrownBody = await thrownResponse.json();
    expect(thrownBody).toEqual({
      code: "COMMUTE_UNAVAILABLE",
      message: "Your trips are unavailable right now.",
    });
    expect(JSON.stringify(thrownBody)).not.toMatch(/planner|provider|token/iu);
  });

  it("binds the exact return slot and fails closed for malformed rate decisions", async () => {
    const previewForRider = vi.fn(async () => ({
      subject: "Preview",
      html: "<p>Preview</p>",
      text: "Ready",
    }));
    const post = createCommutePreviewPost({
      readRider: vi.fn(async () => rider),
      preview: { previewForRider },
      admitPreview: vi.fn(() => ({ allowed: true })),
    });
    const response = await post(
      request("/api/me/commutes/return/preview", {
        method: "POST",
        body: "{}",
      }),
      { params: Promise.resolve({ slot: "return" }) },
    );
    expect(response.status).toBe(200);
    expect(previewForRider).toHaveBeenCalledWith("rider-a", "return");

    for (const decision of [
      {},
      { allowed: true, extra: true },
      { allowed: "yes" },
    ]) {
      const malformedGate = createCommutePreviewPost({
        readRider: vi.fn(async () => rider),
        preview: { previewForRider },
        admitPreview: vi.fn(() => decision as never),
      });
      const malformed = await malformedGate(
        request("/api/me/commutes/first/preview", {
          method: "POST",
          body: "{}",
        }),
        { params: Promise.resolve({ slot: "first" }) },
      );
      expect(malformed.status).toBe(503);
      expect(malformed.headers.get("cache-control")).toBe(
        "no-store, max-age=0",
      );
    }

    const throwingGate = createCommutePreviewPost({
      readRider: vi.fn(async () => rider),
      preview: { previewForRider },
      admitPreview: vi.fn(() => {
        throw new Error("private limiter details");
      }),
    });
    const thrown = await throwingGate(
      request("/api/me/commutes/first/preview", {
        method: "POST",
        body: "{}",
      }),
      { params: Promise.resolve({ slot: "first" }) },
    );
    expect(thrown.status).toBe(503);
    expect(thrown.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("applies a bounded per-rider rate decision before planning", async () => {
    const previewForRider = vi.fn(async () => ({
      subject: "Preview",
      html: "<p>Preview</p>",
      text: "Ready",
    }));
    const post = createCommutePreviewPost({
      readRider: vi.fn(async () => rider),
      preview: { previewForRider },
      admitPreview: vi.fn(() => ({ allowed: false, retryAfterSeconds: 4 })),
    });

    const response = await post(
      request("/api/me/commutes/first/preview", {
        method: "POST",
        body: "{}",
      }),
      { params: Promise.resolve({ slot: "first" }) },
    );

    expect(response.status).toBe(429);
    expect(response.headers.get("cache-control")).toBe("no-store, max-age=0");
    expect(response.headers.get("retry-after")).toBe("4");
    await expect(response.json()).resolves.toEqual({
      code: "COMMUTE_PREVIEW_RATE_LIMITED",
      message: "Please wait a moment and try again.",
    });
    expect(previewForRider).not.toHaveBeenCalled();
  });
});

describe("GET /api/me/email-history", () => {
  it("keeps both slots on one service date and returns only the safe projection", async () => {
    const listForRider = vi.fn(async () => [
      {
        serviceDate: "2026-08-20",
        slot: "return" as const,
        status: "failed" as const,
        providerMessageId: "private-provider-id",
      },
      {
        serviceDate: "2026-08-20",
        slot: "first" as const,
        status: "sent" as const,
        errorCode: "private-error",
      },
    ]);
    const get = createEmailHistoryGet({
      readRider: vi.fn(async () => rider),
      history: { listForRider },
    });

    const response = await get(
      new Request("https://unbroken.test/api/me/email-history"),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store, max-age=0");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    await expect(response.json()).resolves.toEqual({
      deliveries: [
        { serviceDate: "2026-08-20", slot: "first", status: "sent" },
        { serviceDate: "2026-08-20", slot: "return", status: "failed" },
      ],
    });
    expect(listForRider).toHaveBeenCalledWith("rider-a");
  });
});
