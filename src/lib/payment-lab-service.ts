import { AppError } from "./errors.js";
import {
  assertPositiveAmount,
  calculateMockFee,
  createEntityId,
  getTargetTransition,
  makeTransition,
  normalizeCurrency,
  type AuditActor,
  type CreateIntentInput,
  type DonationIntent,
  type DonationIntentStatus,
  type IdempotencyRecord,
  type LedgerEntry,
  type MockAction,
  type PaymentAttempt,
  type PaymentProvider,
  type ProviderEvent,
  type ProviderEventType,
  type SettlementRecord,
  type SettlementStatus
} from "./domain.js";
import { createMockCheckoutSession, makeMockEventPayload } from "./mock-provider.js";
import type { PaymentLabRepository } from "./repositories/payment-lab-repository.js";

function now(): string {
  return new Date().toISOString();
}

function createIdempotencyKey(): string {
  return createEntityId("idem");
}

export class PaymentLabService {
  constructor(
    private readonly repository: PaymentLabRepository,
    private readonly baseUrl: string
  ) {}

  async getSnapshot() {
    return this.repository.getSnapshot();
  }

  async reset(): Promise<{ ok: true }> {
    await this.repository.reset();
    return { ok: true };
  }

  async getIntent(intentId: string): Promise<DonationIntent> {
    return this.requireIntent(intentId);
  }

  async getSettlement(settlementId: string): Promise<SettlementRecord> {
    return this.requireSettlement(settlementId);
  }

  async getAttempt(attemptId: string) {
    const attempt = await this.requireAttempt(attemptId);
    const intent = await this.requireIntent(attempt.intentId);
    const settlements = await this.repository.listSettlementsByAttempt(attemptId);
    const ledgerEntries = await this.repository.listLedgerEntriesByAttempt(attemptId);

    return {
      intent,
      attempt,
      settlements,
      ledgerEntries,
      payableBalance: this.computeOutstandingBalance(ledgerEntries),
      providerEvents: await this.repository.listEventsByAttempt(attemptId),
      auditLogs: await this.repository.listAuditLogsForAttempt(attemptId, intent.id)
    };
  }

  async createIntent(input: CreateIntentInput) {
    assertPositiveAmount(input.amount);

    const idempotencyKey = input.idempotencyKey?.trim() || createIdempotencyKey();
    const scope = "intent:create";
    const replayed = await this.replayByIdempotency(scope, idempotencyKey, "intent");

    if (replayed) {
      return {
        intent: replayed,
        replayed: true
      };
    }

    const timestamp = now();
    const intent: DonationIntent = {
      id: createEntityId("intent"),
      idempotencyKey,
      itemName: input.itemName.trim(),
      region: input.region,
      money: {
        amount: input.amount,
        currency: normalizeCurrency(input.currency)
      },
      donor: {
        name: input.customerName.trim(),
        email: input.customerEmail.trim().toLowerCase(),
        note: input.note?.trim() || undefined
      },
      status: "created",
      createdAt: timestamp,
      updatedAt: timestamp
    };

    await this.repository.saveIntent(intent);
    await this.repository.saveIdempotency(this.createIdempotencyRecord(scope, idempotencyKey, "intent", intent.id, timestamp));
    await this.writeAudit("intent", intent.id, "intent.created", "user", "Donation intent created.", {
      amount: intent.money.amount,
      currency: intent.money.currency,
      region: intent.region
    }, timestamp);

    return {
      intent,
      replayed: false
    };
  }

