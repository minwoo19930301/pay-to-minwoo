import { createClient, type Client, type InArgs, type Row } from "@libsql/client";
import type {
  AuditLog,
  DonationIntent,
  IdempotencyRecord,
  LabSnapshot,
  LedgerEntry,
  PaymentAttempt,
  ProviderEvent,
  SettlementRecord
} from "../domain.js";
import { toSortedSnapshot } from "../domain.js";
import type { PaymentLabRepository } from "./payment-lab-repository.js";

type JsonObject = Record<string, unknown>;

function valueAsString(value: unknown): string | undefined {
  return typeof value === "string" ? value : value == null ? undefined : String(value);
}

function valueAsNumber(value: unknown): number {
  return typeof value === "number" ? value : Number(value ?? 0);
}

function valueAsBoolean(value: unknown): boolean {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "number") {
    return value !== 0;
  }

  return value === "1" || value === "true";
}

function valueAsJson(value: unknown): JsonObject | undefined {
  if (value == null) {
    return undefined;
  }

  if (typeof value === "string") {
    return JSON.parse(value) as JsonObject;
  }

  return value as JsonObject;
}

function parseIntent(row: Row): DonationIntent {
  const donor = valueAsJson(row.donor) ?? {};

  return {
    id: valueAsString(row.id)!,
    idempotencyKey: valueAsString(row.idempotency_key)!,
    itemName: valueAsString(row.item_name)!,
    region: valueAsString(row.region)! as DonationIntent["region"],
    money: {
      amount: valueAsNumber(row.amount),
      currency: valueAsString(row.currency)!
    },
    donor: {
      name: valueAsString(donor.name)!,
      email: valueAsString(donor.email)!,
      note: valueAsString(donor.note)
    },
    status: valueAsString(row.status)! as DonationIntent["status"],
    activeAttemptId: valueAsString(row.active_attempt_id),
    createdAt: valueAsString(row.created_at)!,
    updatedAt: valueAsString(row.updated_at)!
  };
}

function parseAttempt(row: Row): PaymentAttempt {
  return {
    id: valueAsString(row.id)!,
    intentId: valueAsString(row.intent_id)!,
    provider: valueAsString(row.provider)! as PaymentAttempt["provider"],
    providerPaymentId: valueAsString(row.provider_payment_id)!,
    status: valueAsString(row.status)! as PaymentAttempt["status"],
    checkoutUrl: valueAsString(row.checkout_url)!,
    createdAt: valueAsString(row.created_at)!,
    updatedAt: valueAsString(row.updated_at)!,
    lastEventId: valueAsString(row.last_event_id)
  };
}

function parseProviderEvent(row: Row): ProviderEvent {
  return {
    id: valueAsString(row.id)!,
    attemptId: valueAsString(row.attempt_id)!,
    intentId: valueAsString(row.intent_id)!,
    provider: valueAsString(row.provider)! as ProviderEvent["provider"],
    type: valueAsString(row.type)! as ProviderEvent["type"],
    source: valueAsString(row.source)! as ProviderEvent["source"],
    signatureVerified: valueAsBoolean(row.signature_verified),
    payload: valueAsJson(row.payload) ?? {},
    receivedAt: valueAsString(row.received_at)!
  };
}

function parseAuditLog(row: Row): AuditLog {
  return {
    id: valueAsString(row.id)!,
    entityType: valueAsString(row.entity_type)! as AuditLog["entityType"],
    entityId: valueAsString(row.entity_id)!,
    action: valueAsString(row.action)!,
    actor: valueAsString(row.actor)! as AuditLog["actor"],
    message: valueAsString(row.message)!,
    metadata: valueAsJson(row.metadata),
    createdAt: valueAsString(row.created_at)!
  };
}

function parseIdempotency(row: Row): IdempotencyRecord {
  return {
    id: valueAsString(row.id)!,
    scope: valueAsString(row.scope)!,
    key: valueAsString(row.key)!,
    resourceType: valueAsString(row.resource_type)! as IdempotencyRecord["resourceType"],
    resourceId: valueAsString(row.resource_id)!,
    createdAt: valueAsString(row.created_at)!
  };
}

