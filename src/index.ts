import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { cors } from "hono/cors";
import {
  type AdminTableName,
  type OrderStatus,
  type PaymentAttemptRecord,
  countOrders,
  countPaymentAttempts,
  findIdempotencyRecord,
  getOrderById,
  getOrderByIdempotencyKey,
  getPaymentAttemptById,
  getPaymentAttemptByProviderOrderId,
  getSettlementByAttemptId,
  insertAuditLog,
  insertIdempotencyRecord,
  insertLedgerEntry,
  insertOrder,
  insertPaymentAttempt,
  insertProviderEvent,
  insertSettlementRecord,
  listAdminTableRows,
  listAdminTables,
  listRecentOrders,
  listRecentPaymentAttempts,
  updateAdminTableRow,
  updateOrderStatus,
  updatePaymentAttempt
} from "./store";
import {
  capturePayPalOrder,
  createPayPalOrder,
  getPayPalCredentials,
  getPayPalWebhookHeaders,
  getPrimaryCapture,
  parseProviderAmount,
  verifyPayPalWebhook
} from "./paypal";

type Locale = "ko" | "en";
type Region = "domestic" | "international";

type CreateOrderBody = Partial<{
  amount: number;
  currency: string;
  note: string;
  locale: Locale;
  region: Region;
  itemName: string;
  idempotencyKey: string;
}>;

const app = new Hono();
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