  async startCheckout(intentId: string, idempotencyKey?: string) {
    const intent = await this.requireIntent(intentId);
    this.assertIntentAllowsCheckout(intent.status);

    const resolvedKey = idempotencyKey?.trim() || createIdempotencyKey();
    const scope = `checkout:start:mock:${intentId}`;
    const replayed = await this.replayByIdempotency(scope, resolvedKey, "attempt");

    if (replayed) {
      const replayedIntent = await this.requireIntent(replayed.intentId);
      const replayedEvent = replayed.lastEventId
        ? (await this.repository.listEventsByAttempt(replayed.id)).find((event) => event.id === replayed.lastEventId)
        : undefined;

      return {
        intent: replayedIntent,
        attempt: replayed,
        event: replayedEvent,
        replayed: true
      };
    }

    const timestamp = now();
    const session = createMockCheckoutSession(this.baseUrl, createEntityId("attempt"));
    const attempt: PaymentAttempt = {
      id: session.checkoutUrl.split("/").pop() || createEntityId("attempt"),
      intentId: intent.id,
      provider: session.provider,
      providerPaymentId: session.providerPaymentId,
      status: "checkout_opened",
      checkoutUrl: session.checkoutUrl,
      createdAt: timestamp,
      updatedAt: timestamp
    };

    const event = this.createProviderEvent(attempt, intent.id, "checkout.opened", "simulation", true, timestamp, {
      ...makeMockEventPayload("checkout.opened", attempt.id),
      checkoutUrl: attempt.checkoutUrl
    });

    const updatedIntent: DonationIntent = {
      ...intent,
      status: "checkout_ready",
      activeAttemptId: attempt.id,
      updatedAt: timestamp
    };

    const updatedAttempt: PaymentAttempt = {
      ...attempt,
      lastEventId: event.id
    };

    await this.repository.saveAttempt(updatedAttempt);
    await this.repository.saveProviderEvent(event);
    await this.repository.saveIntent(updatedIntent);
    await this.repository.saveIdempotency(this.createIdempotencyRecord(scope, resolvedKey, "attempt", updatedAttempt.id, timestamp));
    await this.writeAudit("attempt", updatedAttempt.id, "attempt.created", "system", "Mock payment attempt created.", {
      intentId,
      providerPaymentId: updatedAttempt.providerPaymentId
    }, timestamp);
    await this.writeAudit("provider_event", event.id, event.type, "provider", "Checkout session opened by mock provider.", {
      attemptId: updatedAttempt.id,
      intentId
    }, timestamp);

    return {
      intent: updatedIntent,
      attempt: updatedAttempt,
      event,
      replayed: false
    };
  }

  async startExternalCheckout(input: {
    intentId: string;
    provider: PaymentProvider;
    attemptId?: string;
    providerPaymentId: string;
    checkoutUrl: string;
    payload: Record<string, unknown>;
    idempotencyKey?: string;
    source?: "api" | "webhook";
    signatureVerified?: boolean;
  }) {
    const intent = await this.requireIntent(input.intentId);
    this.assertIntentAllowsCheckout(intent.status);

    const resolvedKey = input.idempotencyKey?.trim() || createIdempotencyKey();
    const scope = `checkout:start:${input.provider}:${input.intentId}`;
    const replayed = await this.replayByIdempotency(scope, resolvedKey, "attempt");

    if (replayed) {
      const replayedIntent = await this.requireIntent(replayed.intentId);
      const replayedEvent = replayed.lastEventId
        ? (await this.repository.listEventsByAttempt(replayed.id)).find((event) => event.id === replayed.lastEventId)
        : undefined;

      return {
        intent: replayedIntent,
        attempt: replayed,
        event: replayedEvent,
        replayed: true
      };
    }

    const timestamp = now();
    const attempt: PaymentAttempt = {
      id: input.attemptId ?? createEntityId("attempt"),
      intentId: intent.id,
      provider: input.provider,
      providerPaymentId: input.providerPaymentId,
      status: "checkout_opened",
      checkoutUrl: input.checkoutUrl,
      createdAt: timestamp,
      updatedAt: timestamp
    };

    const event = this.createProviderEvent(
      attempt,
      intent.id,
      "checkout.opened",
      input.source ?? "api",
      input.signatureVerified ?? true,
      timestamp,
      input.payload
    );

    const updatedIntent: DonationIntent = {
      ...intent,
      status: "checkout_ready",
      activeAttemptId: attempt.id,
      updatedAt: timestamp
    };

    const updatedAttempt: PaymentAttempt = {
      ...attempt,
      lastEventId: event.id
    };

    await this.repository.saveAttempt(updatedAttempt);
    await this.repository.saveProviderEvent(event);
    await this.repository.saveIntent(updatedIntent);
    await this.repository.saveIdempotency(this.createIdempotencyRecord(scope, resolvedKey, "attempt", updatedAttempt.id, timestamp));
    await this.writeAudit("attempt", updatedAttempt.id, "attempt.created", "system", `${input.provider} payment attempt created.`, {
      intentId: input.intentId,
      provider: input.provider,
      providerPaymentId: updatedAttempt.providerPaymentId
    }, timestamp);
    await this.writeAudit("provider_event", event.id, event.type, "provider", `Checkout session opened by ${input.provider}.`, {
      attemptId: updatedAttempt.id,
      intentId: input.intentId,
      provider: input.provider
    }, timestamp);

    return {
      intent: updatedIntent,
      attempt: updatedAttempt,
      event,
      replayed: false
    };
  }