function parseSettlement(row: Row): SettlementRecord {
  return {
    id: valueAsString(row.id)!,
    attemptId: valueAsString(row.attempt_id)!,
    intentId: valueAsString(row.intent_id)!,
    currency: valueAsString(row.currency)!,
    grossAmount: valueAsNumber(row.gross_amount),
    feeAmount: valueAsNumber(row.fee_amount),
    netAmount: valueAsNumber(row.net_amount),
    status: valueAsString(row.status)! as SettlementRecord["status"],
    payoutReference: valueAsString(row.payout_reference),
    createdAt: valueAsString(row.created_at)!,
    updatedAt: valueAsString(row.updated_at)!,
    paidOutAt: valueAsString(row.paid_out_at)
  };
}

function parseLedgerEntry(row: Row): LedgerEntry {
  return {
    id: valueAsString(row.id)!,
    attemptId: valueAsString(row.attempt_id)!,
    intentId: valueAsString(row.intent_id)!,
    settlementId: valueAsString(row.settlement_id),
    type: valueAsString(row.type)! as LedgerEntry["type"],
    amount: valueAsNumber(row.amount),
    currency: valueAsString(row.currency)!,
    direction: valueAsString(row.direction)! as LedgerEntry["direction"],
    createdAt: valueAsString(row.created_at)!,
    metadata: valueAsJson(row.metadata)
  };
}

export class TursoPaymentLabRepository implements PaymentLabRepository {
  private readonly ready: Promise<void>;

  constructor(private readonly db: Client) {
    this.ready = this.initialize();
  }

  async getSnapshot(): Promise<LabSnapshot> {
    const [intents, attempts, providerEvents, auditLogs, idempotencyRecords, settlements, ledgerEntries] = await Promise.all([
      this.queryRows("SELECT * FROM donation_intents"),
      this.queryRows("SELECT * FROM payment_attempts"),
      this.queryRows("SELECT * FROM provider_events"),
      this.queryRows("SELECT * FROM audit_logs"),
      this.queryRows("SELECT * FROM idempotency_records"),
      this.queryRows("SELECT * FROM settlement_records"),
      this.queryRows("SELECT * FROM ledger_entries")
    ]);

    return toSortedSnapshot({
      intents: intents.map(parseIntent),
      attempts: attempts.map(parseAttempt),
      providerEvents: providerEvents.map(parseProviderEvent),
      auditLogs: auditLogs.map(parseAuditLog),
      idempotencyRecords: idempotencyRecords.map(parseIdempotency),
      settlements: settlements.map(parseSettlement),
      ledgerEntries: ledgerEntries.map(parseLedgerEntry)
    });
  }

  async reset(): Promise<void> {
    await this.executeMany([
      "DELETE FROM ledger_entries",
      "DELETE FROM settlement_records",
      "DELETE FROM idempotency_records",
      "DELETE FROM audit_logs",
      "DELETE FROM provider_events",
      "DELETE FROM payment_attempts",
      "DELETE FROM donation_intents"
    ]);
  }

  async getIntent(id: string): Promise<DonationIntent | undefined> {
    const rows = await this.queryRows("SELECT * FROM donation_intents WHERE id = ? LIMIT 1", [id]);
    return rows[0] ? parseIntent(rows[0]) : undefined;
  }

  async saveIntent(intent: DonationIntent): Promise<DonationIntent> {
    await this.execute(
      `INSERT INTO donation_intents (
         id, idempotency_key, item_name, region, amount, currency, donor, status, active_attempt_id, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         idempotency_key = excluded.idempotency_key,
         item_name = excluded.item_name,
         region = excluded.region,
         amount = excluded.amount,
         currency = excluded.currency,
         donor = excluded.donor,
         status = excluded.status,
         active_attempt_id = excluded.active_attempt_id,
         updated_at = excluded.updated_at`,
      [
        intent.id,
        intent.idempotencyKey,
        intent.itemName,
        intent.region,
        intent.money.amount,
        intent.money.currency,
        JSON.stringify(intent.donor),
        intent.status,
        intent.activeAttemptId ?? null,
        intent.createdAt,
        intent.updatedAt
      ]
    );
    return intent;
  }

