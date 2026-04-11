import { Hono, type Context } from "hono";
import { z } from "zod";
import type { AppBindings } from "./lib/bindings.js";
import {
  getAppName,
  getMockWebhookSecret,
  getPaymentMode,
  getPayPalCredentials,
  getPublicBaseUrl,
  getStorageBackend
} from "./lib/config.js";
import { createEntityId, type MockAction, type ProviderEventType } from "./lib/domain.js";
import { AppError, asAppError } from "./lib/errors.js";
import { verifyMockWebhook } from "./lib/mock-provider.js";
import {
  buildPayPalWebhookHeaders,
  capturePayPalOrder,
  createPayPalOrder,
  extractPayPalAttemptId,
  extractPayPalOrderId,
  getPayPalApprovalUrl,
  mapPayPalWebhookEventToDomainType,
  verifyPayPalWebhook
} from "./lib/paypal.js";
import { PaymentLabService } from "./lib/payment-lab-service.js";
import { getPaymentLabRepository } from "./lib/repositories/index.js";

const app = new Hono<{ Bindings: AppBindings }>();

type AppContext = Context<{ Bindings: AppBindings }>;
type Locale = "ko" | "en";

const createIntentSchema = z.object({
  amount: z.coerce.number().int().positive().max(1000000000),
  currency: z.string().trim().length(3),
  customerEmail: z.string().email(),
  customerName: z.string().trim().min(1).max(80),
  itemName: z.string().trim().min(1).max(120),
  note: z.string().trim().max(400).optional(),
  idempotencyKey: z.string().trim().max(120).optional(),
  region: z.enum(["domestic", "international"])
});

const checkoutSchema = z.object({
  idempotencyKey: z.string().trim().max(120).optional()
});

const paypalOrderSchema = z.object({
  idempotencyKey: z.string().trim().max(120).optional()
});

const paypalCaptureSchema = z.object({
  requestId: z.string().trim().max(120).optional()
});

const mockActionSchema = z.enum(["authorize", "capture", "fail", "refund", "dispute"]);

const webhookSchema = z.object({
  attemptId: z.string().trim().min(1),
  type: z.enum([
    "payment.authorized",
    "payment.captured",
    "payment.failed",
    "payment.refunded",
    "payment.disputed"
  ])
});

const copy = {
  ko: {
    rootMessage: "이 프로젝트는 UI가 아니라 결제 코어를 학습하기 위한 API 서버입니다.",
    htmlRemoved: "HTML 화면은 제거되었습니다. 브라우저 언어는 Accept-Language 기준으로만 감지합니다.",
    returnMessage: "PayPal 승인 이후 서버가 capture를 시도한 결과입니다.",
    cancelMessage: "PayPal checkout이 취소되었습니다. 시도는 유지되며 다시 주문을 만들 수 있습니다.",
    removedRoute: "이 HTML mock route는 제거되었습니다. API만 사용하세요.",
    process: [
      "1. /api/lab/intents 로 DonationIntent를 만든다.",
      "2. /api/paypal/intents/:intentId/order 로 PayPal 주문을 만든다.",
      "3. 응답의 paypal.approveUrl 로 PayPal hosted checkout 에 이동한다.",
      "4. PayPal 이 /paypal/return 으로 돌아오면 서버가 capture 를 시도한다.",
      "5. /api/webhooks/paypal 이 서명 검증 후 최종 상태를 반영한다.",
      "6. /api/lab/attempts/:attemptId 와 /api/lab/snapshot 으로 상태를 확인한다."
    ]
  },
  en: {
    rootMessage: "This project is an API-first payment core for learning payment domain design, not a web UI.",
    htmlRemoved: "HTML screens were removed. Browser language is inferred only from Accept-Language.",
    returnMessage: "This is the server-side capture result after PayPal approval.",
    cancelMessage: "The PayPal checkout was canceled. The attempt remains and you can create a new order.",
    removedRoute: "This HTML mock route was removed. Use the API only.",
    process: [
      "1. Create a DonationIntent with /api/lab/intents.",
      "2. Create a PayPal order with /api/paypal/intents/:intentId/order.",
      "3. Open paypal.approveUrl for the PayPal-hosted checkout.",
      "4. When PayPal returns to /paypal/return, the server attempts capture.",
      "5. /api/webhooks/paypal verifies the signature and applies the final state.",
      "6. Inspect state with /api/lab/attempts/:attemptId and /api/lab/snapshot."
    ]
  }
} satisfies Record<Locale, {
  rootMessage: string;
  htmlRemoved: string;
  returnMessage: string;
  cancelMessage: string;
  removedRoute: string;
  process: string[];
}>;

