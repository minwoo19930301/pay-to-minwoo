import { AppError } from "./errors.js";

export type CheckoutRegion = "domestic" | "international";

export type DonationIntentStatus =
  | "created"
  | "checkout_ready"
  | "processing"
  | "succeeded"
  | "failed"
  | "refunded"
  | "disputed";

export type PaymentAttemptStatus =
  | "created"
  | "checkout_opened"
  | "authorized"
  | "captured"
  | "failed"
  | "refunded"
  | "disputed";

export type ProviderEventType =
  | "checkout.opened"
  | "payment.authorized"
  | "payment.captured"
  | "payment.failed"
  | "payment.refunded"
  | "payment.disputed";

export type PaymentProvider = "mock" | "paypal";

export type SettlementStatus =
  | "pending_payout"
  | "blocked"
  | "canceled"
  | "paid_out";

export type LedgerEntryType =
  | "charge.captured"
  | "fee.assessed"
  | "refund.issued"
  | "fee.reversed"
  | "dispute.reserve"
  | "payout.completed";

export type AuditActor = "user" | "provider" | "system";
export type AuditEntityType = "intent" | "attempt" | "provider_event" | "idempotency";
export type MockAction = "authorize" | "capture" | "fail" | "refund" | "dispute";

export type Money = {
  amount: number;
  currency: string;
};

export type DonorProfile = {
  name: string;
  email: string;
  note?: string;
};

export type DonationIntent = {
  id: string;
  idempotencyKey: string;
  itemName: string;
  region: CheckoutRegion;
  money: Money;
  donor: DonorProfile;
  status: DonationIntentStatus;
  activeAttemptId?: string;
  createdAt: string;
  updatedAt: string;
};

export type PaymentAttempt = {
  id: string;
  intentId: string;
  provider: PaymentProvider;
  providerPaymentId: string;
  status: PaymentAttemptStatus;
  checkoutUrl: string;
  createdAt: string;
  updatedAt: string;
  lastEventId?: string;
};

export type ProviderEvent = {
  id: string;
  attemptId: string;
  intentId: string;
  provider: PaymentProvider;
  type: ProviderEventType;
  source: "simulation" | "webhook" | "api";
  signatureVerified: boolean;
  payload: Record<string, unknown>;
  receivedAt: string;
};

export type AuditLog = {
  id: string;
  entityType: AuditEntityType;
  entityId: string;
  action: string;
  actor: AuditActor;
  message: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
};

export type IdempotencyRecord = {
  id: string;
  scope: string;
  key: string;
  resourceType: "intent" | "attempt";
  resourceId: string;
  createdAt: string;
};

export type SettlementRecord = {
  id: string;
  attemptId: string;
  intentId: string;
  currency: string;
  grossAmount: number;
  feeAmount: number;
  netAmount: number;
  status: SettlementStatus;
  payoutReference?: string;
  createdAt: string;
  updatedAt: string;
  paidOutAt?: string;
};

export type LedgerEntry = {
  id: string;
  attemptId: string;
  intentId: string;
  settlementId?: string;
  type: LedgerEntryType;
  amount: number;
  currency: string;
  direction: "credit" | "debit";
  createdAt: string;
  metadata?: Record<string, unknown>;
};

export type LabSnapshot = {
  intents: DonationIntent[];
  attempts: PaymentAttempt[];
  providerEvents: ProviderEvent[];
  auditLogs: AuditLog[];
  idempotencyRecords: IdempotencyRecord[];
  settlements: SettlementRecord[];
  ledgerEntries: LedgerEntry[];
};

export type CreateIntentInput = {
  amount: number;
  currency: string;
  customerEmail: string;
  customerName: string;
  itemName: string;
  note?: string;
  region: CheckoutRegion;
  idempotencyKey?: string;
};

export type StartCheckoutResult = {
  intent: DonationIntent;
  attempt: PaymentAttempt;
  event: ProviderEvent;
  replayed: boolean;
};

export type TransitionResult = {
  intentStatus: DonationIntentStatus;
  attemptStatus: PaymentAttemptStatus;
  eventType: ProviderEventType;
};

const allowedAttemptTransitions: Record<MockAction, PaymentAttemptStatus[]> = {
  authorize: ["created", "checkout_opened"],
  capture: ["authorized", "checkout_opened"],
  fail: ["created", "checkout_opened", "authorized"],
  refund: ["captured"],
  dispute: ["captured", "refunded"]
};

const actionTransitions: Record<MockAction, Omit<TransitionResult, "eventType">> = {
  authorize: {
    intentStatus: "processing",
    attemptStatus: "authorized"
  },
  capture: {
    intentStatus: "succeeded",
    attemptStatus: "captured"
  },
  fail: {
    intentStatus: "failed",
    attemptStatus: "failed"
  },
  refund: {
    intentStatus: "refunded",
    attemptStatus: "refunded"
  },
  dispute: {
    intentStatus: "disputed",
    attemptStatus: "disputed"
  }
};

const actionEventType: Record<MockAction, ProviderEventType> = {
  authorize: "payment.authorized",
  capture: "payment.captured",
  fail: "payment.failed",
  refund: "payment.refunded",
  dispute: "payment.disputed"
};

export function createEntityId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, "").slice(0, 24)}`;
}

export function normalizeCurrency(currency: string): string {
  return currency.trim().toUpperCase();
}

export function calculateMockFee(amount: number): number {
  return Math.max(1, Math.round(amount * 0.05));
}

export function assertPositiveAmount(amount: number): void {
  if (!Number.isInteger(amount) || amount <= 0) {
    throw new AppError("INVALID_AMOUNT", "Amount must be a positive integer.", 400);
  }
}

export function makeTransition(action: MockAction, currentStatus: PaymentAttemptStatus): TransitionResult {
  const allowed = allowedAttemptTransitions[action];

  if (!allowed.includes(currentStatus)) {
    throw new AppError(
      "INVALID_STATE_TRANSITION",
      `Cannot ${action} an attempt in ${currentStatus} state.`,
      409,
      {
        action,
        currentStatus,
        allowedStates: allowed
      }
    );
  }

  const next = actionTransitions[action];

  return {
    ...next,
    eventType: actionEventType[action]
  };
}

export function getTargetTransition(action: MockAction): TransitionResult {
  return {
    ...actionTransitions[action],
    eventType: actionEventType[action]
  };
}

export function toSortedSnapshot(snapshot: LabSnapshot): LabSnapshot {
  const byCreatedAtDesc = <T extends { createdAt?: string; receivedAt?: string }>(left: T, right: T) => {
    const leftTime = left.createdAt ?? left.receivedAt ?? "";
    const rightTime = right.createdAt ?? right.receivedAt ?? "";
    return rightTime.localeCompare(leftTime);
  };

  return {
    intents: [...snapshot.intents].sort(byCreatedAtDesc),
    attempts: [...snapshot.attempts].sort(byCreatedAtDesc),
    providerEvents: [...snapshot.providerEvents].sort(byCreatedAtDesc),
    auditLogs: [...snapshot.auditLogs].sort(byCreatedAtDesc),
    idempotencyRecords: [...snapshot.idempotencyRecords].sort(byCreatedAtDesc),
    settlements: [...snapshot.settlements].sort(byCreatedAtDesc),
    ledgerEntries: [...snapshot.ledgerEntries].sort(byCreatedAtDesc)
  };
}
