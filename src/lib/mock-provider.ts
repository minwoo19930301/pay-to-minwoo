import type { ProviderEventType } from "./domain.js";
import { createEntityId } from "./domain.js";

export type MockCheckoutSession = {
  provider: "mock";
  providerPaymentId: string;
  checkoutUrl: string;
};

export function createMockCheckoutSession(baseUrl: string, attemptId: string): MockCheckoutSession {
  const checkoutUrl = new URL(`/demo/checkout/${attemptId}`, baseUrl);

  return {
    provider: "mock",
    providerPaymentId: createEntityId("mockpay"),
    checkoutUrl: checkoutUrl.toString()
  };
}

export function makeMockEventPayload(type: ProviderEventType, attemptId: string): Record<string, unknown> {
  return {
    eventId: createEntityId("evt"),
    type,
    attemptId,
    provider: "mock",
    happenedAt: new Date().toISOString()
  };
}

async function importWebhookKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    {
      name: "HMAC",
      hash: "SHA-256"
    },
    false,
    ["sign"]
  );
}

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function signMockWebhook(secret: string, payload: string): Promise<string> {
  const key = await importWebhookKey(secret);
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  return toHex(signature);
}

export async function verifyMockWebhook(secret: string, payload: string, signature: string): Promise<boolean> {
  const expected = await signMockWebhook(secret, payload);
  return expected === signature;
}
