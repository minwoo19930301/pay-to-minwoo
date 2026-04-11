import type { AppBindings } from "./bindings.js";

export function getBinding(env: AppBindings, key: keyof AppBindings): string | undefined {
  const bound = env[key];
  if (typeof bound === "string" && bound.trim().length > 0) {
    return bound;
  }

  if (typeof process !== "undefined" && process.env) {
    const runtimeValue = process.env[key];
    if (typeof runtimeValue === "string" && runtimeValue.trim().length > 0) {
      return runtimeValue;
    }
  }

  return undefined;
}

export function getPublicBaseUrl(env: AppBindings): string {
  const configured = getBinding(env, "PUBLIC_BASE_URL")?.trim();
  return configured && configured.length > 0 ? configured : "http://127.0.0.1:3000";
}

export function getAppName(env: AppBindings): string {
  return getBinding(env, "APP_NAME")?.trim() || "pay-to-minwoo";
}

export function getPaymentMode(env: AppBindings): "mock" | "live" {
  return getBinding(env, "PAYMENT_MODE")?.trim() === "live" ? "live" : "mock";
}

export function getStorageBackend(env: AppBindings): "memory" | "turso" {
  return getBinding(env, "PAYMENT_STORAGE")?.trim() === "turso" ? "turso" : "memory";
}

export function getMockWebhookSecret(env: AppBindings): string {
  return getBinding(env, "MOCK_WEBHOOK_SECRET")?.trim() || "pay-to-minwoo-dev-secret";
}

export function getPayPalEnvironment(env: AppBindings): "sandbox" | "live" {
  return getBinding(env, "PAYPAL_ENV")?.trim() === "live" ? "live" : "sandbox";
}

export function getPayPalCredentials(env: AppBindings): {
  environment: "sandbox" | "live";
  clientId: string;
  clientSecret: string;
  webhookId?: string;
} {
  const clientId = getBinding(env, "PAYPAL_CLIENT_ID")?.trim();
  const clientSecret = getBinding(env, "PAYPAL_CLIENT_SECRET")?.trim();

  if (!clientId || !clientSecret) {
    throw new Error("PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET are required for PayPal routes.");
  }

  return {
    environment: getPayPalEnvironment(env),
    clientId,
    clientSecret,
    webhookId: getBinding(env, "PAYPAL_WEBHOOK_ID")?.trim() || undefined
  };
}
