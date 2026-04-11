import type {
  AuditLog,
  DonationIntent,
  IdempotencyRecord,
  LedgerEntry,
  LabSnapshot,
  PaymentAttempt,
  ProviderEvent,
  SettlementRecord
} from "../domain.js";
import { toSortedSnapshot } from "../domain.js";
import type { PaymentLabRepository } from "./payment-lab-repository.js";

export class InMemoryPaymentLabRepository implements PaymentLabRepository {
  private readonly intents = new Map<string, DonationIntent>();
  private readonly attempts = new Map<string, PaymentAttempt>();
  private readonly providerEvents = new Map<string, ProviderEvent>();
  private readonly auditLogs = new Map<string, AuditLog>();
  private readonly idempotency = new Map<string, IdempotencyRecord>();
  private readonly settlements = new Map<string, SettlementRecord>();
  private readonly ledgerEntries = new Map<string, LedgerEntry>();

  async getSnapshot(): Promise<LabSnapshot> {
    return toSortedSnapshot({
      intents: Array.from(this.intents.values()),
      attempts: Array.from(this.attempts.values()),
      providerEvents: Array.from(this.providerEvents.values()),
      auditLogs: Array.from(this.auditLogs.values()),
      idempotencyRecords: Array.from(this.idempotency.values()),
      settlements: Array.from(this.settlements.values()),
      ledgerEntries: Array.from(this.ledgerEntries.values())
    });
  }

  async reset(): Promise<void> {
    this.intents.clear();
    this.attempts.clear();
    this.providerEvents.clear();
    this.auditLogs.clear();
    this.idempotency.clear();
    this.settlements.clear();
    this.ledgerEntries.clear();
  }

  async getIntent(id: string): Promise<DonationIntent | undefined> {
    return this.intents.get(id);
  }

  async saveIntent(intent: DonationIntent): Promise<DonationIntent> {
    this.intents.set(intent.id, intent);
    return intent;
  }

  async getAttempt(id: string): Promise<PaymentAttempt | undefined> {
    return this.attempts.get(id);
  }

  async findAttemptByProviderPaymentId(provider: PaymentAttempt["provider"], providerPaymentId: string): Promise<PaymentAttempt | undefined> {
    return Array.from(this.attempts.values()).find((attempt) => (
      attempt.provider === provider && attempt.providerPaymentId === providerPaymentId
    ));
  }

  async saveAttempt(attempt: PaymentAttempt): Promise<PaymentAttempt> {
    this.attempts.set(attempt.id, attempt);
    return attempt;
  }

  async saveProviderEvent(event: ProviderEvent): Promise<ProviderEvent> {
    this.providerEvents.set(event.id, event);
    return event;
  }

  async saveAuditLog(log: AuditLog): Promise<AuditLog> {
    this.auditLogs.set(log.id, log);
    return log;
  }

  async saveIdempotency(record: IdempotencyRecord): Promise<IdempotencyRecord> {
    this.idempotency.set(this.toIdempotencyMapKey(record.scope, record.key), record);
    return record;
  }

  async findIdempotency(scope: string, key: string): Promise<IdempotencyRecord | undefined> {
    return this.idempotency.get(this.toIdempotencyMapKey(scope, key));
  }

  async getSettlement(id: string): Promise<SettlementRecord | undefined> {
    return this.settlements.get(id);
  }

  async saveSettlement(settlement: SettlementRecord): Promise<SettlementRecord> {
    this.settlements.set(settlement.id, settlement);
    return settlement;
  }

  async findSettlementByAttempt(attemptId: string): Promise<SettlementRecord | undefined> {
    return Array.from(this.settlements.values()).find((settlement) => settlement.attemptId === attemptId);
  }

  async listSettlementsByAttempt(attemptId: string): Promise<SettlementRecord[]> {
    return Array.from(this.settlements.values())
      .filter((settlement) => settlement.attemptId === attemptId)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  async saveLedgerEntry(entry: LedgerEntry): Promise<LedgerEntry> {
    this.ledgerEntries.set(entry.id, entry);
    return entry;
  }

  async listLedgerEntriesByAttempt(attemptId: string): Promise<LedgerEntry[]> {
    return Array.from(this.ledgerEntries.values())
      .filter((entry) => entry.attemptId === attemptId)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  async listEventsByAttempt(attemptId: string): Promise<ProviderEvent[]> {
    return Array.from(this.providerEvents.values())
      .filter((event) => event.attemptId === attemptId)
      .sort((left, right) => right.receivedAt.localeCompare(left.receivedAt));
  }

  async listAuditLogsForAttempt(attemptId: string, intentId: string): Promise<AuditLog[]> {
    return Array.from(this.auditLogs.values())
      .filter((log) => {
        if (log.entityType === "attempt" && log.entityId === attemptId) {
          return true;
        }

        if (log.entityType === "intent" && log.entityId === intentId) {
          return true;
        }

        if (log.entityType === "provider_event") {
          return log.metadata?.attemptId === attemptId;
        }

        return false;
      })
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  private toIdempotencyMapKey(scope: string, key: string): string {
    return `${scope}:${key}`;
  }
}

const globalRepository = globalThis as typeof globalThis & {
  __PAYMENT_LAB_MEMORY_REPOSITORY__?: InMemoryPaymentLabRepository;
};

export function getMemoryPaymentLabRepository(): InMemoryPaymentLabRepository {
  if (!globalRepository.__PAYMENT_LAB_MEMORY_REPOSITORY__) {
    globalRepository.__PAYMENT_LAB_MEMORY_REPOSITORY__ = new InMemoryPaymentLabRepository();
  }

  return globalRepository.__PAYMENT_LAB_MEMORY_REPOSITORY__;
}
