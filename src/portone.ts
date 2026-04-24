import { PaymentClient, Webhook } from "@portone/server-sdk";

export type PortOnePayMethod = "CARD" | "TRANSFER";

export type PortOneCredentials = {
  storeId: string;
  channelKey: string;
  apiSecret: string;
  webhookSecret?: string;
};

export function normalizePortOnePayMethod(value: unknown): PortOnePayMethod {
  return value === "TRANSFER" ? "TRANSFER" : "CARD";
}

export function isPortOneConfigured() {
  return Boolean(
    process.env.PORTONE_STORE_ID?.trim() &&
      process.env.PORTONE_CHANNEL_KEY?.trim() &&
      process.env.PORTONE_API_SECRET?.trim()
  );
}

export function getPortOneCredentials(): PortOneCredentials {
  const storeId = process.env.PORTONE_STORE_ID?.trim();
  const channelKey = process.env.PORTONE_CHANNEL_KEY?.trim();
  const apiSecret = process.env.PORTONE_API_SECRET?.trim();

  if (!storeId || !channelKey || !apiSecret) {
    throw new Error("PortOne credentials are not configured.");
  }

  return {
    storeId,
    channelKey,
    apiSecret,
    webhookSecret: process.env.PORTONE_WEBHOOK_SECRET?.trim() || undefined
  };
}

export function getPortOneWebhookHeaders(headers: Headers) {
  const webhookId = headers.get("webhook-id") ?? "";
  const webhookSignature = headers.get("webhook-signature") ?? "";
  const webhookTimestamp = headers.get("webhook-timestamp") ?? "";

  if (!webhookId || !webhookSignature || !webhookTimestamp) {
    return null;
  }

  return {
    "webhook-id": webhookId,
    "webhook-signature": webhookSignature,
    "webhook-timestamp": webhookTimestamp
  };
}

export async function getPortOnePayment(credentials: PortOneCredentials, paymentId: string) {
  const client = PaymentClient({ secret: credentials.apiSecret });
  return client.getPayment({ paymentId });
}

export async function verifyPortOneWebhook(input: {
  webhookSecret: string;
  payload: string;
  headers: Record<string, string>;
}) {
  return Webhook.verify(input.webhookSecret, input.payload, input.headers);
}