  async applyAction(
    attemptId: string,
    action: MockAction,
    source: "simulation" | "webhook" | "api" = "simulation",
    options?: {
      payload?: Record<string, unknown>;
      signatureVerified?: boolean;
      providerEventId?: string;
    }
  ) {
    const attempt = await this.requireAttempt(attemptId);
    const intent = await this.requireIntent(attempt.intentId);
    const targetTransition = getTargetTransition(action);
    const timestamp = now();
    const eventPayload = options?.payload ?? makeMockEventPayload(targetTransition.eventType, attemptId);
    const existingProviderEventId = options?.providerEventId ?? this.extractProviderEventId(eventPayload);

    if (existingProviderEventId) {
      const duplicateEvent = await this.findProviderEventByExternalId(attemptId, existingProviderEventId);

      if (duplicateEvent) {
        return {
          intent,
          attempt,
          event: duplicateEvent,
          settlement: await this.repository.findSettlementByAttempt(attempt.id),
          ledgerEntries: await this.repository.listLedgerEntriesByAttempt(attempt.id),
          replayed: true
        };
      }
    }

    if (attempt.status === targetTransition.attemptStatus) {
      const repeatedEvent = this.createProviderEvent(
        attempt,
        intent.id,
        targetTransition.eventType,
        source,
        options?.signatureVerified ?? source !== "simulation",
        timestamp,
        eventPayload
      );
      const updatedAttempt: PaymentAttempt = {
        ...attempt,
        lastEventId: repeatedEvent.id,
        updatedAt: timestamp
      };

      await this.repository.saveAttempt(updatedAttempt);
      await this.repository.saveProviderEvent(repeatedEvent);
      await this.writeAudit(
        "attempt",
        updatedAttempt.id,
        `attempt.${action}.replayed`,
        this.actorFromSource(source),
        `Repeated ${action} event accepted without state mutation.`,
        {
          currentStatus: attempt.status,
          provider: attempt.provider,
          externalEventId: existingProviderEventId
        },
        timestamp
      );

      return {
        intent,
        attempt: updatedAttempt,
        event: repeatedEvent,
        settlement: await this.repository.findSettlementByAttempt(updatedAttempt.id),
        ledgerEntries: await this.repository.listLedgerEntriesByAttempt(updatedAttempt.id),
        replayed: true
      };
    }

    const transition = makeTransition(action, attempt.status);

    const updatedAttempt: PaymentAttempt = {
      ...attempt,
      status: transition.attemptStatus,
      updatedAt: timestamp
    };

    const updatedIntent: DonationIntent = {
      ...intent,
      status: transition.intentStatus,
      activeAttemptId: attempt.id,
      updatedAt: timestamp
    };

    const event = this.createProviderEvent(
      updatedAttempt,
      updatedIntent.id,
      transition.eventType,
      source,
      options?.signatureVerified ?? source !== "simulation",
      timestamp,
      eventPayload
    );

    updatedAttempt.lastEventId = event.id;

    await this.repository.saveAttempt(updatedAttempt);
    await this.repository.saveIntent(updatedIntent);
    await this.repository.saveProviderEvent(event);

    const financials = await this.applyFinancialSideEffects(updatedIntent, updatedAttempt, action, timestamp);

    await this.writeAudit(
      "attempt",
      updatedAttempt.id,
      `attempt.${action}`,
      this.actorFromSource(source),
      `${attempt.provider} action ${action} applied to payment attempt.`,
      {
        fromStatus: attempt.status,
        toStatus: updatedAttempt.status,
        eventType: transition.eventType,
        provider: attempt.provider
      },
      timestamp
    );
    await this.writeAudit(
      "intent",
      updatedIntent.id,
      `intent.${updatedIntent.status}`,
      source === "webhook" ? "provider" : "system",
      `Donation intent moved to ${updatedIntent.status}.`,
      {
        attemptId,
        previousStatus: intent.status,
        nextStatus: updatedIntent.status
      },
      timestamp
    );
    await this.writeAudit(
      "provider_event",
      event.id,
      event.type,
      "provider",
      `Provider event ${event.type} ingested.`,
      {
        attemptId,
        intentId: updatedIntent.id,
        source: event.source,
        provider: event.provider
      },
      timestamp
    );

    return {
      intent: updatedIntent,
      attempt: updatedAttempt,
      event,
      ...financials
    };
  }