function detectLocale(c: AppContext): Locale {
  const header = c.req.header("accept-language")?.toLowerCase() || "";
  return /(^|,|;)\s*ko\b/.test(header) ? "ko" : "en";
}

function createPaymentLab(c: AppContext) {
  return new PaymentLabService(getPaymentLabRepository(c.env), getPublicBaseUrl(c.env));
}

function invalidRequest(c: AppContext, error: z.ZodError) {
  return c.json(
    {
      ok: false,
      error: "INVALID_REQUEST",
      details: error.flatten()
    },
    400
  );
}

function respondWithAppError(c: AppContext, error: unknown) {
  const appError = asAppError(error);
  return c.json(
    {
      ok: false,
      error: appError.code,
      message: appError.message,
      details: appError.details
    },
    appError.status as 400
  );
}

async function capturePayPalAttempt(c: AppContext, attemptId: string, requestId?: string) {
  const credentials = getPayPalCredentials(c.env);
  const lab = createPaymentLab(c);
  const detail = await lab.getAttempt(attemptId);

  if (detail.attempt.provider !== "paypal") {
    throw new AppError("INVALID_PROVIDER", "Capture endpoint only supports PayPal attempts.", 400);
  }

  const capture = await capturePayPalOrder(credentials, detail.attempt.providerPaymentId, requestId);
  const result = await lab.ingestProviderEvent({
    attemptId: detail.attempt.id,
    type: "payment.captured",
    source: "api",
    payload: {
      ...capture,
      providerEventType: "PAYMENT.CAPTURE.COMPLETED"
    },
    signatureVerified: true,
    providerEventId: typeof capture.id === "string" ? capture.id : undefined
  });

  return {
    capture,
    result,
    detail: await lab.getAttempt(detail.attempt.id)
  };
}

app.get("/", (c) => {
  const locale = detectLocale(c);
  const messages = copy[locale];

  return c.json({
    ok: true,
    service: getAppName(c.env),
    locale,
    mode: getPaymentMode(c.env),
    storage: getStorageBackend(c.env),
    canonicalBaseUrl: getPublicBaseUrl(c.env),
    hosting: {
      primary: "vercel",
      secondary: "netlify"
    },
    domains: [
      "DonationIntent",
      "PaymentAttempt",
      "ProviderEvent",
      "AuditLog",
      "IdempotencyRecord",
      "SettlementRecord",
      "LedgerEntry"
    ],
    message: messages.rootMessage,
    note: messages.htmlRemoved,
    acceptLanguage: c.req.header("accept-language") || null,
    process: messages.process,
    endpoints: {
      health: "/api/health",
      snapshot: "/api/lab/snapshot",
      createIntent: "/api/lab/intents",
      createPayPalOrder: "/api/paypal/intents/:intentId/order",
      capturePayPalAttempt: "/api/paypal/attempts/:attemptId/capture",
      paypalWebhook: "/api/webhooks/paypal"
    }
  });
});

app.get("/demo/checkout/:attemptId", (c) => {
  const locale = detectLocale(c);
  return c.json(
    {
      ok: false,
      removed: true,
      route: "/demo/checkout/:attemptId",
      attemptId: c.req.param("attemptId"),
      locale,
      message: copy[locale].removedRoute
    },
    410
  );
});

app.get("/paypal/return", async (c) => {
  const locale = detectLocale(c);
  const attemptId = c.req.query("attemptId")?.trim() || "";
  const token = c.req.query("token")?.trim() || "";

  if (!attemptId) {
    return c.json(
      {
        ok: false,
        error: "ATTEMPT_ID_MISSING",
        locale,
        message: "attemptId is required in the return URL.",
        token: token || null
      },
      400
    );
  }

  try {
    const captured = await capturePayPalAttempt(c, attemptId);
    return c.json({
      ok: true,
      locale,
      message: copy[locale].returnMessage,
      attemptId,
      token: token || null,
      ...captured.result,
      paypal: captured.capture,
      detail: captured.detail
    });
  } catch (error) {
    return respondWithAppError(c, error);
  }
});

app.get("/paypal/cancel", (c) => {
  const locale = detectLocale(c);
  const attemptId = c.req.query("attemptId")?.trim() || "";

  return c.json({
    ok: true,
    canceled: true,
    locale,
    attemptId: attemptId || null,
    message: copy[locale].cancelMessage
  });
});

