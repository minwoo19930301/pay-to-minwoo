import type { Config, Context } from "@netlify/functions";
import app from "../../src/index.js";

function getEnv(name: string): string | undefined {
  const netlifyGlobal = globalThis as typeof globalThis & {
    Netlify?: {
      env?: {
        get(name: string): string | undefined;
      };
    };
  };

  const fromNetlify = netlifyGlobal.Netlify?.env?.get(name);
  if (typeof fromNetlify === "string" && fromNetlify.length > 0) {
    return fromNetlify;
  }

  return process.env[name];
}

function buildBindings(context: Context) {
  return {
    APP_NAME: getEnv("APP_NAME"),
    PAYMENT_MODE: getEnv("PAYMENT_MODE"),
    PAYMENT_STORAGE: getEnv("PAYMENT_STORAGE"),
    PUBLIC_BASE_URL: getEnv("PUBLIC_BASE_URL"),
    MOCK_WEBHOOK_SECRET: getEnv("MOCK_WEBHOOK_SECRET"),
    TURSO_DATABASE_URL: getEnv("TURSO_DATABASE_URL"),
    TURSO_AUTH_TOKEN: getEnv("TURSO_AUTH_TOKEN"),
    PAYPAL_ENV: getEnv("PAYPAL_ENV"),
    PAYPAL_CLIENT_ID: getEnv("PAYPAL_CLIENT_ID"),
    PAYPAL_CLIENT_SECRET: getEnv("PAYPAL_CLIENT_SECRET"),
    PAYPAL_WEBHOOK_ID: getEnv("PAYPAL_WEBHOOK_ID"),
    context
  };
}

export default async (req: Request, context: Context) => {
  return app.fetch(req, buildBindings(context) as never);
};

export const config: Config = {
  path: "/*"
};
