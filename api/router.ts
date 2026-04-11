import app from "../src/index.js";
import type { AppBindings } from "../src/lib/bindings.js";

function readEnv(name: keyof AppBindings): string | undefined {
  const value = process.env[name];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function buildBindings(): AppBindings {
  return {
    APP_NAME: readEnv("APP_NAME"),
    PAYMENT_MODE: readEnv("PAYMENT_MODE"),
    PAYMENT_STORAGE: readEnv("PAYMENT_STORAGE"),
    PUBLIC_BASE_URL: readEnv("PUBLIC_BASE_URL"),
    MOCK_WEBHOOK_SECRET: readEnv("MOCK_WEBHOOK_SECRET"),
    TURSO_DATABASE_URL: readEnv("TURSO_DATABASE_URL"),
    TURSO_AUTH_TOKEN: readEnv("TURSO_AUTH_TOKEN"),
    PAYPAL_ENV: readEnv("PAYPAL_ENV"),
    PAYPAL_CLIENT_ID: readEnv("PAYPAL_CLIENT_ID"),
    PAYPAL_CLIENT_SECRET: readEnv("PAYPAL_CLIENT_SECRET"),
    PAYPAL_WEBHOOK_ID: readEnv("PAYPAL_WEBHOOK_ID")
  };
}

export default async function handler(request: Request) {
  return app.fetch(request, buildBindings() as never);
}
