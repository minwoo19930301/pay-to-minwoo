"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const node_crypto_1 = require("node:crypto");
const hono_1 = require("hono");
const cors_1 = require("hono/cors");
const store_1 = require("./store");
const paypal_1 = require("./paypal");
const portone_1 = require("./portone");
const app = new hono_1.Hono();
const PAYPAL_SUPPORTED_CURRENCIES = new Set([
    "AUD",
    "BRL",
    "CAD",
    "CHF",
    "CZK",
    "DKK",
    "EUR",
    "GBP",
    "HKD",
    "HUF",
    "ILS",
    "JPY",
    "MXN",
    "NOK",
    "NZD",
    "PHP",
    "PLN",
    "SEK",
    "SGD",
    "THB",
    "TWD",
    "USD"
]);
function nowIso() {
    return new Date().toISOString();
}
function makeId(prefix) {
    return `${prefix}_${(0, node_crypto_1.randomUUID)().replace(/-/g, "").slice(0, 16)}`;
}
function currentAdminPassword() {
    return process.env.ADMIN_PASSWORD?.trim() || "321";
}
function currentAppStage() {
    const configured = process.env.APP_STAGE?.trim().toLowerCase();
    if (configured === "prod" || configured === "production") {
        return "prod";
    }
    if (configured === "dev" || configured === "development" || configured === "preview") {
        return "dev";
    }
    if (process.env.VERCEL_ENV?.trim() === "preview") {
        return "dev";
    }
    if (process.env.VERCEL_ENV?.trim() === "production") {
        return "prod";
    }
    return process.env.NODE_ENV === "production" ? "prod" : "dev";
}
function isPortOneDomesticEnabled() {
    const configured = process.env.ENABLE_PORTONE_DOMESTIC_TEST?.trim().toLowerCase();
    if (configured) {
        return ["1", "true", "yes", "on"].includes(configured);
    }
    return currentAppStage() !== "prod";
}
function currentMode() {
    return isPortOneDomesticEnabled() ? "multi-provider-core" : "paypal-live-only";
}
function currentFrontendBaseUrl() {
    const configured = process.env.FRONTEND_BASE_URL?.trim();
    if (configured) {
        return configured.replace(/\/$/, "");
    }
    return process.env.VERCEL ? "https://pay-to-minwoo-web.netlify.app" : "http://localhost:5173";
}
function currentBackendBaseUrl() {
    const configured = process.env.PUBLIC_BASE_URL?.trim() || process.env.BACKEND_BASE_URL?.trim();
    if (configured) {
        return configured.replace(/\/$/, "");
    }
    if (process.env.VERCEL_URL?.trim()) {
        return `https://${process.env.VERCEL_URL.trim().replace(/^https?:\/\//, "")}`;
    }
    return process.env.VERCEL ? "https://pay-to-minwoo.vercel.app" : "http://localhost:3000";
}
function allowedOrigins() {
    const configuredOrigins = process.env.CORS_ALLOWED_ORIGINS?.trim();
    return Array.from(new Set((configuredOrigins ??
        "http://localhost:5173,http://127.0.0.1:5173,http://localhost:4173,https://pay-to-minwoo-web.netlify.app,https://pay-to-minwoo.netlify.app")
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean)
        .concat(currentFrontendBaseUrl())));
}
function decimalPlaces(currency) {
    return ["BIF", "CLP", "DJF", "GNF", "JPY", "KMF", "KRW", "MGA", "PYG", "RWF", "UGX", "VND", "VUV", "XAF", "XOF", "XPF"].includes(currency.toUpperCase()) ? 0 : 2;
}
function toMinorUnits(amount, currency) {
    return Math.round(amount * 10 ** decimalPlaces(currency));
}
function toDisplayAmount(amount, currency) {
    return (amount / 10 ** decimalPlaces(currency)).toFixed(decimalPlaces(currency));
}
function successUrl(params) {
    return `${currentFrontendBaseUrl()}/success?${new URLSearchParams(params).toString()}`;
}
function failureUrl(params) {
    return `${currentFrontendBaseUrl()}/cancel?${new URLSearchParams(params).toString()}`;
}
function getPayPalEventType(event) {
    if (!event || typeof event !== "object") {
        return "UNKNOWN";
    }
    const candidate = event.event_type;
    return typeof candidate === "string" ? candidate : "UNKNOWN";
}
function getPayPalEventId(event) {
    if (!event || typeof event !== "object") {
        return null;
    }
    const candidate = event.id;
    return typeof candidate === "string" ? candidate : null;
}
function extractProviderOrderIdFromWebhook(event) {
    if (!event || typeof event !== "object") {
        return null;
    }
    const resource = event.resource;
    if (!resource) {
        return null;
    }
    if (typeof resource.id === "string" && getPayPalEventType(event).startsWith("CHECKOUT.ORDER")) {
        return resource.id;
    }
    if (typeof resource.supplementary_data === "object" && resource.supplementary_data) {
        const relatedIds = resource.supplementary_data.related_ids;
        if (typeof relatedIds?.order_id === "string") {
            return relatedIds.order_id;
        }
    }
    if (typeof resource.custom_id === "string") {
        return resource.custom_id;
    }
    return null;
}
async function log(entityType, entityId, action, message, metadata) {
    await (0, store_1.insertAuditLog)({
        id: makeId("audit"),
        entityType,
        entityId,
        action,
        actor: "system",
        message,
        metadata,
        createdAt: nowIso()
    });
}
async function recordCapture(input) {
    const webhookCapture = input.capture.resource;
    const capture = (0, paypal_1.getPrimaryCapture)(input.capture) ?? webhookCapture ?? null;
    const captureId = capture?.id ?? input.capture.id ?? null;
    const currency = capture?.amount?.currency_code ?? input.attempt.currency;
    const grossAmount = (0, paypal_1.parseProviderAmount)(capture?.seller_receivable_breakdown?.gross_amount?.value ?? capture?.amount?.value, currency);
    const feeAmount = (0, paypal_1.parseProviderAmount)(capture?.seller_receivable_breakdown?.paypal_fee?.value, currency);
    const netAmount = (0, paypal_1.parseProviderAmount)(capture?.seller_receivable_breakdown?.net_amount?.value, currency) || Math.max(grossAmount - feeAmount, 0);
    const eventId = input.eventId ?? captureId ?? makeId("paypal_event");
    const settlementId = makeId("settlement");
    const createdAt = nowIso();
    const existingSettlement = await (0, store_1.getSettlementByAttemptId)(input.attempt.id);
    await (0, store_1.insertProviderEvent)({
        id: makeId("event"),
        provider: "paypal",
        providerEventId: eventId,
        eventType: "PAYMENT.CAPTURE.COMPLETED",
        source: input.source,
        orderId: input.attempt.orderId,
        attemptId: input.attempt.id,
        signatureVerified: input.signatureVerified ?? input.source === "return",
        payload: input.capture,
        receivedAt: createdAt
    });
    await (0, store_1.updatePaymentAttempt)(input.attempt.id, {
        providerCaptureId: captureId,
        status: "CAPTURED",
        lastEventId: eventId,
        updatedAt: createdAt
    });
    await (0, store_1.updateOrderStatus)(input.attempt.orderId, "PAID", input.attempt.id);
    if (existingSettlement) {
        await log("payment_attempt", input.attempt.id, "CAPTURE_DUPLICATE", "PayPal capture was already settled; event was recorded only.", {
            source: input.source,
            captureId,
            existingSettlementId: existingSettlement.id
        });
        return { captureId, grossAmount: existingSettlement.grossAmount, feeAmount: existingSettlement.feeAmount, netAmount: existingSettlement.netAmount, currency: existingSettlement.currency };
    }
    await (0, store_1.insertSettlementRecord)({
        id: settlementId,
        attemptId: input.attempt.id,
        orderId: input.attempt.orderId,
        currency,
        grossAmount,
        feeAmount,
        netAmount,
        status: "SETTLED",
        payoutReference: captureId,
        createdAt,
        updatedAt: createdAt,
        paidOutAt: null
    });
    await (0, store_1.insertLedgerEntry)({
        id: makeId("ledger"),
        orderId: input.attempt.orderId,
        attemptId: input.attempt.id,
        settlementId,
        type: "payment_captured",
        amount: grossAmount,
        currency,
        direction: "credit",
        createdAt,
        metadata: { provider: "paypal", captureId }
    });
    if (feeAmount > 0) {
        await (0, store_1.insertLedgerEntry)({
            id: makeId("ledger"),
            orderId: input.attempt.orderId,
            attemptId: input.attempt.id,
            settlementId,
            type: "provider_fee",
            amount: feeAmount,
            currency,
            direction: "debit",
            createdAt,
            metadata: { provider: "paypal", captureId }
        });
    }
    await log("payment_attempt", input.attempt.id, "CAPTURED", "PayPal capture was recorded.", {
        source: input.source,
        captureId,
        grossAmount,
        feeAmount,
        netAmount,
        currency
    });
    return { captureId, grossAmount, feeAmount, netAmount, currency };
}
function makeProviderEventId(providerOrderId, status, stamp) {
    return `${providerOrderId}:${status}:${stamp}`;
}
function isRecognizedPortOnePayment(payment) {
    return typeof payment.status === "string" && "id" in payment && "updatedAt" in payment;
}
async function recordPortOnePayment(input) {
    const payment = input.payment;
    const captureId = payment.transactionId ?? payment.id;
    const currency = payment.currency;
    const grossAmount = Math.max(payment.amount.paid || payment.amount.total, 0);
    const feeAmount = 0;
    const netAmount = grossAmount;
    const eventId = input.eventId ?? makeProviderEventId(payment.id, payment.status, payment.updatedAt);
    const createdAt = nowIso();
    const settlementId = makeId("settlement");
    const existingSettlement = await (0, store_1.getSettlementByAttemptId)(input.attempt.id);
    await (0, store_1.insertProviderEvent)({
        id: makeId("event"),
        provider: "portone",
        providerEventId: eventId,
        eventType: `PAYMENT.${payment.status}`,
        source: input.source,
        orderId: input.attempt.orderId,
        attemptId: input.attempt.id,
        signatureVerified: input.signatureVerified ?? input.source === "sync",
        payload: payment,
        receivedAt: createdAt
    });
    await (0, store_1.updatePaymentAttempt)(input.attempt.id, {
        providerCaptureId: captureId,
        status: "CAPTURED",
        lastEventId: eventId,
        updatedAt: createdAt
    });
    await (0, store_1.updateOrderStatus)(input.attempt.orderId, "PAID", input.attempt.id);
    if (existingSettlement) {
        await log("payment_attempt", input.attempt.id, "CAPTURE_DUPLICATE", "PortOne payment was already settled; event was recorded only.", {
            source: input.source,
            captureId,
            existingSettlementId: existingSettlement.id
        });
        return {
            captureId,
            grossAmount: existingSettlement.grossAmount,
            feeAmount: existingSettlement.feeAmount,
            netAmount: existingSettlement.netAmount,
            currency: existingSettlement.currency,
            receiptUrl: payment.receiptUrl ?? null
        };
    }
    await (0, store_1.insertSettlementRecord)({
        id: settlementId,
        attemptId: input.attempt.id,
        orderId: input.attempt.orderId,
        currency,
        grossAmount,
        feeAmount,
        netAmount,
        status: "SETTLED",
        payoutReference: captureId,
        createdAt,
        updatedAt: createdAt,
        paidOutAt: null
    });
    await (0, store_1.insertLedgerEntry)({
        id: makeId("ledger"),
        orderId: input.attempt.orderId,
        attemptId: input.attempt.id,
        settlementId,
        type: "payment_captured",
        amount: grossAmount,
        currency,
        direction: "credit",
        createdAt,
        metadata: { provider: "portone", captureId, paymentId: payment.id }
    });
    await log("payment_attempt", input.attempt.id, "CAPTURED", "PortOne payment was verified and recorded.", {
        source: input.source,
        captureId,
        grossAmount,
        feeAmount,
        netAmount,
        currency,
        receiptUrl: payment.receiptUrl ?? null
    });
    return { captureId, grossAmount, feeAmount, netAmount, currency, receiptUrl: payment.receiptUrl ?? null };
}
async function syncPortOneAttempt(input) {
    const payment = input.payment;
    if (!isRecognizedPortOnePayment(payment)) {
        throw new Error("PortOne returned an unsupported payment shape.");
    }
    const now = nowIso();
    const providerEventId = input.eventId ?? makeProviderEventId(payment.id, payment.status, payment.updatedAt);
    if (payment.status === "PAID") {
        const summary = await recordPortOnePayment({
            attempt: input.attempt,
            payment,
            source: input.source,
            eventId: providerEventId,
            signatureVerified: input.signatureVerified
        });
        return {
            ok: true,
            provider: "portone",
            paymentStatus: payment.status,
            attemptStatus: "CAPTURED",
            orderStatus: "PAID",
            captureId: summary.captureId,
            amount: toDisplayAmount(summary.grossAmount, summary.currency),
            currency: summary.currency,
            receiptUrl: summary.receiptUrl
        };
    }
    await (0, store_1.insertProviderEvent)({
        id: makeId("event"),
        provider: "portone",
        providerEventId,
        eventType: `PAYMENT.${payment.status}`,
        source: input.source,
        orderId: input.attempt.orderId,
        attemptId: input.attempt.id,
        signatureVerified: input.signatureVerified ?? input.source === "sync",
        payload: payment,
        receivedAt: now
    });
    if (payment.status === "FAILED") {
        await (0, store_1.updatePaymentAttempt)(input.attempt.id, {
            providerCaptureId: payment.transactionId ?? null,
            status: "FAILED",
            lastEventId: providerEventId,
            updatedAt: now
        });
        await (0, store_1.updateOrderStatus)(input.attempt.orderId, "FAILED", input.attempt.id);
        await log("payment_attempt", input.attempt.id, "FAILED", "PortOne payment failed.", {
            source: input.source,
            failure: payment.failure
        });
        return {
            ok: true,
            provider: "portone",
            paymentStatus: payment.status,
            attemptStatus: "FAILED",
            orderStatus: "FAILED",
            captureId: payment.transactionId ?? null,
            amount: toDisplayAmount(payment.amount.total, payment.currency),
            currency: payment.currency,
            receiptUrl: null
        };
    }
    if (payment.status === "CANCELLED" || payment.status === "PARTIAL_CANCELLED") {
        await (0, store_1.updatePaymentAttempt)(input.attempt.id, {
            providerCaptureId: payment.transactionId ?? null,
            status: "REFUNDED",
            lastEventId: providerEventId,
            updatedAt: now
        });
        await (0, store_1.updateOrderStatus)(input.attempt.orderId, "REFUNDED", input.attempt.id);
        await log("payment_attempt", input.attempt.id, "REFUNDED", "PortOne payment was canceled or refunded.", {
            source: input.source,
            paymentStatus: payment.status,
            cancellations: payment.cancellations
        });
        return {
            ok: true,
            provider: "portone",
            paymentStatus: payment.status,
            attemptStatus: "REFUNDED",
            orderStatus: "REFUNDED",
            captureId: payment.transactionId ?? null,
            amount: toDisplayAmount(payment.amount.total, payment.currency),
            currency: payment.currency,
            receiptUrl: payment.receiptUrl ?? null
        };
    }
    const nextAttemptStatus = payment.status === "PAY_PENDING" ? "APPROVED" : "APPROVAL_READY";
    await (0, store_1.updatePaymentAttempt)(input.attempt.id, {
        providerCaptureId: payment.transactionId ?? null,
        status: nextAttemptStatus,
        lastEventId: providerEventId,
        updatedAt: now
    });
    await (0, store_1.updateOrderStatus)(input.attempt.orderId, "PAYMENT_PENDING", input.attempt.id);
    await log("payment_attempt", input.attempt.id, "PENDING", "PortOne payment is still pending confirmation.", {
        source: input.source,
        paymentStatus: payment.status
    });
    return {
        ok: true,
        provider: "portone",
        paymentStatus: payment.status,
        attemptStatus: nextAttemptStatus,
        orderStatus: "PAYMENT_PENDING",
        captureId: payment.transactionId ?? null,
        amount: toDisplayAmount(payment.amount.total, payment.currency),
        currency: payment.currency,
        receiptUrl: null
    };
}
app.use("/api/*", (0, cors_1.cors)({
    origin(origin) {
        if (!origin) {
            return "*";
        }
        return allowedOrigins().includes(origin) ? origin : "";
    },
    allowHeaders: ["Content-Type", "X-Admin-Password", "Idempotency-Key"],
    allowMethods: ["GET", "POST", "PATCH", "OPTIONS"]
}));
app.use("/api/v1/admin/*", async (c, next) => {
    if (c.req.method === "OPTIONS") {
        await next();
        return;
    }
    const password = c.req.header("x-admin-password")?.trim();
    if (password !== currentAdminPassword()) {
        return c.json({ message: "Admin password is invalid." }, 401);
    }
    await next();
});
app.get("/", (c) => c.json({
    ok: true,
    service: "pay-to-minwoo-payment-core",
    runtime: "nodejs-vercel",
    stage: currentAppStage(),
    mode: currentMode(),
    frontendBaseUrl: currentFrontendBaseUrl(),
    backendBaseUrl: currentBackendBaseUrl(),
    enabledProviders: {
        paypal: true,
        portoneDomesticTest: isPortOneDomesticEnabled() && (0, portone_1.isPortOneConfigured)()
    },
    domains: ["Order", "PaymentAttempt", "ProviderEvent", "SettlementRecord", "LedgerEntry", "AuditLog", "IdempotencyRecord"]
}));
app.get("/api/v1/health", (c) => c.json({
    ok: true,
    service: "pay-to-minwoo-payment-core",
    runtime: "nodejs-vercel",
    stage: currentAppStage(),
    mode: currentMode(),
    frontendBaseUrl: currentFrontendBaseUrl(),
    backendBaseUrl: currentBackendBaseUrl(),
    paypalEnvironment: process.env.PAYPAL_ENV?.trim().toLowerCase() === "live" ? "live" : "sandbox",
    portoneDomesticEnabled: isPortOneDomesticEnabled() && (0, portone_1.isPortOneConfigured)(),
    now: nowIso()
}));
app.post("/api/v1/orders", async (c) => {
    const body = (await c.req.json());
    if (!body.amount || body.amount <= 0) {
        return c.json({ message: "amount must be greater than zero" }, 400);
    }
    if (!body.currency || !body.locale || !body.region) {
        return c.json({ message: "currency, locale, and region are required" }, 400);
    }
    const currency = body.currency.toUpperCase();
    const idempotencyKey = c.req.header("idempotency-key")?.trim() || body.idempotencyKey?.trim() || makeId("idem");
    const existing = await (0, store_1.getOrderByIdempotencyKey)(idempotencyKey);
    if (existing) {
        return c.json({ ok: true, replayed: true, order: existing });
    }
    const order = {
        id: makeId("order"),
        idempotencyKey,
        orderType: "donation",
        itemName: body.itemName?.trim() || "Pay to Minwoo donation",
        region: body.region,
        amount: toMinorUnits(body.amount, currency),
        currency,
        note: body.note?.trim() || "",
        status: "CREATED",
        createdAt: nowIso()
    };
    await (0, store_1.insertOrder)(order);
    await (0, store_1.insertIdempotencyRecord)({
        id: makeId("idemrec"),
        scope: "orders.create",
        key: idempotencyKey,
        resourceType: "order",
        resourceId: order.id,
        createdAt: order.createdAt
    });
    await log("order", order.id, "CREATED", "Order was created.", { currency: order.currency, amount: order.amount });
    return c.json({ ok: true, replayed: false, order }, 201);
});
app.post("/api/v1/orders/:orderId/payment-attempts/paypal", async (c) => {
    const orderId = c.req.param("orderId");
    const order = await (0, store_1.getOrderById)(orderId);
    if (!order) {
        return c.json({ message: "Order not found." }, 404);
    }
    if (!PAYPAL_SUPPORTED_CURRENCIES.has(order.currency)) {
        return c.json({
            message: "Currency is not supported by PayPal Orders API.",
            currency: order.currency,
            supportedCurrencies: Array.from(PAYPAL_SUPPORTED_CURRENCIES).sort()
        }, 400);
    }
    const idempotencyKey = c.req.header("idempotency-key")?.trim() || makeId("paypal_req");
    const existingRecord = await (0, store_1.findIdempotencyRecord)("paypal.order.create", idempotencyKey);
    if (existingRecord) {
        const existingAttempt = await (0, store_1.getPaymentAttemptById)(existingRecord.resourceId);
        if (existingAttempt) {
            return c.json({ ok: true, replayed: true, orderId, attempt: existingAttempt, redirectUrl: existingAttempt.checkoutUrl });
        }
    }
    const credentials = (0, paypal_1.getPayPalCredentials)();
    const attemptId = makeId("attempt");
    const backendBaseUrl = currentBackendBaseUrl();
    const { order: paypalOrder, approveUrl } = await (0, paypal_1.createPayPalOrder)({
        credentials,
        amount: order.amount,
        currency: order.currency,
        itemName: order.itemName,
        orderId: order.id,
        attemptId,
        returnUrl: `${backendBaseUrl}/paypal/return?attemptId=${encodeURIComponent(attemptId)}`,
        cancelUrl: `${backendBaseUrl}/paypal/cancel?attemptId=${encodeURIComponent(attemptId)}`,
        requestId: idempotencyKey
    });
    const createdAt = nowIso();
    const attempt = {
        id: attemptId,
        orderId: order.id,
        provider: "paypal",
        providerOrderId: paypalOrder.id,
        providerCaptureId: null,
        status: "APPROVAL_READY",
        checkoutUrl: approveUrl,
        amount: order.amount,
        currency: order.currency,
        createdAt,
        updatedAt: createdAt
    };
    await (0, store_1.insertPaymentAttempt)(attempt);
    await (0, store_1.insertIdempotencyRecord)({
        id: makeId("idemrec"),
        scope: "paypal.order.create",
        key: idempotencyKey,
        resourceType: "payment_attempt",
        resourceId: attempt.id,
        createdAt
    });
    await (0, store_1.insertProviderEvent)({
        id: makeId("event"),
        provider: "paypal",
        providerEventId: paypalOrder.id,
        eventType: "CHECKOUT.ORDER.CREATED",
        source: "api",
        orderId: order.id,
        attemptId: attempt.id,
        signatureVerified: true,
        payload: paypalOrder,
        receivedAt: createdAt
    });
    await (0, store_1.updateOrderStatus)(order.id, "PAYMENT_PENDING", attempt.id);
    await log("payment_attempt", attempt.id, "APPROVAL_READY", "PayPal order was created.", { providerOrderId: paypalOrder.id });
    return c.json({ ok: true, replayed: false, orderId: order.id, attempt, redirectUrl: approveUrl }, 201);
});
app.post("/api/v1/orders/:orderId/payment-attempts/portone", async (c) => {
    if (!isPortOneDomesticEnabled()) {
        return c.json({ message: "PortOne domestic test checkout is disabled in this environment." }, 404);
    }
    if (!(0, portone_1.isPortOneConfigured)()) {
        return c.json({ message: "PortOne credentials are not configured." }, 500);
    }
    const orderId = c.req.param("orderId");
    const order = await (0, store_1.getOrderById)(orderId);
    if (!order) {
        return c.json({ message: "Order not found." }, 404);
    }
    if (order.region !== "domestic" || order.currency !== "KRW") {
        return c.json({ message: "PortOne domestic test checkout currently supports domestic KRW orders only." }, 400);
    }
    const body = (await c.req.json().catch(() => ({})));
    const payMethod = (0, portone_1.normalizePortOnePayMethod)(body.payMethod);
    const idempotencyKey = c.req.header("idempotency-key")?.trim() || makeId("portone_req");
    const existingRecord = await (0, store_1.findIdempotencyRecord)("portone.payment.create", idempotencyKey);
    if (existingRecord) {
        const existingAttempt = await (0, store_1.getPaymentAttemptById)(existingRecord.resourceId);
        if (existingAttempt) {
            const credentials = (0, portone_1.getPortOneCredentials)();
            return c.json({
                ok: true,
                replayed: true,
                orderId,
                attempt: existingAttempt,
                paymentRequest: {
                    storeId: credentials.storeId,
                    channelKey: credentials.channelKey,
                    paymentId: existingAttempt.providerOrderId,
                    orderName: order.itemName,
                    totalAmount: order.amount,
                    currency: order.currency,
                    payMethod,
                    redirectUrl: `${currentFrontendBaseUrl()}/portone/redirect?orderId=${encodeURIComponent(order.id)}&attemptId=${encodeURIComponent(existingAttempt.id)}`,
                    noticeUrls: [`${currentBackendBaseUrl()}/api/v1/webhooks/portone`],
                    locale: "KO_KR",
                    country: "KR",
                    customData: { orderId: order.id, attemptId: existingAttempt.id, region: order.region }
                }
            });
        }
    }
    const credentials = (0, portone_1.getPortOneCredentials)();
    const createdAt = nowIso();
    const attemptId = makeId("attempt");
    const paymentId = attemptId;
    const redirectUrl = `${currentFrontendBaseUrl()}/portone/redirect?orderId=${encodeURIComponent(order.id)}&attemptId=${encodeURIComponent(attemptId)}`;
    const paymentRequest = {
        storeId: credentials.storeId,
        channelKey: credentials.channelKey,
        paymentId,
        orderName: order.itemName,
        totalAmount: order.amount,
        currency: order.currency,
        payMethod,
        redirectUrl,
        noticeUrls: [`${currentBackendBaseUrl()}/api/v1/webhooks/portone`],
        locale: "KO_KR",
        country: "KR",
        customData: {
            orderId: order.id,
            attemptId,
            region: order.region,
            note: order.note
        }
    };
    const attempt = {
        id: attemptId,
        orderId: order.id,
        provider: "portone",
        providerOrderId: paymentId,
        providerCaptureId: null,
        status: "APPROVAL_READY",
        checkoutUrl: "portone://browser-sdk",
        amount: order.amount,
        currency: order.currency,
        createdAt,
        updatedAt: createdAt
    };
    await (0, store_1.insertPaymentAttempt)(attempt);
    await (0, store_1.insertIdempotencyRecord)({
        id: makeId("idemrec"),
        scope: "portone.payment.create",
        key: idempotencyKey,
        resourceType: "payment_attempt",
        resourceId: attempt.id,
        createdAt
    });
    await (0, store_1.insertProviderEvent)({
        id: makeId("event"),
        provider: "portone",
        providerEventId: paymentId,
        eventType: "PAYMENT.REQUEST_PREPARED",
        source: "api",
        orderId: order.id,
        attemptId: attempt.id,
        signatureVerified: true,
        payload: paymentRequest,
        receivedAt: createdAt
    });
    await (0, store_1.updateOrderStatus)(order.id, "PAYMENT_PENDING", attempt.id);
    await log("payment_attempt", attempt.id, "APPROVAL_READY", "PortOne browser payment request was prepared.", {
        payMethod,
        paymentId
    });
    return c.json({ ok: true, replayed: false, orderId: order.id, attempt, paymentRequest }, 201);
});
app.get("/api/v1/orders/:orderId", async (c) => {
    const order = await (0, store_1.getOrderById)(c.req.param("orderId"));
    if (!order) {
        return c.json({ message: "Order not found." }, 404);
    }
    return c.json({ ok: true, order });
});
app.get("/api/v1/payment-attempts/:attemptId", async (c) => {
    const attempt = await (0, store_1.getPaymentAttemptById)(c.req.param("attemptId"));
    if (!attempt) {
        return c.json({ message: "Payment attempt not found." }, 404);
    }
    return c.json({ ok: true, attempt });
});
app.post("/api/v1/orders/:orderId/payment-attempts/:attemptId/portone/complete", async (c) => {
    if (!isPortOneDomesticEnabled()) {
        return c.json({ message: "PortOne domestic test checkout is disabled in this environment." }, 404);
    }
    if (!(0, portone_1.isPortOneConfigured)()) {
        return c.json({ message: "PortOne credentials are not configured." }, 500);
    }
    const orderId = c.req.param("orderId");
    const attemptId = c.req.param("attemptId");
    const [order, attempt] = await Promise.all([(0, store_1.getOrderById)(orderId), (0, store_1.getPaymentAttemptById)(attemptId)]);
    if (!order) {
        return c.json({ message: "Order not found." }, 404);
    }
    if (!attempt || attempt.orderId !== order.id || attempt.provider !== "portone") {
        return c.json({ message: "PortOne payment attempt not found." }, 404);
    }
    const body = (await c.req.json().catch(() => ({})));
    if (body.errorCode || body.errorMessage) {
        const receivedAt = nowIso();
        const providerEventId = makeProviderEventId(attempt.providerOrderId, "CLIENT_FAILED", receivedAt);
        await (0, store_1.updatePaymentAttempt)(attempt.id, {
            status: "FAILED",
            lastEventId: providerEventId,
            updatedAt: receivedAt
        });
        await (0, store_1.updateOrderStatus)(order.id, "FAILED", attempt.id);
        await log("payment_attempt", attempt.id, "FAILED", "PortOne payment failed before server verification.", {
            errorCode: body.errorCode ?? null,
            errorMessage: body.errorMessage ?? null,
            pgCode: body.pgCode ?? null,
            pgMessage: body.pgMessage ?? null
        });
        return c.json({
            ok: true,
            provider: "portone",
            paymentStatus: "FAILED",
            attemptStatus: "FAILED",
            orderStatus: "FAILED",
            captureId: null,
            amount: toDisplayAmount(order.amount, order.currency),
            currency: order.currency,
            receiptUrl: null
        });
    }
    const paymentId = body.paymentId?.trim() || attempt.providerOrderId;
    if (paymentId !== attempt.providerOrderId) {
        return c.json({ message: "paymentId does not match the stored PortOne payment attempt." }, 400);
    }
    const credentials = (0, portone_1.getPortOneCredentials)();
    try {
        const payment = await (0, portone_1.getPortOnePayment)(credentials, paymentId);
        const result = await syncPortOneAttempt({ attempt, payment, source: "sync" });
        return c.json(result);
    }
    catch (error) {
        await (0, store_1.updatePaymentAttempt)(attempt.id, { status: "FAILED", updatedAt: nowIso() });
        await (0, store_1.updateOrderStatus)(order.id, "FAILED", attempt.id);
        await log("payment_attempt", attempt.id, "VERIFY_FAILED", "PortOne payment verification failed.", {
            paymentId,
            message: error instanceof Error ? error.message : String(error)
        });
        return c.json({
            message: "PortOne payment verification failed.",
            paymentId,
            detail: error instanceof Error ? error.message : String(error)
        }, 502);
    }
});
app.get("/paypal/return", async (c) => {
    const attemptId = c.req.query("attemptId")?.trim();
    if (!attemptId) {
        return c.redirect(failureUrl({ reason: "missing_attempt" }));
    }
    const attempt = await (0, store_1.getPaymentAttemptById)(attemptId);
    if (!attempt) {
        return c.redirect(failureUrl({ attemptId, reason: "attempt_not_found" }));
    }
    try {
        const credentials = (0, paypal_1.getPayPalCredentials)();
        const capture = await (0, paypal_1.capturePayPalOrder)(credentials, attempt.providerOrderId, `capture_${attempt.id}`);
        const result = await recordCapture({ attempt, capture, source: "return" });
        return c.redirect(successUrl({
            orderId: attempt.orderId,
            attemptId: attempt.id,
            provider: "paypal",
            captureId: result.captureId ?? "",
            amount: toDisplayAmount(result.grossAmount, result.currency),
            currency: result.currency
        }));
    }
    catch (error) {
        await (0, store_1.updatePaymentAttempt)(attempt.id, { status: "FAILED" });
        await (0, store_1.updateOrderStatus)(attempt.orderId, "FAILED", attempt.id);
        await log("payment_attempt", attempt.id, "CAPTURE_FAILED", "PayPal capture failed.", {
            message: error instanceof Error ? error.message : String(error)
        });
        return c.redirect(failureUrl({ orderId: attempt.orderId, attemptId: attempt.id, provider: "paypal", reason: "capture_failed" }));
    }
});
app.get("/paypal/cancel", async (c) => {
    const attemptId = c.req.query("attemptId")?.trim();
    if (!attemptId) {
        return c.redirect(failureUrl({ reason: "missing_attempt" }));
    }
    const attempt = await (0, store_1.getPaymentAttemptById)(attemptId);
    if (attempt) {
        await (0, store_1.updatePaymentAttempt)(attempt.id, { status: "CANCELED" });
        await (0, store_1.updateOrderStatus)(attempt.orderId, "CANCELED", attempt.id);
        await log("payment_attempt", attempt.id, "CANCELED", "PayPal checkout was canceled by the payer.");
    }
    return c.redirect(failureUrl({ attemptId, provider: "paypal", reason: "payer_canceled" }));
});
app.post("/api/v1/webhooks/paypal", async (c) => {
    const headers = (0, paypal_1.getPayPalWebhookHeaders)(c.req.raw.headers);
    const rawBody = await c.req.text();
    let event;
    try {
        event = JSON.parse(rawBody);
    }
    catch {
        return c.json({ message: "Webhook body must be valid JSON." }, 400);
    }
    const credentials = (0, paypal_1.getPayPalCredentials)();
    if (!credentials.webhookId) {
        return c.json({ message: "PAYPAL_WEBHOOK_ID is not configured." }, 500);
    }
    if (!headers) {
        return c.json({ message: "PayPal webhook signature headers are missing." }, 400);
    }
    const signatureVerified = await (0, paypal_1.verifyPayPalWebhook)({ credentials, webhookId: credentials.webhookId, headers, event });
    if (!signatureVerified) {
        return c.json({ message: "PayPal webhook signature verification failed." }, 401);
    }
    const eventType = getPayPalEventType(event);
    const providerEventId = getPayPalEventId(event);
    const providerOrderId = extractProviderOrderIdFromWebhook(event);
    const attempt = providerOrderId ? await (0, store_1.getPaymentAttemptByProviderOrderId)(providerOrderId) : null;
    const receivedAt = nowIso();
    await (0, store_1.insertProviderEvent)({
        id: makeId("event"),
        provider: "paypal",
        providerEventId,
        eventType,
        source: "webhook",
        orderId: attempt?.orderId ?? null,
        attemptId: attempt?.id ?? null,
        signatureVerified,
        payload: event,
        receivedAt
    });
    if (!attempt) {
        return c.json({ ok: true, ignored: true, reason: "attempt_not_found", eventType });
    }
    if (eventType === "CHECKOUT.ORDER.APPROVED") {
        await (0, store_1.updatePaymentAttempt)(attempt.id, { status: "APPROVED", lastEventId: providerEventId ?? null, updatedAt: receivedAt });
        await log("payment_attempt", attempt.id, "APPROVED", "PayPal order was approved by webhook.", { providerEventId });
    }
    if (eventType === "PAYMENT.CAPTURE.COMPLETED") {
        await recordCapture({ attempt, capture: event, source: "webhook", eventId: providerEventId, signatureVerified });
    }
    if (["PAYMENT.CAPTURE.DENIED", "PAYMENT.CAPTURE.DECLINED"].includes(eventType)) {
        await (0, store_1.updatePaymentAttempt)(attempt.id, { status: "FAILED", lastEventId: providerEventId ?? null, updatedAt: receivedAt });
        await (0, store_1.updateOrderStatus)(attempt.orderId, "FAILED", attempt.id);
    }
    if (["PAYMENT.CAPTURE.REFUNDED", "PAYMENT.CAPTURE.REVERSED"].includes(eventType)) {
        await (0, store_1.updatePaymentAttempt)(attempt.id, { status: "REFUNDED", lastEventId: providerEventId ?? null, updatedAt: receivedAt });
        await (0, store_1.updateOrderStatus)(attempt.orderId, "REFUNDED", attempt.id);
    }
    return c.json({ ok: true, eventType, providerEventId, attemptId: attempt.id, orderId: attempt.orderId });
});
app.post("/api/v1/webhooks/portone", async (c) => {
    if (!(0, portone_1.isPortOneConfigured)()) {
        return c.json({ message: "PortOne credentials are not configured." }, 500);
    }
    const credentials = (0, portone_1.getPortOneCredentials)();
    if (!credentials.webhookSecret) {
        return c.json({ message: "PORTONE_WEBHOOK_SECRET is not configured." }, 500);
    }
    const headers = (0, portone_1.getPortOneWebhookHeaders)(c.req.raw.headers);
    if (!headers) {
        return c.json({ message: "PortOne webhook signature headers are missing." }, 400);
    }
    const rawBody = await c.req.text();
    let webhook;
    try {
        webhook = await (0, portone_1.verifyPortOneWebhook)({
            webhookSecret: credentials.webhookSecret,
            payload: rawBody,
            headers
        });
    }
    catch (error) {
        return c.json({
            message: "PortOne webhook verification failed.",
            detail: error instanceof Error ? error.message : String(error)
        }, 401);
    }
    if (!("type" in webhook) || !("data" in webhook) || !webhook.data || typeof webhook.data !== "object" || !("paymentId" in webhook.data)) {
        return c.json({ ok: true, ignored: true, reason: "unsupported_webhook_shape" });
    }
    const paymentId = String(webhook.data.paymentId);
    const attempt = await (0, store_1.getPaymentAttemptByProviderOrderId)(paymentId);
    const receivedAt = nowIso();
    await (0, store_1.insertProviderEvent)({
        id: makeId("event"),
        provider: "portone",
        providerEventId: makeProviderEventId(paymentId, webhook.type, webhook.timestamp),
        eventType: webhook.type,
        source: "webhook",
        orderId: attempt?.orderId ?? null,
        attemptId: attempt?.id ?? null,
        signatureVerified: true,
        payload: webhook,
        receivedAt
    });
    if (!attempt) {
        return c.json({ ok: true, ignored: true, reason: "attempt_not_found", paymentId, eventType: webhook.type });
    }
    if (webhook.type === "Transaction.Paid" || webhook.type === "Transaction.Failed" || webhook.type === "Transaction.Cancelled") {
        const payment = await (0, portone_1.getPortOnePayment)(credentials, paymentId);
        const result = await syncPortOneAttempt({
            attempt,
            payment,
            source: "webhook",
            eventId: makeProviderEventId(paymentId, webhook.type, webhook.timestamp),
            signatureVerified: true
        });
        return c.json({ ok: true, paymentId, eventType: webhook.type, attemptId: attempt.id, orderId: attempt.orderId, result });
    }
    return c.json({ ok: true, paymentId, eventType: webhook.type, attemptId: attempt.id, orderId: attempt.orderId });
});
app.get("/api/v1/admin/dashboard", async (c) => {
    const limit = Math.min(Number(c.req.query("limit") ?? "20"), 100);
    const [orderCount, paymentAttemptCount, orders, attempts] = await Promise.all([
        (0, store_1.countOrders)(),
        (0, store_1.countPaymentAttempts)(),
        (0, store_1.listRecentOrders)(limit),
        (0, store_1.listRecentPaymentAttempts)(limit)
    ]);
    return c.json({
        ok: true,
        stage: currentAppStage(),
        mode: currentMode(),
        now: nowIso(),
        totals: {
            orders: orderCount,
            paymentAttempts: paymentAttemptCount
        },
        orders,
        attempts
    });
});
app.get("/api/v1/admin/tables", async (c) => c.json({
    ok: true,
    tables: await (0, store_1.listAdminTables)()
}));
app.get("/api/v1/admin/tables/:tableName/rows", async (c) => {
    const tableName = c.req.param("tableName");
    const page = Number(c.req.query("page") ?? "1");
    const pageSize = Number(c.req.query("pageSize") ?? "20");
    const table = await (0, store_1.listAdminTableRows)(tableName, page, pageSize);
    if (!table) {
        return c.json({ message: "Admin table not found." }, 404);
    }
    return c.json({ ok: true, ...table });
});
app.patch("/api/v1/admin/tables/:tableName/rows/:rowId", async (c) => {
    const tableName = c.req.param("tableName");
    const rowId = c.req.param("rowId");
    const body = (await c.req.json());
    const row = await (0, store_1.updateAdminTableRow)(tableName, rowId, body.values ?? {});
    if (!row) {
        return c.json({ message: "Admin table row not found or no editable values were provided." }, 404);
    }
    return c.json({ ok: true, table: tableName, row });
});
app.post("/api/v1/donations/intents", (c) => c.json({ message: "Removed. Use POST /api/v1/orders." }, 410));
app.post("/api/v1/donations/intents/:intentId/checkout", (c) => c.json({ message: "Removed. Use POST /api/v1/orders/:orderId/payment-attempts/paypal." }, 410));
app.get("/api/v1/donations/attempts/:attemptId", (c) => c.json({ message: "Removed. Use GET /api/v1/payment-attempts/:attemptId." }, 410));
app.notFound((c) => c.json({ message: "Not found" }, 404));
exports.default = app;
//# sourceMappingURL=index.js.map