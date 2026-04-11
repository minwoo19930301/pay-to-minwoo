import type {
  AuditLog,
  DonationIntent,
  IdempotencyRecord,
  LabSnapshot,
  LedgerEntry,
  PaymentAttempt,
  PaymentProvider,
  ProviderEvent,
  SettlementRecord
} from "../domain.js";

export interface PaymentLabRepository {
  getSnapshot(): Promise<LabSnapshot>;
  reset(): Promise<void>;
  getIntent(id: string): Promise<DonationIntent | undefined>;
  saveIntent(intent: DonationIntent): Promise<DonationIntent>;
  getAttempt(id: string): Promise<PaymentAttempt | undefined>;
  findAttemptByProviderPaymentId(provider: PaymentProvider, providerPaymentId: string): Promise<PaymentAttempt | undefined>;
  saveAttempt(attempt: PaymentAttempt): Promise<PaymentAttempt>;
  saveProviderEvent(event: ProviderEvent): Promise<ProviderEvent>;
  saveAuditLog(log: AuditLog): Promise<AuditLog>;
  saveIdempotency(record: IdempotencyRecord): Promise<IdempotencyRecord>;
  findIdempotency(scope: string, key: string): Promise<IdempotencyRecord | undefined>;
  getSettlement(id: string): Promise<SettlementRecord | undefined>;
  saveSettlement(settlement: SettlementRecord): Promise<SettlementRecord>;
  findSettlementByAttempt(attemptId: string): Promise<SettlementRecord | undefined>;
  listSettlementsByAttempt(attemptId: string): Promise<SettlementRecord[]>;
  saveLedgerEntry(entry: LedgerEntry): Promise<LedgerEntry>;
  listLedgerEntriesByAttempt(attemptId: string): Promise<LedgerEntry[]>;
  listEventsByAttempt(attemptId: string): Promise<ProviderEvent[]>;
  listAuditLogsForAttempt(attemptId: string, intentId: string): Promise<AuditLog[]>;
}