  async markSettlementPaidOut(settlementId: string) {
    const settlement = await this.requireSettlement(settlementId);

    if (settlement.status !== "pending_payout") {
      throw new AppError(
        "SETTLEMENT_NOT_PAYABLE",
        `Settlement ${settlement.id} is ${settlement.status}, not pending payout.`,
        409
      );
    }

    const timestamp = now();
    const updatedSettlement: SettlementRecord = {
      ...settlement,
      status: "paid_out",
      payoutReference: createEntityId("payout"),
      paidOutAt: timestamp,
      updatedAt: timestamp
    };

    const payoutEntry = await this.writeLedgerEntry({
      attemptId: settlement.attemptId,
      intentId: settlement.intentId,
      settlementId: settlement.id,
      type: "payout.completed",
      amount: settlement.netAmount,
      currency: settlement.currency,
      direction: "debit",
      createdAt: timestamp,
      metadata: {
        payoutReference: updatedSettlement.payoutReference
      }
    });

    await this.repository.saveSettlement(updatedSettlement);
    await this.writeAudit(
      "attempt",
      settlement.attemptId,
      "settlement.paid_out",
      "system",
      "Settlement marked as paid out to bank account.",
      {
        settlementId: settlement.id,
        payoutReference: updatedSettlement.payoutReference,
        netAmount: settlement.netAmount
      },
      timestamp
    );

    return {
      settlement: updatedSettlement,
      ledgerEntry: payoutEntry
    };
  }

  async ingestWebhook(payload: { attemptId: string; type: ProviderEventType }) {
    const action = this.actionFromEventType(payload.type);
    return this.applyAction(payload.attemptId, action, "webhook");
  }

  async ingestProviderEvent(input: {
    attemptId: string;
    type: ProviderEventType;
    source: "webhook" | "api";
    payload: Record<string, unknown>;
    signatureVerified?: boolean;
    providerEventId?: string;
  }) {
    const action = this.actionFromEventType(input.type);
    return this.applyAction(input.attemptId, action, input.source, {
      payload: input.payload,
      signatureVerified: input.signatureVerified,
      providerEventId: input.providerEventId
    });
  }

