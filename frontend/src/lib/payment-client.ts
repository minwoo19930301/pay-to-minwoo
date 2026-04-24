import type { PaymentRequest } from "@portone/browser-sdk/v2";

export type DomesticPayMethod = "CARD" | "TRANSFER";

export type DonationPayload = {
  amount: number;
  currency: string;
  note?: string;
  locale: "ko" | "en";
  region: "domestic" | "international";
};

export type PayPalCheckoutSession = {
  orderId: string;
  attemptId: string;
  redirectUrl: string;
  provider: "paypal";
};

export type PortOneCheckoutSession = {
  orderId: string;
  attemptId: string;
  paymentId: string;
  paymentRequest: PaymentRequest;
  provider: "portone";
};

export type PortOneCompletionPayload = {
  paymentId?: string;
  errorCode?: string;
  errorMessage?: string;
  pgCode?: string;
  pgMessage?: string;
};

export type PortOneCompletionResult = {
  ok: true;
  provider: "portone";
  paymentStatus: string;
  attemptStatus: string;
  orderStatus: string;
  captureId: string | null;
  amount: string;
  currency: string;
  receiptUrl: string | null;
};

async function readErrorMessage(response: Response, fallbackMessage: string) {
  try {
    const json = (await response.json()) as { message?: string; detail?: string };
    if (json.detail) {
      return `${json.message ?? fallbackMessage} (${json.detail})`;
    }

    return json.message ?? fallbackMessage;
  } catch {
    return fallbackMessage;
  }
}

async function createOrder(apiBaseUrl: string, payload: DonationPayload, idempotencyKey: string) {
  const orderResponse = await fetch(`${apiBaseUrl}/api/v1/orders`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": idempotencyKey
    },
    body: JSON.stringify(payload)
  });

  if (!orderResponse.ok) {
    throw new Error(await readErrorMessage(orderResponse, "Failed to create order."));
  }

  const orderJson = (await orderResponse.json()) as { order: { id: string } };
  return orderJson.order.id;
}

export async function createPayPalCheckout(apiBaseUrl: string, payload: DonationPayload): Promise<PayPalCheckoutSession> {
  const idempotencyKey = crypto.randomUUID();
  const orderId = await createOrder(apiBaseUrl, payload, idempotencyKey);
  const checkoutResponse = await fetch(`${apiBaseUrl}/api/v1/orders/${orderId}/payment-attempts/paypal`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": idempotencyKey
    }
  });

  if (!checkoutResponse.ok) {
    throw new Error(await readErrorMessage(checkoutResponse, "Failed to create PayPal checkout."));
  }

  const checkoutJson = (await checkoutResponse.json()) as { attempt: { id: string }; redirectUrl: string };
  return {
    orderId,
    attemptId: checkoutJson.attempt.id,
    redirectUrl: checkoutJson.redirectUrl,
    provider: "paypal"
  };
}

export async function createPortOneCheckout(apiBaseUrl: string, payload: DonationPayload, payMethod: DomesticPayMethod): Promise<PortOneCheckoutSession> {
  const idempotencyKey = crypto.randomUUID();
  const orderId = await createOrder(apiBaseUrl, payload, idempotencyKey);
  const checkoutResponse = await fetch(`${apiBaseUrl}/api/v1/orders/${orderId}/payment-attempts/portone`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": idempotencyKey
    },
    body: JSON.stringify({ payMethod })
  });

  if (!checkoutResponse.ok) {
    throw new Error(await readErrorMessage(checkoutResponse, "Failed to create PortOne checkout."));
  }

  const checkoutJson = (await checkoutResponse.json()) as {
    attempt: { id: string; providerOrderId: string };
    paymentRequest: PaymentRequest;
  };

  return {
    orderId,
    attemptId: checkoutJson.attempt.id,
    paymentId: checkoutJson.attempt.providerOrderId,
    paymentRequest: checkoutJson.paymentRequest,
    provider: "portone"
  };
}

export async function completePortOneAttempt(
  apiBaseUrl: string,
  orderId: string,
  attemptId: string,
  payload: PortOneCompletionPayload
): Promise<PortOneCompletionResult> {
  const response = await fetch(`${apiBaseUrl}/api/v1/orders/${orderId}/payment-attempts/${attemptId}/portone/complete`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    throw new Error(await readErrorMessage(response, "Failed to verify PortOne payment."));
  }

  return (await response.json()) as PortOneCompletionResult;
}
