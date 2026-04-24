export type PayPalOrderResponse = {
  id: string;
  status: string;
  links?: Array<{ href: string; rel: string; method: string }>;
};

export type PayPalCaptureResponse = {
  id?: string;
  status?: string;
  purchase_units?: Array<{
    payments?: {
      captures?: Array<{
        id?: string;
        status?: string;
        amount?: { currency_code?: string; value?: string };
        seller_receivable_breakdown?: {
          gross_amount?: { currency_code?: string; value?: string };
          paypal_fee?: { currency_code?: string; value?: string };
          net_amount?: { currency_code?: string; value?: string };
        };
      }>;
    };
  }>;
};

export type PayPalCredentials = {
  environment: "sandbox" | "live";
  clientId: string;
  clientSecret: string;
  webhookId?: string;
};

export type PayPalWebhookHeaders = {
  transmissionId: string;
  transmissionTime: string;
  transmissionSig: string;
  certUrl: string;
  authAlgo: string;
};

type PayPalToken = {
  access_token: string;
  token_type: string;
  expires_in: number;
};

export function getPayPalCredentials(): PayPalCredentials {
  const clientId = process.env.PAYPAL_CLIENT_ID?.trim();
  const clientSecret = process.env.PAYPAL_CLIENT_SECRET?.trim();

  if (!clientId || !clientSecret) {
    throw new Error("PayPal credentials are not configured.");
  }

  const env = process.env.PAYPAL_ENV?.trim().toLowerCase() === "live" ? "live" : "sandbox";
  return {
    environment: env,
    clientId,
    clientSecret,
    webhookId: process.env.PAYPAL_WEBHOOK_ID?.trim() || undefined
  };
}

function baseUrl(credentials: PayPalCredentials) {
  return credentials.environment === "live" ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com";
}

function decimalPlaces(currency: string) {
  return ["BIF", "CLP", "DJF", "GNF", "JPY", "KMF", "KRW", "MGA", "PYG", "RWF", "UGX", "VND", "VUV", "XAF", "XOF", "XPF"].includes(currency.toUpperCase()) ? 0 : 2;
}

export function formatPayPalAmount(amount: number, currency: string) {
  return (amount / 10 ** decimalPlaces(currency)).toFixed(decimalPlaces(currency));
}

export function parseProviderAmount(value: string | undefined, currency: string) {
  if (!value) {
    return 0;
  }

  return Math.round(Number(value) * 10 ** decimalPlaces(currency));
}

async function paypalRequest<T>(credentials: PayPalCredentials, path: string, init: RequestInit = {}): Promise<T> {
  const token = await getAccessToken(credentials);
  const response = await fetch(`${baseUrl(credentials)}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "Content-Type": "application/json",
      ...(init.headers ?? {})
    }
  });

  const text = await response.text();
  const json = text ? JSON.parse(text) : null;

  if (!response.ok) {
    throw new Error(`PayPal API error ${response.status}: ${text}`);
  }

  return json as T;
}

export async function getAccessToken(credentials: PayPalCredentials) {
  const basic = Buffer.from(`${credentials.clientId}:${credentials.clientSecret}`).toString("base64");
  const response = await fetch(`${baseUrl(credentials)}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: "grant_type=client_credentials"
  });

  const text = await response.text();
  const json = text ? JSON.parse(text) as PayPalToken : null;

  if (!response.ok || !json?.access_token) {
    throw new Error(`PayPal OAuth error ${response.status}: ${text}`);
  }

  return json.access_token;
}

export async function createPayPalOrder(input: {
  credentials: PayPalCredentials;
  amount: number;
  currency: string;
  itemName: string;
  orderId: string;
  attemptId: string;
  returnUrl: string;
  cancelUrl: string;
  requestId: string;
}) {
  const order = await paypalRequest<PayPalOrderResponse>(input.credentials, "/v2/checkout/orders", {
    method: "POST",
    headers: {
      "PayPal-Request-Id": input.requestId
    },
    body: JSON.stringify({
      intent: "CAPTURE",
      purchase_units: [
        {
          reference_id: input.attemptId,
          custom_id: input.orderId,
          description: input.itemName,
          amount: {
            currency_code: input.currency,
            value: formatPayPalAmount(input.amount, input.currency)
          }
        }
      ],
      application_context: {
        brand_name: "Pay to Minwoo",
        landing_page: "NO_PREFERENCE",
        user_action: "PAY_NOW",
        return_url: input.returnUrl,
        cancel_url: input.cancelUrl
      }
    })
  });

  const approveUrl = order.links?.find((link) => link.rel === "approve")?.href;
  if (!approveUrl) {
    throw new Error("PayPal order approval URL was not returned.");
  }

  return { order, approveUrl };
}

export async function capturePayPalOrder(credentials: PayPalCredentials, providerOrderId: string, requestId: string) {
  return paypalRequest<PayPalCaptureResponse>(credentials, `/v2/checkout/orders/${providerOrderId}/capture`, {
    method: "POST",
    headers: {
      "PayPal-Request-Id": requestId
    },
    body: JSON.stringify({})
  });
}

export async function verifyPayPalWebhook(input: {
  credentials: PayPalCredentials;
  webhookId: string;
  headers: PayPalWebhookHeaders;
  event: unknown;
}) {
  const response = await paypalRequest<{ verification_status?: string }>(input.credentials, "/v1/notifications/verify-webhook-signature", {
    method: "POST",
    body: JSON.stringify({
      auth_algo: input.headers.authAlgo,
      cert_url: input.headers.certUrl,
      transmission_id: input.headers.transmissionId,
      transmission_sig: input.headers.transmissionSig,
      transmission_time: input.headers.transmissionTime,
      webhook_id: input.webhookId,
      webhook_event: input.event
    })
  });

  return response.verification_status === "SUCCESS";
}

export function getPayPalWebhookHeaders(headers: Headers): PayPalWebhookHeaders | null {
  const transmissionId = headers.get("paypal-transmission-id") ?? "";
  const transmissionTime = headers.get("paypal-transmission-time") ?? "";
  const transmissionSig = headers.get("paypal-transmission-sig") ?? "";
  const certUrl = headers.get("paypal-cert-url") ?? "";
  const authAlgo = headers.get("paypal-auth-algo") ?? "";

  if (!transmissionId || !transmissionTime || !transmissionSig || !certUrl || !authAlgo) {
    return null;
  }

  return { transmissionId, transmissionTime, transmissionSig, certUrl, authAlgo };
}

export function getPrimaryCapture(capture: PayPalCaptureResponse) {
  return capture.purchase_units?.flatMap((unit) => unit.payments?.captures ?? [])[0] ?? null;
}
