import { describe, expect, it } from "vitest";
import app from "./index.js";
import type { AppBindings } from "./lib/bindings.js";

function createEnv(overrides: Partial<AppBindings> = {}): AppBindings {
  return {
    APP_NAME: "pay-to-minwoo",
    PAYMENT_MODE: "mock",
    PAYMENT_STORAGE: "memory",
    PUBLIC_BASE_URL: "http://127.0.0.1:3000",
    ...overrides
  };
}

describe("app routes", () => {
  it("returns a Korean root summary when Accept-Language prefers ko", async () => {
    const response = await app.fetch(
      new Request("http://localhost/", {
        headers: {
          "accept-language": "ko-KR,ko;q=0.9,en-US;q=0.8"
        }
      }),
      createEnv() as never
    );

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.locale).toBe("ko");
    expect(payload.hosting.primary).toBe("vercel");
    expect(payload.process).toHaveLength(6);
  });

  it("falls back to English root summary when Korean is not requested", async () => {
    const response = await app.fetch(
      new Request("http://localhost/", {
        headers: {
          "accept-language": "en-US,en;q=0.9"
        }
      }),
      createEnv() as never
    );

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.locale).toBe("en");
    expect(payload.domains).toContain("PaymentAttempt");
  });

  it("returns JSON for paypal cancel", async () => {
    const response = await app.fetch(
      new Request("http://localhost/paypal/cancel?attemptId=attempt_123"),
      createEnv() as never
    );

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.canceled).toBe(true);
    expect(payload.attemptId).toBe("attempt_123");
  });

  it("returns 400 JSON when paypal return is missing attemptId", async () => {
    const response = await app.fetch(
      new Request("http://localhost/paypal/return"),
      createEnv() as never
    );

    expect(response.status).toBe(400);
    const payload = await response.json();
    expect(payload.error).toBe("ATTEMPT_ID_MISSING");
  });

  it("returns 410 JSON for the removed demo checkout route", async () => {
    const response = await app.fetch(
      new Request("http://localhost/demo/checkout/attempt_123"),
      createEnv() as never
    );

    expect(response.status).toBe(410);
    const payload = await response.json();
    expect(payload.removed).toBe(true);
  });
});