app.get("/api/health", (c) => {
  return c.json({
    ok: true,
    service: getAppName(c.env),
    mode: getPaymentMode(c.env),
    storage: getStorageBackend(c.env),
    now: new Date().toISOString()
  });
});

app.get("/api/lab/snapshot", async (c) => {
  const lab = createPaymentLab(c);
  return c.json({
    ok: true,
    snapshot: await lab.getSnapshot()
  });
});

app.post("/api/lab/reset", async (c) => {
  const lab = createPaymentLab(c);
  await lab.reset();
  return c.json({
    ok: true,
    snapshot: await lab.getSnapshot()
  });
});

app.post("/api/lab/intents", async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = createIntentSchema.safeParse(body);

  if (!parsed.success) {
    return invalidRequest(c, parsed.error);
  }

  try {
    const lab = createPaymentLab(c);
    const result = await lab.createIntent(parsed.data);
    return c.json(
      {
        ok: true,
        ...result,
        snapshot: await lab.getSnapshot()
      },
      result.replayed ? 200 : 201
    );
  } catch (error) {
    return respondWithAppError(c, error);
  }
});

app.get("/api/lab/intents/:intentId", async (c) => {
  const lab = createPaymentLab(c);

  try {
    return c.json({
      ok: true,
      intent: await lab.getIntent(c.req.param("intentId"))
    });
  } catch (error) {
    return respondWithAppError(c, error);
  }
});

app.post("/api/lab/intents/:intentId/checkout", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const parsed = checkoutSchema.safeParse(body);

  if (!parsed.success) {
    return invalidRequest(c, parsed.error);
  }

  try {
    const lab = createPaymentLab(c);
    const result = await lab.startCheckout(c.req.param("intentId"), parsed.data.idempotencyKey);
    return c.json(
      {
        ok: true,
        ...result,
        snapshot: await lab.getSnapshot()
      },
      result.replayed ? 200 : 201
    );
  } catch (error) {
    return respondWithAppError(c, error);
  }
});

app.post("/api/paypal/intents/:intentId/order", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const parsed = paypalOrderSchema.safeParse(body);

  if (!parsed.success) {
    return invalidRequest(c, parsed.error);
  }

  try {
    const credentials = getPayPalCredentials(c.env);
    const lab = createPaymentLab(c);
    const intent = await lab.getIntent(c.req.param("intentId"));
    const attemptId = createEntityId("attempt");
    const publicBaseUrl = getPublicBaseUrl(c.env);
    const order = await createPayPalOrder(credentials, {
      amount: intent.money.amount,
      currency: intent.money.currency,
      itemName: intent.itemName,
      intentId: intent.id,
      attemptId,
      requestId: parsed.data.idempotencyKey,
      returnUrl: `${publicBaseUrl}/paypal/return?attemptId=${attemptId}`,
      cancelUrl: `${publicBaseUrl}/paypal/cancel?attemptId=${attemptId}`
    });
    const approveUrl = getPayPalApprovalUrl(order);
    const result = await lab.startExternalCheckout({
      intentId: intent.id,
      provider: "paypal",
      attemptId,
      providerPaymentId: order.id,
      checkoutUrl: approveUrl,
      payload: {
        id: order.id,
        status: order.status,
        links: order.links,
        eventId: order.id,
        providerEventType: "PAYPAL.ORDER.CREATED"
      },
      idempotencyKey: parsed.data.idempotencyKey,
      source: "api",
      signatureVerified: true
    });

    return c.json(
      {
        ok: true,
        ...result,
        paypal: {
          orderId: order.id,
          status: order.status,
          approveUrl,
          links: order.links
        }
      },
      result.replayed ? 200 : 201
    );
  } catch (error) {
    return respondWithAppError(c, error);
  }
});

app.post("/api/paypal/attempts/:attemptId/capture", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const parsed = paypalCaptureSchema.safeParse(body);

  if (!parsed.success) {
    return invalidRequest(c, parsed.error);
  }

  try {
    const captured = await capturePayPalAttempt(c, c.req.param("attemptId"), parsed.data.requestId);
    return c.json({
      ok: true,
      ...captured.result,
      paypal: captured.capture,
      detail: captured.detail
    });
  } catch (error) {
    return respondWithAppError(c, error);
  }
});

app.get("/api/lab/attempts/:attemptId", async (c) => {
  const lab = createPaymentLab(c);

  try {
    return c.json({
      ok: true,
      ...await lab.getAttempt(c.req.param("attemptId"))
    });
  } catch (error) {
    return respondWithAppError(c, error);
  }
});