  async findAttemptByProviderPaymentId(provider: PaymentProvider, providerPaymentId: string): Promise<PaymentAttempt> {
    const attempt = await this.repository.findAttemptByProviderPaymentId(provider, providerPaymentId);

    if (!attempt) {
      throw new AppError(
        "ATTEMPT_NOT_FOUND",
        `Payment attempt for ${provider}:${providerPaymentId} was not found.`,
        404
      );
    }

    return attempt;
  }

  private actionFromEventType(type: ProviderEventType): MockAction {
    switch (type) {
      case "payment.authorized":
        return "authorize";
      case "payment.captured":
        return "capture";
      case "payment.failed":
        return "fail";
      case "payment.refunded":
        return "refund";
      case "payment.disputed":
        return "dispute";
      case "checkout.opened":
        throw new AppError(
          "INVALID_WEBHOOK_EVENT",
          "checkout.opened is produced internally when checkout is created.",
          400
        );
      default:
        throw new AppError("INVALID_WEBHOOK_EVENT", `Unsupported provider event: ${type}`, 400);
    }
  }

  private async applyFinancialSideEffects(intent: DonationIntent, attempt: PaymentAttempt, action: MockAction, timestamp: string) {
    switch (action) {
      case "capture": {
        const settlement = await this.createSettlementForCapture(intent, attempt, timestamp);
        const chargeEntry = await this.writeLedgerEntry({
          attemptId: attempt.id,
          intentId: intent.id,
          settlementId: settlement.id,
          type: "charge.captured",
          amount: settlement.grossAmount,
          currency: settlement.currency,
          direction: "credit",
          createdAt: timestamp,
          metadata: {
            providerPaymentId: attempt.providerPaymentId
          }
        });
        const feeEntry = await this.writeLedgerEntry({
          attemptId: attempt.id,
          intentId: intent.id,
          settlementId: settlement.id,
          type: "fee.assessed",
          amount: settlement.feeAmount,
          currency: settlement.currency,
          direction: "debit",
          createdAt: timestamp,
          metadata: {
            feeRate: "5%"
          }
        });

        await this.writeAudit(
          "attempt",
          attempt.id,
          "settlement.pending_payout",
          "system",
          "Settlement created and waiting for payout.",
          {
            settlementId: settlement.id,
            grossAmount: settlement.grossAmount,
            feeAmount: settlement.feeAmount,
            netAmount: settlement.netAmount
          },
          timestamp
        );

        return {
          settlement,
          ledgerEntries: [chargeEntry, feeEntry]
        };
      }
      case "refund": {
        const settlement = await this.requireOpenSettlementForAttempt(attempt.id, ["pending_payout", "blocked"]);
        const updatedSettlement = await this.updateSettlementStatus(settlement, "canceled", timestamp);
        const refundEntry = await this.writeLedgerEntry({
          attemptId: attempt.id,
          intentId: intent.id,
          settlementId: settlement.id,
          type: "refund.issued",
          amount: settlement.grossAmount,
          currency: settlement.currency,
          direction: "debit",
          createdAt: timestamp,
          metadata: {
            reason: "mock refund"
          }
        });
        const feeReverseEntry = await this.writeLedgerEntry({
          attemptId: attempt.id,
          intentId: intent.id,
          settlementId: settlement.id,
          type: "fee.reversed",
          amount: settlement.feeAmount,
          currency: settlement.currency,
          direction: "credit",
          createdAt: timestamp,
          metadata: {
            reason: "mock fee reversal"
          }
        });

        await this.writeAudit(
          "attempt",
          attempt.id,
          "settlement.canceled",
          "system",
          "Settlement canceled due to refund before payout.",
          {
            settlementId: settlement.id
          },
          timestamp
        );

        return {
          settlement: updatedSettlement,
          ledgerEntries: [refundEntry, feeReverseEntry]
        };
      }
      case "dispute": {
        const settlement = await this.requireOpenSettlementForAttempt(attempt.id, ["pending_payout"]);
        const updatedSettlement = await this.updateSettlementStatus(settlement, "blocked", timestamp);
        const holdEntry = await this.writeLedgerEntry({
          attemptId: attempt.id,
          intentId: intent.id,
          settlementId: settlement.id,
          type: "dispute.reserve",
          amount: settlement.netAmount,
          currency: settlement.currency,
          direction: "debit",
          createdAt: timestamp,
          metadata: {
            reason: "mock dispute reserve"
          }
        });

        await this.writeAudit(
          "attempt",
          attempt.id,
          "settlement.blocked",
          "system",
          "Settlement blocked due to dispute.",
          {
            settlementId: settlement.id
          },
          timestamp
        );

        return {
          settlement: updatedSettlement,
          ledgerEntries: [holdEntry]
        };
      }
      default:
        return {
          settlement: await this.repository.findSettlementByAttempt(attempt.id),
          ledgerEntries: [] as LedgerEntry[]
        };
    }
  }