function makeId(prefix: string) {
  return `${prefix}_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
}

function currentAdminPassword() {
  return process.env.ADMIN_PASSWORD?.trim() || "321";
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

  return process.env.VERCEL ? "https://pay-to-minwoo.vercel.app" : "http://localhost:3000";
}

function allowedOrigins() {
  const configuredOrigins = process.env.CORS_ALLOWED_ORIGINS?.trim();
  return (
    configuredOrigins ??
    "http://localhost:5173,http://127.0.0.1:5173,http://localhost:4173,https://pay-to-minwoo-web.netlify.app,https://pay-to-minwoo.netlify.app"
  )
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function decimalPlaces(currency: string) {
  return ["BIF", "CLP", "DJF", "GNF", "JPY", "KMF", "KRW", "MGA", "PYG", "RWF", "UGX", "VND", "VUV", "XAF", "XOF", "XPF"].includes(currency.toUpperCase()) ? 0 : 2;
}

function toMinorUnits(amount: number, currency: string) {
  return Math.round(amount * 10 ** decimalPlaces(currency));
}

function toDisplayAmount(amount: number, currency: string) {
  return (amount / 10 ** decimalPlaces(currency)).toFixed(decimalPlaces(currency));
}

function successUrl(params: Record<string, string>) {
  return `${currentFrontendBaseUrl()}/success?${new URLSearchParams(params).toString()}`;
}

function failureUrl(params: Record<string, string>) {
  return `${currentFrontendBaseUrl()}/cancel?${new URLSearchParams(params).toString()}`;
}

function getPayPalEventType(event: unknown) {
  if (!event || typeof event !== "object") {
    return "UNKNOWN";
  }

  const candidate = (event as { event_type?: unknown }).event_type;
  return typeof candidate === "string" ? candidate : "UNKNOWN";
}

function getPayPalEventId(event: unknown) {
  if (!event || typeof event !== "object") {
    return null;
  }

  const candidate = (event as { id?: unknown }).id;
  return typeof candidate === "string" ? candidate : null;
}

function extractProviderOrderIdFromWebhook(event: unknown) {
  if (!event || typeof event !== "object") {
    return null;
  }

  const resource = (event as { resource?: Record<string, unknown> }).resource;
  if (!resource) {
    return null;
  }

  if (typeof resource.id === "string" && getPayPalEventType(event).startsWith("CHECKOUT.ORDER")) {
    return resource.id;
  }

  if (typeof resource.supplementary_data === "object" && resource.supplementary_data) {
    const relatedIds = (resource.supplementary_data as { related_ids?: { order_id?: unknown } }).related_ids;
    if (typeof relatedIds?.order_id === "string") {
      return relatedIds.order_id;
    }
  }

  if (typeof resource.custom_id === "string") {
    return resource.custom_id;
  }

  return null;
}

async function log(entityType: string, entityId: string, action: string, message: string, metadata?: unknown) {
  await insertAuditLog({
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

async function recordCapture(input: {
  attempt: PaymentAttemptRecord;
  capture: Awaited<ReturnType<typeof capturePayPalOrder>>;
  source: "return" | "webhook";
  eventId?: string | null;
  signatureVerified?: boolean;
}) {
  const webhookCapture = (input.capture as { resource?: { id?: string; status?: string; amount?: { currency_code?: string; value?: string }; seller_receivable_breakdown?: { gross_amount?: { currency_code?: string; value?: string }; paypal_fee?: { currency_code?: string; value?: string }; net_amount?: { currency_code?: string; value?: string } } } }).resource;
  const capture = getPrimaryCapture(input.capture) ?? webhookCapture ?? null;
  const captureId = capture?.id ?? input.capture.id ?? null;
  const currency = capture?.amount?.currency_code ?? input.attempt.currency;
  const grossAmount = parseProviderAmount(capture?.seller_receivable_breakdown?.gross_amount?.value ?? capture?.amount?.value, currency);
  const feeAmount = parseProviderAmount(capture?.seller_receivable_breakdown?.paypal_fee?.value, currency);
  const netAmount = parseProviderAmount(capture?.seller_receivable_breakdown?.net_amount?.value, currency) || Math.max(grossAmount - feeAmount, 0);
  const eventId = input.eventId ?? captureId ?? makeId("paypal_event");
  const settlementId = makeId("settlement");
  const createdAt = nowIso();
  const existingSettlement = await getSettlementByAttemptId(input.attempt.id);

  await insertProviderEvent({
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

  await updatePaymentAttempt(input.attempt.id, {
    providerCaptureId: captureId,
    status: "CAPTURED",
    lastEventId: eventId,
    updatedAt: createdAt
  });
  await updateOrderStatus(input.attempt.orderId, "PAID", input.attempt.id);

  if (existingSettlement) {
    await log("payment_attempt", input.attempt.id, "CAPTURE_DUPLICATE", "PayPal capture was already settled; event was recorded only.", {
      source: input.source,
      captureId,
      existingSettlementId: existingSettlement.id
    });
    return { captureId, grossAmount: existingSettlement.grossAmount, feeAmount: existingSettlement.feeAmount, netAmount: existingSettlement.netAmount, currency: existingSettlement.currency };
  }

  await insertSettlementRecord({
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
  await insertLedgerEntry({
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
    await insertLedgerEntry({
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

app.use(
  "/api/*",
  cors({
    origin(origin) {
      if (!origin) {
        return "*";
      }

      return allowedOrigins().includes(origin) ? origin : "";
    },
    allowHeaders: ["Content-Type", "X-Admin-Password", "Idempotency-Key"],
    allowMethods: ["GET", "POST", "PATCH", "OPTIONS"]
  })
);

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

app.get("/", (c) =>
  c.json({
    ok: true,
    service: "pay-to-minwoo-payment-core",
    runtime: "nodejs-vercel",
    mode: "paypal-live-only",
    frontendBaseUrl: currentFrontendBaseUrl(),
    backendBaseUrl: currentBackendBaseUrl(),
    domains: ["Order", "PaymentAttempt", "ProviderEvent", "SettlementRecord", "LedgerEntry", "AuditLog", "IdempotencyRecord"]
  })
);

app.get("/api/v1/health", (c) =>
  c.json({
    ok: true,
    service: "pay-to-minwoo-payment-core",
    runtime: "nodejs-vercel",
    mode: "paypal-live-only",
    frontendBaseUrl: currentFrontendBaseUrl(),
    backendBaseUrl: currentBackendBaseUrl(),
    paypalEnvironment: process.env.PAYPAL_ENV?.trim().toLowerCase() === "live" ? "live" : "sandbox",
    now: nowIso()
  })
);

app.post("/api/v1/orders", async (c) => {
  const body = (await c.req.json()) as CreateOrderBody;

  if (!body.amount || body.amount <= 0) {
    return c.json({ message: "amount must be greater than zero" }, 400);
  }

  if (!body.currency || !body.locale || !body.region) {
    return c.json({ message: "currency, locale, and region are required" }, 400);
  }

  const currency = body.currency.toUpperCase();
  const idempotencyKey = c.req.header("idempotency-key")?.trim() || body.idempotencyKey?.trim() || makeId("idem");
  const existing = await getOrderByIdempotencyKey(idempotencyKey);

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
    status: "CREATED" as OrderStatus,
    createdAt: nowIso()
  };

  await insertOrder(order);
  await insertIdempotencyRecord({
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
  const order = await getOrderById(orderId);

  if (!order) {
    return c.json({ message: "Order not found." }, 404);
  }

  if (!PAYPAL_SUPPORTED_CURRENCIES.has(order.currency)) {
    return c.json(
      {
        message: "Currency is not supported by PayPal Orders API.",
        currency: order.currency,
        supportedCurrencies: Array.from(PAYPAL_SUPPORTED_CURRENCIES).sort()
      },
      400
    );
  }

  const idempotencyKey = c.req.header("idempotency-key")?.trim() || makeId("paypal_req");
  const existingRecord = await findIdempotencyRecord("paypal.order.create", idempotencyKey);
  if (existingRecord) {
    const existingAttempt = await getPaymentAttemptById(existingRecord.resourceId);
    if (existingAttempt) {
      return c.json({ ok: true, replayed: true, orderId, attempt: existingAttempt, redirectUrl: existingAttempt.checkoutUrl });
    }
  }

  const credentials = getPayPalCredentials();
  const attemptId = makeId("attempt");
  const backendBaseUrl = currentBackendBaseUrl();
  const { order: paypalOrder, approveUrl } = await createPayPalOrder({
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
    status: "APPROVAL_READY" as const,
    checkoutUrl: approveUrl,
    amount: order.amount,
    currency: order.currency,
    createdAt,
    updatedAt: createdAt
  };

  await insertPaymentAttempt(attempt);
  await insertIdempotencyRecord({
    id: makeId("idemrec"),
    scope: "paypal.order.create",
    key: idempotencyKey,
    resourceType: "payment_attempt",
    resourceId: attempt.id,
    createdAt
  });
  await insertProviderEvent({
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
  await updateOrderStatus(order.id, "PAYMENT_PENDING", attempt.id);
  await log("payment_attempt", attempt.id, "APPROVAL_READY", "PayPal order was created.", { providerOrderId: paypalOrder.id });

  return c.json({ ok: true, replayed: false, orderId: order.id, attempt, redirectUrl: approveUrl }, 201);
});

app.get("/api/v1/orders/:orderId", async (c) => {
  const order = await getOrderById(c.req.param("orderId"));
  if (!order) {
    return c.json({ message: "Order not found." }, 404);
  }

  return c.json({ ok: true, order });
});

app.get("/api/v1/payment-attempts/:attemptId", async (c) => {
  const attempt = await getPaymentAttemptById(c.req.param("attemptId"));
  if (!attempt) {
    return c.json({ message: "Payment attempt not found." }, 404);
  }

  return c.json({ ok: true, attempt });
});

app.get("/paypal/return", async (c) => {
  const attemptId = c.req.query("attemptId")?.trim();
  if (!attemptId) {
    return c.redirect(failureUrl({ reason: "missing_attempt" }));
  }

  const attempt = await getPaymentAttemptById(attemptId);
  if (!attempt) {
    return c.redirect(failureUrl({ attemptId, reason: "attempt_not_found" }));
  }

  try {
    const credentials = getPayPalCredentials();
    const capture = await capturePayPalOrder(credentials, attempt.providerOrderId, `capture_${attempt.id}`);
    const result = await recordCapture({ attempt, capture, source: "return" });

    return c.redirect(
      successUrl({
        orderId: attempt.orderId,
        attemptId: attempt.id,
        provider: "paypal",
        captureId: result.captureId ?? "",
        amount: toDisplayAmount(result.grossAmount, result.currency),
        currency: result.currency
      })
    );
  } catch (error) {
    await updatePaymentAttempt(attempt.id, { status: "FAILED" });
    await updateOrderStatus(attempt.orderId, "FAILED", attempt.id);
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

  const attempt = await getPaymentAttemptById(attemptId);
  if (attempt) {
    await updatePaymentAttempt(attempt.id, { status: "CANCELED" });
    await updateOrderStatus(attempt.orderId, "CANCELED", attempt.id);
    await log("payment_attempt", attempt.id, "CANCELED", "PayPal checkout was canceled by the payer.");
  }

  return c.redirect(failureUrl({ attemptId, provider: "paypal", reason: "payer_canceled" }));
});

app.post("/api/v1/webhooks/paypal", async (c) => {
  const headers = getPayPalWebhookHeaders(c.req.raw.headers);
  const rawBody = await c.req.text();
  let event: unknown;

  try {
    event = JSON.parse(rawBody);
  } catch {
    return c.json({ message: "Webhook body must be valid JSON." }, 400);
  }

  const credentials = getPayPalCredentials();
  if (!credentials.webhookId) {
    return c.json({ message: "PAYPAL_WEBHOOK_ID is not configured." }, 500);
  }

  if (!headers) {
    return c.json({ message: "PayPal webhook signature headers are missing." }, 400);
  }

  const signatureVerified = await verifyPayPalWebhook({ credentials, webhookId: credentials.webhookId, headers, event });
  if (!signatureVerified) {
    return c.json({ message: "PayPal webhook signature verification failed." }, 401);
  }

  const eventType = getPayPalEventType(event);
  const providerEventId = getPayPalEventId(event);
  const providerOrderId = extractProviderOrderIdFromWebhook(event);
  const attempt = providerOrderId ? await getPaymentAttemptByProviderOrderId(providerOrderId) : null;
  const receivedAt = nowIso();

  await insertProviderEvent({
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
    await updatePaymentAttempt(attempt.id, { status: "APPROVED", lastEventId: providerEventId ?? null, updatedAt: receivedAt });
    await log("payment_attempt", attempt.id, "APPROVED", "PayPal order was approved by webhook.", { providerEventId });
  }

  if (eventType === "PAYMENT.CAPTURE.COMPLETED") {
    await recordCapture({ attempt, capture: event as Awaited<ReturnType<typeof capturePayPalOrder>>, source: "webhook", eventId: providerEventId, signatureVerified });
  }

  if (["PAYMENT.CAPTURE.DENIED", "PAYMENT.CAPTURE.DECLINED"].includes(eventType)) {
    await updatePaymentAttempt(attempt.id, { status: "FAILED", lastEventId: providerEventId ?? null, updatedAt: receivedAt });
    await updateOrderStatus(attempt.orderId, "FAILED", attempt.id);
  }

  if (["PAYMENT.CAPTURE.REFUNDED", "PAYMENT.CAPTURE.REVERSED"].includes(eventType)) {
    await updatePaymentAttempt(attempt.id, { status: "REFUNDED", lastEventId: providerEventId ?? null, updatedAt: receivedAt });
    await updateOrderStatus(attempt.orderId, "REFUNDED", attempt.id);
  }

  return c.json({ ok: true, eventType, providerEventId, attemptId: attempt.id, orderId: attempt.orderId });
});

app.get("/api/v1/admin/dashboard", async (c) => {
  const limit = Math.min(Number(c.req.query("limit") ?? "20"), 100);
  const [orderCount, paymentAttemptCount, orders, attempts] = await Promise.all([
    countOrders(),
    countPaymentAttempts(),
    listRecentOrders(limit),
    listRecentPaymentAttempts(limit)
  ]);

  return c.json({
    ok: true,
    mode: "paypal-live-only",
    now: nowIso(),
    totals: {
      orders: orderCount,
      paymentAttempts: paymentAttemptCount
    },
    orders,
    attempts
  });
});

app.get("/api/v1/admin/tables", async (c) =>
  c.json({
    ok: true,
    tables: await listAdminTables()
  })
);

app.get("/api/v1/admin/tables/:tableName/rows", async (c) => {
  const tableName = c.req.param("tableName") as AdminTableName;
  const page = Number(c.req.query("page") ?? "1");
  const pageSize = Number(c.req.query("pageSize") ?? "20");
  const table = await listAdminTableRows(tableName, page, pageSize);

  if (!table) {
    return c.json({ message: "Admin table not found." }, 404);
  }

  return c.json({ ok: true, ...table });
});

app.patch("/api/v1/admin/tables/:tableName/rows/:rowId", async (c) => {
  const tableName = c.req.param("tableName") as AdminTableName;
  const rowId = c.req.param("rowId");
  const body = (await c.req.json()) as { values?: Record<string, unknown> };
  const row = await updateAdminTableRow(tableName, rowId, body.values ?? {});

  if (!row) {
    return c.json({ message: "Admin table row not found or no editable values were provided." }, 404);
  }

  return c.json({ ok: true, table: tableName, row });
});

app.post("/api/v1/donations/intents", (c) =>
  c.json({ message: "Removed. Use POST /api/v1/orders." }, 410)
);

app.post("/api/v1/donations/intents/:intentId/checkout", (c) =>
  c.json({ message: "Removed. Use POST /api/v1/orders/:orderId/payment-attempts/paypal." }, 410)
);

app.get("/api/v1/donations/attempts/:attemptId", (c) =>
  c.json({ message: "Removed. Use GET /api/v1/payment-attempts/:attemptId." }, 410)
);

app.notFound((c) => c.json({ message: "Not found" }, 404));

export default app;