app.get("/api/lab/settlements/:settlementId", async (c) => {
  const lab = createPaymentLab(c);

  try {
    return c.json({
      ok: true,
      settlement: await lab.getSettlement(c.req.param("settlementId"))
    });
  } catch (error) {
    return respondWithAppError(c, error);
  }
});

app.post("/api/lab/settlements/:settlementId/actions/payout", async (c) => {
  const lab = createPaymentLab(c);

  try {
    const result = await lab.markSettlementPaidOut(c.req.param("settlementId"));
    return c.json({
      ok: true,
      ...result,
      settlementDetail: await lab.getSettlement(c.req.param("settlementId"))
    });
  } catch (error) {
    return respondWithAppError(c, error);
  }
});

app.post("/api/lab/attempts/:attemptId/actions/:action", async (c) => {
  const actionResult = mockActionSchema.safeParse(c.req.param("action"));

  if (!actionResult.success) {
    return invalidRequest(c, actionResult.error);
  }

  try {
    const lab = createPaymentLab(c);
    const result = await lab.applyAction(c.req.param("attemptId"), actionResult.data as MockAction);
    return c.json({
      ok: true,
      ...result,
      detail: await lab.getAttempt(c.req.param("attemptId"))
    });
  } catch (error) {
    return respondWithAppError(c, error);
  }
});

app.post("/api/webhooks/mock", async (c) => {
  const rawBody = await c.req.text();
  const signature = c.req.header("x-mock-signature")?.trim() || "";
  const isVerified = await verifyMockWebhook(getMockWebhookSecret(c.env), rawBody, signature);

  if (!isVerified) {
    return c.json(
      {
        ok: false,
        error: "INVALID_WEBHOOK_SIGNATURE",
        message: "Mock webhook signature verification failed."
      },
      401
    );
  }

  let body: unknown;

  try {
    body = JSON.parse(rawBody);
  } catch {
    return c.json(
      {
        ok: false,
        error: "INVALID_JSON",
        message: "Webhook body must be valid JSON."
      },
      400
    );
  }

  const parsed = webhookSchema.safeParse(body);

  if (!parsed.success) {
    return invalidRequest(c, parsed.error);
  }

  try {
    const lab = createPaymentLab(c);
    const result = await lab.ingestWebhook(parsed.data as { attemptId: string; type: ProviderEventType });
    return c.json({
      ok: true,
      ...result,
      detail: await lab.getAttempt(parsed.data.attemptId)
    });
  } catch (error) {
    return respondWithAppError(c, error);
  }
});

app.post("/api/webhooks/paypal", async (c) => {
  const rawBody = await c.req.text();
  let body: Record<string, unknown>;

  try {
    body = JSON.parse(rawBody) as Record<string, unknown>;
  } catch {
    return c.json(
      {
        ok: false,
        error: "INVALID_JSON",
        message: "Webhook body must be valid JSON."
      },
      400
    );
  }

  try {
    const credentials = getPayPalCredentials(c.env);
    const verified = await verifyPayPalWebhook(credentials, buildPayPalWebhookHeaders(c.req.raw.headers), body);

    if (!verified) {
      return c.json(
        {
          ok: false,
          error: "INVALID_WEBHOOK_SIGNATURE",
          message: "PayPal webhook signature verification failed."
        },
        401
      );
    }

    const eventType = typeof body.event_type === "string" ? body.event_type : "";
    const mappedType = mapPayPalWebhookEventToDomainType(eventType);

    if (!mappedType) {
      return c.json(
        {
          ok: true,
          ignored: true,
          eventType,
          reason: "unsupported_event"
        },
        202
      );
    }

    const lab = createPaymentLab(c);
    let attemptId = extractPayPalAttemptId(body);

    if (!attemptId) {
      const orderId = extractPayPalOrderId(body);

      if (orderId) {
        attemptId = (await lab.findAttemptByProviderPaymentId("paypal", orderId).catch(() => undefined))?.id;
      }
    }

    if (!attemptId) {
      return c.json(
        {
          ok: true,
          ignored: true,
          eventType,
          reason: "attempt_not_found"
        },
        202
      );
    }

    const result = await lab.ingestProviderEvent({
      attemptId,
      type: mappedType,
      source: "webhook",
      payload: body,
      signatureVerified: true,
      providerEventId: typeof body.id === "string" ? body.id : undefined
    });

    return c.json({
      ok: true,
      eventType,
      mappedType,
      attemptId,
      ...result,
      detail: await lab.getAttempt(attemptId)
    });
  } catch (error) {
    return respondWithAppError(c, error);
  }
});

export default app;