  private async createSettlementForCapture(intent: DonationIntent, attempt: PaymentAttempt, timestamp: string): Promise<SettlementRecord> {
    const existing = await this.repository.findSettlementByAttempt(attempt.id);

    if (existing) {
      throw new AppError(
        "SETTLEMENT_ALREADY_EXISTS",
        `Settlement already exists for attempt ${attempt.id}.`,
        409
      );
    }

    const feeAmount = calculateMockFee(intent.money.amount);
    const settlement: SettlementRecord = {
      id: createEntityId("settlement"),
      attemptId: attempt.id,
      intentId: intent.id,
      currency: intent.money.currency,
      grossAmount: intent.money.amount,
      feeAmount,
      netAmount: intent.money.amount - feeAmount,
      status: "pending_payout",
      createdAt: timestamp,
      updatedAt: timestamp
    };

    await this.repository.saveSettlement(settlement);
    return settlement;
  }

  private async updateSettlementStatus(
    settlement: SettlementRecord,
    status: SettlementStatus,
    timestamp: string
  ): Promise<SettlementRecord> {
    const updated: SettlementRecord = {
      ...settlement,
      status,
      updatedAt: timestamp
    };

    await this.repository.saveSettlement(updated);
    return updated;
  }

  private async writeLedgerEntry(entry: Omit<LedgerEntry, "id">): Promise<LedgerEntry> {
    const completeEntry: LedgerEntry = {
      id: createEntityId("ledger"),
      ...entry
    };

    await this.repository.saveLedgerEntry(completeEntry);
    return completeEntry;
  }

  private computeOutstandingBalance(entries: LedgerEntry[]): number {
    return entries.reduce((sum, entry) => {
      const signed = entry.direction === "credit" ? entry.amount : -entry.amount;
      return sum + signed;
    }, 0);
  }

  private createProviderEvent(
    attempt: PaymentAttempt,
    intentId: string,
    type: ProviderEventType,
    source: "simulation" | "webhook" | "api",
    signatureVerified: boolean,
    receivedAt: string,
    payload: Record<string, unknown>
  ): ProviderEvent {
    return {
      id: createEntityId("event"),
      attemptId: attempt.id,
      intentId,
      provider: attempt.provider,
      type,
      source,
      signatureVerified,
      payload,
      receivedAt
    };
  }

  private actorFromSource(source: "simulation" | "webhook" | "api"): AuditActor {
    if (source === "webhook") {
      return "provider";
    }

    if (source === "api") {
      return "system";
    }

    return "user";
  }

  private extractProviderEventId(payload: Record<string, unknown>): string | undefined {
    const externalId = payload.id ?? payload.eventId;
    return typeof externalId === "string" ? externalId : undefined;
  }

  private async findProviderEventByExternalId(attemptId: string, externalId: string): Promise<ProviderEvent | undefined> {
    const events = await this.repository.listEventsByAttempt(attemptId);
    return events.find((event) => {
      const eventId = this.extractProviderEventId(event.payload);
      return eventId === externalId;
    });
  }

