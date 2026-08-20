import { describe, expect, it } from "vitest";

import { ResendEmailProvider } from "@/server/notifications/resend";

const request = {
  to: "rider@example.com",
  subject: "Commute update",
  text: "Your commute update is ready.",
  html: "<p>Your commute update is ready.</p>",
  idempotencyKey: "commute/00000000-0000-4000-8000-000000000001/2026-08-19",
};

function response(
  status: number,
  body: unknown = {},
  contentType = "application/json",
) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": contentType },
  });
}

describe("Resend provider seam", () => {
  it("sends matching HTML and text to the fixed endpoint with the permanent idempotency key", async () => {
    const calls: Array<{ input: string | URL; init?: RequestInit }> = [];
    const provider = new ResendEmailProvider({
      apiKey: "secret-token",
      from: "updates@example.com",
      fetchImpl: async (input, init) => {
        calls.push({ input, init });
        return response(200, {
          id: "provider-message-1",
          private: "must not escape",
        });
      },
    });

    await expect(provider.send(request)).resolves.toEqual({
      status: "sent",
      providerMessageId: "provider-message-1",
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.input).toBe("https://api.resend.com/emails");
    expect(calls[0]?.init?.redirect).toBe("error");
    expect(calls[0]?.init?.headers).toMatchObject({
      Authorization: "Bearer secret-token",
      Accept: "application/json",
      "Idempotency-Key": request.idempotencyKey,
    });
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({
      from: "updates@example.com",
      to: request.to,
      subject: request.subject,
      text: request.text,
      html: request.html,
    });
  });

  it.each([
    [408, "timeout"],
    [429, "rate_limited"],
    [402, "quota_exhausted"],
    [503, "provider_error"],
  ] as const)(
    "maps provider status %d to a stable redacted reason",
    async (status, reason) => {
      const provider = new ResendEmailProvider({
        apiKey: "secret-token",
        from: "updates@example.com",
        fetchImpl: async () =>
          response(status, { error: "private-provider-response" }),
      });

      await expect(provider.send(request)).resolves.toEqual({
        status: "failed",
        reason,
      });
    },
  );

  it("maps an abort timeout without exposing the thrown provider object", async () => {
    const provider = new ResendEmailProvider({
      apiKey: "secret-token",
      from: "updates@example.com",
      fetchImpl: async () => {
        throw { name: "AbortError", token: "private-provider-token" };
      },
    });

    await expect(provider.send(request)).resolves.toEqual({
      status: "failed",
      reason: "timeout",
    });
  });

  it("rejects unsafe requests before contacting Resend", async () => {
    let calls = 0;
    const provider = new ResendEmailProvider({
      apiKey: "secret-token",
      from: "updates@example.com",
      fetchImpl: async () => {
        calls += 1;
        return response(200);
      },
    });

    await expect(
      provider.send({ ...request, idempotencyKey: "unsafe" }),
    ).resolves.toEqual({
      status: "failed",
      reason: "provider_error",
    });
    expect(calls).toBe(0);
  });

  it("rejects unsafe provider configuration and calendar keys before contacting Resend", async () => {
    const inputs = [
      { apiKey: "secret token", from: "updates@example.com", input: request },
      { apiKey: "secret-token", from: "updates\n@example.com", input: request },
      {
        apiKey: "secret-token",
        from: "updates@example.com",
        input: {
          ...request,
          idempotencyKey:
            "commute/00000000-0000-4000-8000-000000000001/2026-02-30",
        },
      },
    ];
    for (const input of inputs) {
      let calls = 0;
      const provider = new ResendEmailProvider({
        apiKey: input.apiKey,
        from: input.from,
        fetchImpl: async () => {
          calls += 1;
          return response(200, { id: "provider-message-1" });
        },
      });
      await expect(provider.send(input.input)).resolves.toEqual({
        status: "failed",
        reason: "provider_error",
      });
      expect(calls).toBe(0);
    }
  });

  it("rejects missing, JSONP, and unsafe message fields before contacting Resend", async () => {
    const responses = [
      new Response(JSON.stringify({ id: "provider-message-1" }), {
        status: 200,
      }),
      response(200, { id: "provider-message-1" }, "application/jsonp"),
    ];
    for (const malformed of [
      { ...request, to: " rider@example.com" },
      { ...request, subject: " Commute update" },
      { ...request, text: "bad\u0000text" },
      { ...request, html: "<p>bad\u0000html</p>" },
    ]) {
      let calls = 0;
      const provider = new ResendEmailProvider({
        apiKey: "secret-token",
        from: "updates@example.com",
        fetchImpl: async () => {
          calls += 1;
          return response(200, { id: "provider-message-1" });
        },
      });
      await expect(provider.send(malformed)).resolves.toEqual({
        status: "failed",
        reason: "provider_error",
      });
      expect(calls).toBe(0);
    }
    for (const malformedResponse of responses) {
      const provider = new ResendEmailProvider({
        apiKey: "secret-token",
        from: "updates@example.com",
        fetchImpl: async () => malformedResponse,
      });
      await expect(provider.send(request)).resolves.toEqual({
        status: "failed",
        reason: "provider_error",
      });
    }
  });

  it("fails closed for a successful response with the wrong content type", async () => {
    const provider = new ResendEmailProvider({
      apiKey: "secret-token",
      from: "updates@example.com",
      fetchImpl: async () =>
        response(200, { id: "provider-message-1" }, "text/plain"),
    });

    await expect(provider.send(request)).resolves.toEqual({
      status: "failed",
      reason: "provider_error",
    });
  });

  it("fails closed for malformed or oversized successful response bodies", async () => {
    const malformed = new ResendEmailProvider({
      apiKey: "secret-token",
      from: "updates@example.com",
      fetchImpl: async () =>
        new Response('{"id":', {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    });
    await expect(malformed.send(request)).resolves.toEqual({
      status: "failed",
      reason: "provider_error",
    });

    const oversized = new ResendEmailProvider({
      apiKey: "secret-token",
      from: "updates@example.com",
      fetchImpl: async () =>
        new Response(JSON.stringify({ id: "x" }).padEnd(4_097, "x"), {
          status: 200,
          headers: {
            "content-type": "application/json",
            "content-length": "4097",
          },
        }),
    });
    await expect(oversized.send(request)).resolves.toEqual({
      status: "failed",
      reason: "provider_error",
    });

    const oversizedStream = new ResendEmailProvider({
      apiKey: "secret-token",
      from: "updates@example.com",
      fetchImpl: async () =>
        new Response("x".repeat(4_097), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    });
    await expect(oversizedStream.send(request)).resolves.toEqual({
      status: "failed",
      reason: "provider_error",
    });
  });
});
