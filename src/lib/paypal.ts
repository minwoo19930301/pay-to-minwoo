import { AppError } from "./errors.js";

export type PayPalEnvironment = "sandbox" | "live";

export type PayPalCredentials = {
  environment: PayPalEnvironment;
  clientId: string;
  clientSecret: string;
  webhookId?: string;
};

export type PayPalCreateOrderInput = {
  amount: number;
  currency: string;
  itemName: string;
  intentId: string;
  attemptId: string;
  returnUrl?: string;
  cancelUrl?: string;
  requestId?: string;
};

type PayPalLink = {
  href: string;
  rel: string;
  method?: string;
};

export type PayPalCreateOrderResult = {
  id: string;
  status: string;
  links: PayPalLink[];
};

export type PayPalCaptureOrderResult = {
  id: string;
  status: string;
  purchase_units?: Array<Record<string, unknown>>;
  payer?: Record<string, unknown>;
};

export type PayPalWebhookHeaders = {
  authAlgo: string;
  certUrl: string;
  transmissionId: string;
  transmissionSig: string;
  transmissionTime: string;
};

export function buildPayPalWebhookHeaders(headers: Headers): PayPalWebhookHeaders {
  return {
    authAlgo: headers.get("paypal-auth-algo")?.trim() || "",
    certUrl: headers.get("paypal-cert-url")?.trim() || "",
    transmissionId: headers.get("paypal-transmission-id")?.trim() || "",
    transmissionSig: headers.get("paypal-transmission-sig")?.trim() || "",
    transmissionTime: headers.get("paypal-transmission-time")?.trim() || ""
  };
}

export function getPayPalApprovalUrl(order: PayPalCreateOrderResult): string {
  const approve = order.links.find((link) => link.rel === "approve" || link.rel === "payer-action");

  if (!approve?.href) {
    throw new AppError("PAYPAL_APPROVAL_URL_MISSING", "PayPal order did not include an approval URL.", 502);
  }

  return approve.href;
}

export function mapPayPalWebhookEventToDomainType(eventType: string): "payment.authorized" | "payment.captured" | "payment.failed" | "payment.refunded" | "payment.disputed" | undefined {
  switch (eventType) {
    case "CHECKOUT.ORDER.APPROVED":
      return "payment.authorized";
    case "PAYMENT.CAPTURE.COMPLETED":
      return "payment.captured";
    case "PAYMENT.CAPTURE.DENIED":
    case "CHECKOUT.PAYMENT-APPROVAL.REVERSED":
      return "payment.failed";
    case "PAYMENT.CAPTURE.REFUNDED":
    case "PAYMENT.CAPTURE.REVERSED":
      return "payment.refunded";
    case "CUSTOMER.DISPUTE.CREATED":
      return "payment.disputed";
    default:
      return undefined;
  }
}

export function extractPayPalOrderId(payload: Record<string, unknown>): string | undefined {
  const resource = asRecord(payload.resource);

  if (!resource) {
    return undefined;
  }

  if (typeof resource.id === "string" && String(payload.event_type) === "CHECKOUT.ORDER.APPROVED") {
    return resource.id;
  }

  const supplementaryData = asRecord(resource.supplementary_data);
  const relatedIds = asRecord(supplementaryData?.related_ids);
  return typeof relatedIds?.order_id === "string" ? relatedIds.order_id : undefined;
}

export function extractPayPalAttemptId(payload: Record<string, unknown>): string | undefined {
  const resource = asRecord(payload.resource);

  if (!resource) {
    return undefined;
  }

  const directCustomId = typeof resource.custom_id === "string" ? resource.custom_id : undefined;
  if (directCustomId) {
    return directCustomId;
  }

  const purchaseUnits = Array.isArray(resource.purchase_units) ? resource.purchase_units : [];
  const firstPurchaseUnit = asRecord(purchaseUnits[0]);
  return typeof firstPurchaseUnit?.custom_id === "string" ? firstPurchaseUnit.custom_id : undefined;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" ? value as Record<string, unknown> : undefined;
}

function getBaseUrl(environment: PayPalEnvironment): string {
  return environment === "live"
    ? "https://api-m.paypal.com"
    : "https://api-m.sandbox.paypal.com";
}

function isZeroDecimalCurrency(currency: string): boolean {
  return new Set(["HUF", "JPY", "TWD", "KRW"]).has(currency.toUpperCase());
}