  private createIdempotencyRecord(
    scope: string,
    key: string,
    resourceType: IdempotencyRecord["resourceType"],
    resourceId: string,
    createdAt: string
  ): IdempotencyRecord {
    return {
      id: createEntityId("idemrec"),
      scope,
      key,
      resourceType,
      resourceId,
      createdAt
    };
  }

  private async replayByIdempotency<T extends "intent" | "attempt">(
    scope: string,
    key: string,
    resourceType: T
  ): Promise<T extends "intent" ? DonationIntent | undefined : PaymentAttempt | undefined> {
    const record = await this.repository.findIdempotency(scope, key);

    if (!record) {
      return undefined as T extends "intent" ? DonationIntent | undefined : PaymentAttempt | undefined;
    }

    if (record.resourceType !== resourceType) {
      throw new AppError(
        "IDEMPOTENCY_SCOPE_COLLISION",
        `Idempotency record for ${scope} resolved to ${record.resourceType}, expected ${resourceType}.`,
        409
      );
    }

    if (resourceType === "intent") {
      return await this.requireIntent(record.resourceId) as T extends "intent"
        ? DonationIntent | undefined
        : PaymentAttempt | undefined;
    }

    return await this.requireAttempt(record.resourceId) as T extends "intent"
      ? DonationIntent | undefined
      : PaymentAttempt | undefined;
  }

  private async writeAudit(
    entityType: "intent" | "attempt" | "provider_event" | "idempotency",
    entityId: string,
    action: string,
    actor: AuditActor,
    message: string,
    metadata: Record<string, unknown>,
    createdAt: string
  ): Promise<void> {
    await this.repository.saveAuditLog({
      id: createEntityId("audit"),
      entityType,
      entityId,
      action,
      actor,
      message,
      metadata,
      createdAt
    });
  }

  private async requireIntent(intentId: string): Promise<DonationIntent> {
    const intent = await this.repository.getIntent(intentId);

    if (!intent) {
      throw new AppError("INTENT_NOT_FOUND", `Donation intent ${intentId} was not found.`, 404);
    }

    return intent;
  }

  private async requireAttempt(attemptId: string): Promise<PaymentAttempt> {
    const attempt = await this.repository.getAttempt(attemptId);

    if (!attempt) {
      throw new AppError("ATTEMPT_NOT_FOUND", `Payment attempt ${attemptId} was not found.`, 404);
    }

    return attempt;
  }

  private async requireSettlement(settlementId: string): Promise<SettlementRecord> {
    const settlement = await this.repository.getSettlement(settlementId);

    if (!settlement) {
      throw new AppError("SETTLEMENT_NOT_FOUND", `Settlement ${settlementId} was not found.`, 404);
    }

    return settlement;
  }

  private async requireOpenSettlementForAttempt(
    attemptId: string,
    allowedStatuses: SettlementStatus[]
  ): Promise<SettlementRecord> {
    const settlement = await this.repository.findSettlementByAttempt(attemptId);

    if (!settlement) {
      throw new AppError(
        "SETTLEMENT_NOT_FOUND",
        `Settlement for attempt ${attemptId} was not found.`,
        404
      );
    }

    if (!allowedStatuses.includes(settlement.status)) {
      throw new AppError(
        "SETTLEMENT_STATE_CONFLICT",
        `Settlement ${settlement.id} is ${settlement.status}, expected ${allowedStatuses.join(", ")}.`,
        409
      );
    }

    return settlement;
  }

  private assertIntentAllowsCheckout(status: DonationIntentStatus) {
    if (status === "succeeded" || status === "refunded" || status === "disputed") {
      throw new AppError(
        "INTENT_TERMINAL",
        `Cannot create a new checkout from a ${status} intent.`,
        409
      );
    }
  }
}
