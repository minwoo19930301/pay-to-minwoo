import { describe, expect, it } from "vitest";
import { PaymentLabService } from "./payment-lab-service.js";
import { InMemoryPaymentLabRepository } from "./repositories/payment-lab-repository-memory.js";

describe("PaymentLabService", () => {
  function createService() {
    return new PaymentLabService(new InMemoryPaymentLabRepository(), "http://127.0.0.1:8787");
  }

  it("replays intent creation for the same idempotency key", async () => {
    const service = createService();
    const first = await service.createIntent({
      amount: 10000,
      currency: "krw",
      customerEmail: "fan@example.com",
      customerName: "Fan",
      itemName: "Support Minwoo",
      region: "domestic",
      idempotencyKey: "intent-key-1"
    });
    const second = await service.createIntent({
      amount: 10000,
      currency: "KRW",
      customerEmail: "fan@example.com",
      customerName: "Fan",
      itemName: "Support Minwoo",
      region: "domestic",
      idempotencyKey: "intent-key-1"
    });

    expect(first.replayed).toBe(false);
    expect(second.replayed).toBe(true);
    expect(second.intent.id).toBe(first.intent.id);
  });

  it("creates a pending settlement and ledger entries on capture, then clears balance on payout", async () => {
    const service = createService();
    const { intent } = await service.createIntent({
      amount: 10000,
      currency: "KRW",
      customerEmail: "fan@example.com",
      customerName: "Fan",
      itemName: "Support Minwoo",
      region: "domestic"
    });
    const checkout = await service.startCheckout(intent.id);

    await service.applyAction(checkout.attempt.id, "authorize");
    const captured = await service.applyAction(checkout.attempt.id, "capture");

    expect(captured.intent.status).toBe("succeeded");
    expect(captured.attempt.status).toBe("captured");
    expect(captured.settlement?.status).toBe("pending_payout");
    expect(captured.ledgerEntries).toHaveLength(2);

    const detailAfterCapture = await service.getAttempt(checkout.attempt.id);
    expect(detailAfterCapture.payableBalance).toBe(captured.settlement?.netAmount);

    const payout = await service.markSettlementPaidOut(captured.settlement!.id);
    expect(payout.settlement.status).toBe("paid_out");

    const detailAfterPayout = await service.getAttempt(checkout.attempt.id);
    expect(detailAfterPayout.payableBalance).toBe(0);
  });

  it("cancels settlement and restores balance to zero on refund before payout", async () => {
    const service = createService();
    const { intent } = await service.createIntent({
      amount: 49,
      currency: "usd",
      customerEmail: "fan@example.com",
      customerName: "Fan",
      itemName: "Support Minwoo",
      region: "international"
    });
    const checkout = await service.startCheckout(intent.id);

    await service.applyAction(checkout.attempt.id, "authorize");
    await service.applyAction(checkout.attempt.id, "capture");
    const refunded = await service.applyAction(checkout.attempt.id, "refund");

    expect(refunded.intent.status).toBe("refunded");
    expect(refunded.attempt.status).toBe("refunded");
    expect(refunded.settlement?.status).toBe("canceled");

    const detail = await service.getAttempt(checkout.attempt.id);
    expect(detail.payableBalance).toBe(0);
  });

  it("rejects invalid transitions", async () => {
    const service = createService();
    const { intent } = await service.createIntent({
      amount: 10000,
      currency: "KRW",
      customerEmail: "fan@example.com",
      customerName: "Fan",
      itemName: "Support Minwoo",
      region: "domestic"
    });
    const checkout = await service.startCheckout(intent.id);

    await expect(service.applyAction(checkout.attempt.id, "refund")).rejects.toThrow(
      /Cannot refund an attempt in checkout_opened state/,
    );
  });

  it("creates an external PayPal attempt and accepts duplicate capture events idempotently", async () => {
    const service = createService();
    const { intent } = await service.createIntent({
      amount: 25,
      currency: "USD",
      customerEmail: "fan@example.com",
      customerName: "Fan",
      itemName: "Support Minwoo",
      region: "international"
    });

    const checkout = await service.startExternalCheckout({
      intentId: intent.id,
      provider: "paypal",
      attemptId: "attempt_paypal_1",
      providerPaymentId: "PAYPAL-ORDER-1",
      checkoutUrl: "https://www.sandbox.paypal.com/checkoutnow?token=PAYPAL-ORDER-1",
      payload: {
        id: "PAYPAL-ORDER-1",
        eventId: "PAYPAL-ORDER-1"
      }
    });

    expect(checkout.attempt.provider).toBe("paypal");
    expect(checkout.attempt.providerPaymentId).toBe("PAYPAL-ORDER-1");

    await service.ingestProviderEvent({
      attemptId: checkout.attempt.id,
      type: "payment.captured",
      source: "api",
      payload: {
        id: "capture-event-1"
      },
      providerEventId: "capture-event-1",
      signatureVerified: true
    });

    const duplicate = await service.ingestProviderEvent({
      attemptId: checkout.attempt.id,
      type: "payment.captured",
      source: "webhook",
      payload: {
        id: "capture-event-1"
      },
      providerEventId: "capture-event-1",
      signatureVerified: true
    });

    expect(duplicate.replayed).toBe(true);

    const detail = await service.getAttempt(checkout.attempt.id);
    expect(detail.settlements).toHaveLength(1);
    expect(detail.ledgerEntries.filter((entry) => entry.type === "charge.captured")).toHaveLength(1);
  });
});