function toPayPalAmountValue(amount: number, currency: string): string {
  if (isZeroDecimalCurrency(currency)) {
    return String(amount);
  }

  return `${amount}.00`;
}

async function getAccessToken(credentials: PayPalCredentials): Promise<string> {
  const response = await fetch(`${getBaseUrl(credentials.environment)}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${btoa(`${credentials.clientId}:${credentials.clientSecret}`)}`,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: "grant_type=client_credentials"
  });

  const payload = await response.json().catch(() => ({})) as Record<string, unknown>;

  if (!response.ok || typeof payload.access_token !== "string") {
    throw new AppError("PAYPAL_OAUTH_FAILED", "Failed to obtain PayPal access token.", 502, {
      status: response.status,
      payload
    });
  }

  return payload.access_token;
}

export async function createPayPalOrder(
  credentials: PayPalCredentials,
  input: PayPalCreateOrderInput
): Promise<PayPalCreateOrderResult> {
  const accessToken = await getAccessToken(credentials);
  const response = await fetch(`${getBaseUrl(credentials.environment)}/v2/checkout/orders`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
      ...(input.requestId ? { "PayPal-Request-Id": input.requestId } : {})
    },
    body: JSON.stringify({
      intent: "CAPTURE",
      purchase_units: [
        {
          reference_id: input.intentId,
          custom_id: input.attemptId,
          description: input.itemName,
          amount: {
            currency_code: input.currency,
            value: toPayPalAmountValue(input.amount, input.currency)
          }
        }
      ],
      ...(input.returnUrl || input.cancelUrl ? {
        payment_source: {
          paypal: {
            experience_context: {
              ...(input.returnUrl ? { return_url: input.returnUrl } : {}),
              ...(input.cancelUrl ? { cancel_url: input.cancelUrl } : {}),
              user_action: "PAY_NOW"
            }
          }
        }
      } : {})
    })
  });

  const payload = await response.json().catch(() => ({})) as Record<string, unknown>;

  if (!response.ok || typeof payload.id !== "string") {
    throw new AppError("PAYPAL_ORDER_CREATE_FAILED", "Failed to create PayPal order.", 502, {
      status: response.status,
      payload
    });
  }

  return payload as PayPalCreateOrderResult;
}

export async function capturePayPalOrder(
  credentials: PayPalCredentials,
  orderId: string,
  requestId?: string
): Promise<PayPalCaptureOrderResult> {
  const accessToken = await getAccessToken(credentials);
  const response = await fetch(`${getBaseUrl(credentials.environment)}/v2/checkout/orders/${orderId}/capture`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
      ...(requestId ? { "PayPal-Request-Id": requestId } : {})
    }
  });

  const payload = await response.json().catch(() => ({})) as Record<string, unknown>;

  if (!response.ok || typeof payload.id !== "string") {
    throw new AppError("PAYPAL_ORDER_CAPTURE_FAILED", "Failed to capture PayPal order.", 502, {
      status: response.status,
      payload
    });
  }

  return payload as PayPalCaptureOrderResult;
}

export async function verifyPayPalWebhook(
  credentials: PayPalCredentials,
  headers: PayPalWebhookHeaders,
  webhookEvent: Record<string, unknown>
): Promise<boolean> {
  if (!credentials.webhookId) {
    throw new AppError("PAYPAL_WEBHOOK_ID_MISSING", "PAYPAL_WEBHOOK_ID is required for webhook verification.", 500);
  }

  const accessToken = await getAccessToken(credentials);
  const response = await fetch(`${getBaseUrl(credentials.environment)}/v1/notifications/verify-webhook-signature`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      auth_algo: headers.authAlgo,
      cert_url: headers.certUrl,
      transmission_id: headers.transmissionId,
      transmission_sig: headers.transmissionSig,
      transmission_time: headers.transmissionTime,
      webhook_id: credentials.webhookId,
      webhook_event: webhookEvent
    })
  });

  const payload = await response.json().catch(() => ({})) as Record<string, unknown>;

  if (!response.ok) {
    throw new AppError("PAYPAL_WEBHOOK_VERIFY_FAILED", "Failed to verify PayPal webhook signature.", 502, {
      status: response.status,
      payload
    });
  }

  return payload.verification_status === "SUCCESS";
}