  async getAttempt(id: string): Promise<PaymentAttempt | undefined> {
    const rows = await this.queryRows("SELECT * FROM payment_attempts WHERE id = ? LIMIT 1", [id]);
    return rows[0] ? parseAttempt(rows[0]) : undefined;
  }

  async findAttemptByProviderPaymentId(
    provider: PaymentAttempt["provider"],
    providerPaymentId: string
  ): Promise<PaymentAttempt | undefined> {
    const rows = await this.queryRows(
      "SELECT * FROM payment_attempts WHERE provider = ? AND provider_payment_id = ? LIMIT 1",
      [provider, providerPaymentId]
    );
    return rows[0] ? parseAttempt(rows[0]) : undefined;
  }

  async saveAttempt(attempt: PaymentAttempt): Promise<PaymentAttempt> {
    await this.execute(
      `INSERT INTO payment_attempts (
         id, intent_id, provider, provider_payment_id, status, checkout_url, created_at, updated_at, last_event_id
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         intent_id = excluded.intent_id,
         provider = excluded.provider,
         provider_payment_id = excluded.provider_payment_id,
         status = excluded.status,
         checkout_url = excluded.checkout_url,
         updated_at = excluded.updated_at,
         last_event_id = excluded.last_event_id`,
      [
        attempt.id,
        attempt.intentId,
        attempt.provider,
        attempt.providerPaymentId,
        attempt.status,
        attempt.checkoutUrl,
        attempt.createdAt,
        attempt.updatedAt,
        attempt.lastEventId ?? null
      ]
    );
    return attempt;
  }

  async saveProviderEvent(event: ProviderEvent): Promise<ProviderEvent> {
    await this.execute(
      `INSERT INTO provider_events (
         id, attempt_id, intent_id, provider, type, source, signature_verified, payload, received_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         signature_verified = excluded.signature_verified,
         payload = excluded.payload,
         received_at = excluded.received_at`,
      [
        event.id,
        event.attemptId,
        event.intentId,
        event.provider,
        event.type,
        event.source,
        event.signatureVerified ? 1 : 0,
        JSON.stringify(event.payload),
        event.receivedAt
      ]
    );
    return event;
  }

  async saveAuditLog(log: AuditLog): Promise<AuditLog> {
    await this.execute(
      `INSERT INTO audit_logs (
         id, entity_type, entity_id, action, actor, message, metadata, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         message = excluded.message,
         metadata = excluded.metadata,
         created_at = excluded.created_at`,
      [
        log.id,
        log.entityType,
        log.entityId,
        log.action,
        log.actor,
        log.message,
        log.metadata ? JSON.stringify(log.metadata) : null,
        log.createdAt
      ]
    );
    return log;
  }

  async saveIdempotency(record: IdempotencyRecord): Promise<IdempotencyRecord> {
    await this.execute(
      `INSERT INTO idempotency_records (
         id, scope, key, resource_type, resource_id, created_at
       ) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(scope, key) DO UPDATE SET
         resource_type = excluded.resource_type,
         resource_id = excluded.resource_id`,
      [record.id, record.scope, record.key, record.resourceType, record.resourceId, record.createdAt]
    );
    return record;
  }

  async findIdempotency(scope: string, key: string): Promise<IdempotencyRecord | undefined> {
    const rows = await this.queryRows(
      "SELECT * FROM idempotency_records WHERE scope = ? AND key = ? LIMIT 1",
      [scope, key]
    );
    return rows[0] ? parseIdempotency(rows[0]) : undefined;
  }

  async getSettlement(id: string): Promise<SettlementRecord | undefined> {
    const rows = await this.queryRows("SELECT * FROM settlement_records WHERE id = ? LIMIT 1", [id]);
    return rows[0] ? parseSettlement(rows[0]) : undefined;
  }

