# Payment Domain Lab

This repository now has two layers:

1. `public/`
- public-facing static donation site for approval and landing-page use

2. `src/`
- mock payment system that exposes the domain objects you actually need before connecting a real provider

## Implemented domains

### Money
- `amount`
- `currency`
- integer-based money representation only

### DonationIntent
Represents the user's desire to donate to Kim Minwoo.

Fields:
- `id`
- `idempotencyKey`
- `itemName`
- `region`
- `money`
- `donor`
- `status`
- `activeAttemptId`
- `createdAt`
- `updatedAt`

### PaymentAttempt
Represents a single provider-facing payment try.

Fields:
- `id`
- `intentId`
- `provider`
- `providerPaymentId`
- `status`
- `checkoutUrl`
- `lastEventId`
- `createdAt`
- `updatedAt`

### ProviderEvent
Represents an immutable external fact from the payment provider.

Fields:
- `id`
- `attemptId`
- `intentId`
- `provider`
- `type`
- `source`
- `signatureVerified`
- `payload`
- `receivedAt`

### AuditLog
Tracks who changed what and why.

Fields:
- `entityType`
- `entityId`
- `action`
- `actor`
- `message`
- `metadata`
- `createdAt`

### IdempotencyRecord
Prevents duplicate intent creation and duplicate checkout creation.

Fields:
- `scope`
- `key`
- `resourceType`
- `resourceId`
- `createdAt`

## State model

### DonationIntent status
- `created`
- `checkout_ready`
- `processing`
- `succeeded`
- `failed`
- `refunded`
- `disputed`

### PaymentAttempt status
- `created`
- `checkout_opened`
- `authorized`
- `captured`
- `failed`
- `refunded`
- `disputed`

## Mock flow

1. Create intent
2. Start checkout
3. Mock provider opens checkout
4. Provider sends one of:
- `payment.authorized`
- `payment.captured`
- `payment.failed`
- `payment.refunded`
- `payment.disputed`
5. The service stores the provider event
6. The service updates attempt and intent state
7. The service appends audit logs

## Why this matters

If you skip these boundaries and go straight to a provider SDK, you miss the core payment-system concerns:

- idempotency
- immutable external events
- state transitions
- auditability
- retry-safe provider integration
- later provider replacement

## Next domains to add after mock

These are not fully modeled yet, but should be added before live payment production:

1. `RefundRequest`
- requester
- reason
- partial/full refund amount
- approval path

2. `DisputeCase`
- dispute reason
- evidence package
- deadline
- outcome

3. `FeeBreakdown`
- provider fee
- fx fee
- platform fee
- net amount

4. `SettlementRecord`
- payout batch id
- settled amount
- settlement date
- bank transfer reference

5. `LedgerEntry`
- double-entry bookkeeping trail for gross, fee, refund, dispute, payout

6. `ReconciliationJob`
- compares internal state with provider exports and bank statements

7. `RiskReview`
- abnormal amount
- blocked country
- velocity rule
- manual review status

## Real-provider mapping later

- `MockPaymentProvider` -> `LemonSqueezyProvider`, `PayPalProvider`, `PortOneProvider`, or `TossProvider`
- `InMemoryPaymentLabRepository` -> `TursoPaymentLabRepository`
- `/api/webhooks/mock` -> provider-specific webhook receivers
- snapshot UI -> admin dashboard backed by durable storage
