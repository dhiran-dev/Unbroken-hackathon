import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { GET } from "@/app/api/public/signup-availability/route";

const original = {
  flag: process.env.PUBLIC_GOOGLE_SIGNUP_ENABLED,
  id: process.env.GOOGLE_CLIENT_ID,
  secret: process.env.GOOGLE_CLIENT_SECRET,
};

describe("public signup availability route", () => {
  beforeEach(() => {
    process.env.GOOGLE_CLIENT_ID = "test-client-id";
    process.env.GOOGLE_CLIENT_SECRET = "test-server-secret";
  });

  afterEach(() => {
    if (original.flag === undefined)
      delete process.env.PUBLIC_GOOGLE_SIGNUP_ENABLED;
    else process.env.PUBLIC_GOOGLE_SIGNUP_ENABLED = original.flag;
    if (original.id === undefined) delete process.env.GOOGLE_CLIENT_ID;
    else process.env.GOOGLE_CLIENT_ID = original.id;
    if (original.secret === undefined) delete process.env.GOOGLE_CLIENT_SECRET;
    else process.env.GOOGLE_CLIENT_SECRET = original.secret;
  });

  it("returns a safe unavailable projection when the exact flag is off", async () => {
    process.env.PUBLIC_GOOGLE_SIGNUP_ENABLED = "false";
    const response = await GET();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    await expect(response.json()).resolves.toEqual({
      available: false,
      message:
        "Continue with Google if you already have an account. New rider signup is currently unavailable.",
    });
  });

  it("returns only the public boolean and message when enabled", async () => {
    process.env.PUBLIC_GOOGLE_SIGNUP_ENABLED = "true";
    const response = await GET();
    const body = await response.json();
    expect(body).toEqual({
      available: true,
      message: "Continue with Google to sign in or create a rider account.",
    });
    expect(JSON.stringify(body)).not.toContain("test-server-secret");
  });
});
