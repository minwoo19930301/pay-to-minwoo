# Payment vs Settlement vs Ledger

## One sentence each

- `payment`: the customer successfully pays
- `settlement`: the provider decides how much is actually payable to the seller and when it can be sent
- `ledger`: the running money trail that explains why the payable balance is what it is

## Why they are different

A successful customer payment does not mean the money is already in the seller's bank account.

Typical flow:

1. customer pays
2. provider captures the payment
3. provider calculates fees
4. a net payable amount becomes available
5. payout is executed later
6. the seller finally receives bank settlement

## Mock mapping in this repository

### Payment layer
- `DonationIntent`
- `PaymentAttempt`
- `ProviderEvent`

### Settlement layer
- `SettlementRecord`
  - `pending_payout`
  - `blocked`
  - `canceled`
  - `paid_out`

### Ledger layer
- `LedgerEntry`
  - `charge.captured`
  - `fee.assessed`
  - `refund.issued`
  - `fee.reversed`
  - `dispute.reserve`
  - `payout.completed`

## Example

Customer pays `10,000 KRW`.

1. capture succeeds
2. mock fee is `500 KRW`
3. payable balance becomes `9,500 KRW`
4. settlement is `pending_payout`
5. when payout happens, settlement becomes `paid_out`
6. ledger balance returns to `0`

## What the UI now shows

- intents
- attempts
- provider events
- audit logs
- idempotency records
- settlements
- ledger entries
- outstanding balance per attempt

## Current simplifications

This is still a learning-oriented v1.

- refund/dispute after payout is not modeled in full detail yet
- there is no real provider payout report ingestion yet
- storage defaults to memory, but Turso is now pluggable through the repository layer

## Next realistic step

1. run the Turso schema and persist mock flows durably
2. keep the same domain objects
3. add a real provider adapter
4. ingest real webhook events
5. ingest or reconcile payout data later