  async saveSettlement(settlement: SettlementRecord): Promise<SettlementRecord> {
    await this.execute(
      `INSERT INTO settlement_records (
         id, attempt_id, intent_id, currency, gross_amount, fee_amount, net_amount, status, payout_reference, created_at, updated_at, paid_out_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         gross_amount = excluded.gross_amount,
         fee_amount = excluded.fee_amount,
         net_amount = excluded.net_amount,
         status = excluded.status,
         payout_reference = excluded.payout_reference,
         updated_at = excluded.updated_at,
         paid_out_at = excluded.paid_out_at`,
      [
        settlement.id,
        settlement.attemptId,
        settlement.intentId,
        settlement.currency,
        settlement.grossAmount,
        settlement.feeAmount,
        settlement.netAmount,
        settlement.status,
        settlement.payoutReference ?? null,
        settlement.createdAt,
        settlement.updatedAt,
        settlement.paidOutAt ?? null
      ]
    );
    return settlement;
  }

  async findSettlementByAttempt(attemptId: string): Promise<SettlementRecord | undefined> {
    const rows = await this.queryRows(
      "SELECT * FROM settlement_records WHERE attempt_id = ? ORDER BY created_at DESC LIMIT 1",
      [attemptId]
    );
    return rows[0] ? parseSettlement(rows[0]) : undefined;
  }

  async listSettlementsByAttempt(attemptId: string): Promise<SettlementRecord[]> {
    const rows = await this.queryRows(
      "SELECT * FROM settlement_records WHERE attempt_id = ? ORDER BY created_at DESC",
      [attemptId]
    );
    return rows.map(parseSettlement);
  }

  async saveLedgerEntry(entry: LedgerEntry): Promise<LedgerEntry> {
    await this.execute(
      `INSERT INTO ledger_entries (
         id, attempt_id, intent_id, settlement_id, type, amount, currency, direction, created_at, metadata
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         metadata = excluded.metadata`,
      [
        entry.id,
        entry.attemptId,
        entry.intentId,
        entry.settlementId ?? null,
        entry.type,
        entry.amount,
        entry.currency,
        entry.direction,
        entry.createdAt,
        entry.metadata ? JSON.stringify(entry.metadata) : null
      ]
    );
    return entry;
  }

  async listLedgerEntriesByAttempt(attemptId: string): Promise<LedgerEntry[]> {
    const rows = await this.queryRows(
      "SELECT * FROM ledger_entries WHERE attempt_id = ? ORDER BY created_at DESC",
      [attemptId]
    );
    return rows.map(parseLedgerEntry);
  }

  async listEventsByAttempt(attemptId: string): Promise<ProviderEvent[]> {
    const rows = await this.queryRows(
      "SELECT * FROM provider_events WHERE attempt_id = ? ORDER BY received_at DESC",
      [attemptId]
    );
    return rows.map(parseProviderEvent);
  }

  async listAuditLogsForAttempt(attemptId: string, intentId: string): Promise<AuditLog[]> {
    const rows = await this.queryRows("SELECT * FROM audit_logs ORDER BY created_at DESC");

    return rows
      .map(parseAuditLog)
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
      });
  }

  private async initialize(): Promise<void> {
    await this.db.execute("PRAGMA foreign_keys = ON");
  }

  private async queryRows(sql: string, args: InArgs = []): Promise<Row[]> {
    await this.ready;
    const result = await this.db.execute({ sql, args });
    return result.rows;
  }

  private async execute(sql: string, args: InArgs = []): Promise<void> {
    await this.ready;
    await this.db.execute({ sql, args });
  }

  private async executeMany(statements: string[]): Promise<void> {
    await this.ready;
    await this.db.batch(
      statements.map((sql) => ({ sql })),
      "write"
    );
  }
}

const globalRepository = globalThis as typeof globalThis & {
  __PAYMENT_LAB_TURSO_REPOSITORY__?: TursoPaymentLabRepository;
};

export function getTursoPaymentLabRepository(databaseUrl: string, authToken: string): TursoPaymentLabRepository {
  if (!globalRepository.__PAYMENT_LAB_TURSO_REPOSITORY__) {
    globalRepository.__PAYMENT_LAB_TURSO_REPOSITORY__ = new TursoPaymentLabRepository(
      createClient({
        url: databaseUrl,
        authToken
      })
    );
  }

  return globalRepository.__PAYMENT_LAB_TURSO_REPOSITORY__;
}
