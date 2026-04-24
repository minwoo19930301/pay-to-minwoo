import type { Locale } from "./content";

export type AppStage = "dev" | "prod";

export function detectLocale(): Locale {
  if (typeof navigator === "undefined") {
    return "en";
  }

  return navigator.language.toLowerCase().startsWith("ko") ? "ko" : "en";
}

export function getApiBaseUrl(): string {
  const configured = import.meta.env.VITE_API_BASE_URL?.trim();

  if (configured && configured.length > 0) {
    return configured.replace(/\/$/, "");
  }

  if (typeof window !== "undefined") {
    const hostname = window.location.hostname.toLowerCase();
    if (hostname === "localhost" || hostname === "127.0.0.1") {
      return "http://localhost:3000";
    }
  }

  return "https://pay-to-minwoo.vercel.app";
}

export function getAppStage(): AppStage {
  const configured = import.meta.env.VITE_APP_STAGE?.trim().toLowerCase();
  if (configured === "prod" || configured === "production") {
    return "prod";
  }

  if (configured === "dev" || configured === "development" || configured === "preview") {
    return "dev";
  }

  if (typeof window !== "undefined") {
    const hostname = window.location.hostname.toLowerCase();
    if (hostname === "localhost" || hostname === "127.0.0.1") {
      return "dev";
    }
  }

  return "prod";
}

export function isDomesticTestEnabled() {
  const configured = import.meta.env.VITE_ENABLE_DOMESTIC_TEST?.trim().toLowerCase();
  if (configured) {
    return ["1", "true", "yes", "on"].includes(configured);
  }

  return getAppStage() !== "prod";
}
