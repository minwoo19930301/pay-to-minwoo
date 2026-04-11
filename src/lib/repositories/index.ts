import type { AppBindings } from "../bindings.js";
import { getBinding, getStorageBackend } from "../config.js";
import { getMemoryPaymentLabRepository } from "./payment-lab-repository-memory.js";
import type { PaymentLabRepository } from "./payment-lab-repository.js";
import { getTursoPaymentLabRepository } from "./payment-lab-repository-turso.js";

export function getPaymentLabRepository(env: AppBindings): PaymentLabRepository {
  if (getStorageBackend(env) === "turso") {
    const databaseUrl = getBinding(env, "TURSO_DATABASE_URL")?.trim();
    const authToken = getBinding(env, "TURSO_AUTH_TOKEN")?.trim();

    if (!databaseUrl || !authToken) {
      throw new Error("TURSO_DATABASE_URL and TURSO_AUTH_TOKEN are required when PAYMENT_STORAGE=turso.");
    }

    return getTursoPaymentLabRepository(databaseUrl, authToken);
  }

  return getMemoryPaymentLabRepository();
}
