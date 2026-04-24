"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getPayPalCredentials = getPayPalCredentials;
exports.formatPayPalAmount = formatPayPalAmount;
exports.parseProviderAmount = parseProviderAmount;
exports.getAccessToken = getAccessToken;
exports.createPayPalOrder = createPayPalOrder;
exports.capturePayPalOrder = capturePayPalOrder;
exports.verifyPayPalWebhook = verifyPayPalWebhook;
exports.getPayPalWebhookHeaders = getPayPalWebhookHeaders;
exports.getPrimaryCapture = getPrimaryCapture;
function getPayPalCredentials() {
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
function baseUrl(credentials) {
    return credentials.environment === "live" ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com";
}
function decimalPlaces(currency) {
    return ["BIF", "CLP", "DJF", "GNF", "JPY", "KMF", "KRW", "MGA", "PYG", "RWF", "UGX", "VND", "VUV", "XAF", "XOF", "XPF"].includes(currency.toUpperCase()) ? 0 : 2;
}
function formatPayPalAmount(amount, currency) {
    return (amount / 10 ** decimalPlaces(currency)).toFixed(decimalPlaces(currency));
}
function parseProviderAmount(value, currency) {
    if (!value) {
        return 0;
    }
    return Math.round(Number(value) * 10 ** decimalPlaces(currency));
}
async function paypalRequest(credentials, path, init = {}) {
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
    return json;
}
async function getAccessToken(credentials) {
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
    const json = text ? JSON.parse(text) : null;
    if (!response.ok || !json?.access_token) {
        throw new Error(`PayPal OAuth error ${response.status}: ${text}`);
    }
    return json.access_token;
}
async function createPayPalOrder(input) {
    const order = await paypalRequest(input.credentials, "/v2/checkout/orders", {
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
async function capturePayPalOrder(credentials, providerOrderId, requestId) {
    return paypalRequest(credentials, `/v2/checkout/orders/${providerOrderId}/capture`, {
        method: "POST",
        headers: {
            "PayPal-Request-Id": requestId
        },
        body: JSON.stringify({})
    });
}
async function verifyPayPalWebhook(input) {
    const response = await paypalRequest(input.credentials, "/v1/notifications/verify-webhook-signature", {
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
function getPayPalWebhookHeaders(headers) {
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
function getPrimaryCapture(capture) {
    return capture.purchase_units?.flatMap((unit) => unit.payments?.captures ?? [])[0] ?? null;
}
//# sourceMappingURL=paypal.js.map