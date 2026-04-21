import { requestPayment } from "@portone/browser-sdk/v2";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { Copy, Locale } from "../lib/content";
import {
  completePortOneAttempt,
  createPayPalCheckout,
  createPortOneCheckout,
  type DomesticPayMethod
} from "../lib/payment-client";

type HomePageProps = {
  copy: Copy;
  locale: Locale;
  apiBaseUrl: string;
  domesticTestEnabled: boolean;
};

type CheckoutLane = "international" | "domestic-card" | "domestic-transfer";

function symbolFor(currency: string) {
  return currency === "KRW" ? "₩" : "$";
}

function formatPreset(locale: Locale, currency: string, amount: number) {
  const formatted = amount.toLocaleString(locale === "ko" ? "ko-KR" : "en-US");
  return `${symbolFor(currency)}${formatted}`;
}

function laneToPayMethod(lane: CheckoutLane): DomesticPayMethod | null {
  if (lane === "domestic-card") {
    return "CARD";
  }

  if (lane === "domestic-transfer") {
    return "TRANSFER";
  }

  return null;
}

function buildSuccessPath(input: {
  amount: string;
  captureId: string | null;
  currency: string;
  provider: string;
  receiptUrl: string | null;
}) {
  const params = new URLSearchParams({
    amount: input.amount,
    currency: input.currency,
    provider: input.provider
  });

  if (input.captureId) {
    params.set("captureId", input.captureId);
  }

  if (input.receiptUrl) {
    params.set("receiptUrl", input.receiptUrl);
  }

  return `/success?${params.toString()}`;
}

function buildCancelPath(provider: string, reason: string) {
  const params = new URLSearchParams({ provider, reason });
  return `/cancel?${params.toString()}`;
}

export function HomePage({ copy, locale, apiBaseUrl, domesticTestEnabled }: HomePageProps) {
  const navigate = useNavigate();
  const defaultLane: CheckoutLane = domesticTestEnabled && locale === "ko" ? "domestic-card" : "international";
  const [lane, setLane] = useState<CheckoutLane>(defaultLane);
  const [amountInput, setAmountInput] = useState("");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const activeCheckout = useMemo(() => {
    if (lane === "international") {
      return {
        currency: copy.internationalCurrency,
        region: "international" as const,
        amountPresets: copy.internationalAmountPresets,
        actionLabel: copy.paypalAction
      };
    }

    return {
      currency: copy.domesticCurrency,
      region: "domestic" as const,
      amountPresets: copy.domesticAmountPresets,
      actionLabel: lane === "domestic-card" ? copy.domesticCardAction : copy.domesticTransferAction
    };
  }, [copy, lane]);

  useEffect(() => {
    setAmountInput(String(activeCheckout.amountPresets[1] ?? activeCheckout.amountPresets[0] ?? 0));
  }, [activeCheckout.amountPresets]);

  const amount = useMemo(() => {
    const digits = amountInput.replace(/[^0-9]/g, "");
    return digits.length > 0 ? Number(digits) : 0;
  }, [amountInput]);

  const amountInputWidth = useMemo(() => `${Math.max(amountInput.length + 0.6, 4.5)}ch`, [amountInput.length]);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);

    try {
      const payload = {
        amount,
        currency: activeCheckout.currency,
        note: note.trim(),
        locale,
        region: activeCheckout.region
      } as const;

      if (lane === "international") {
        const session = await createPayPalCheckout(apiBaseUrl, payload);
        window.location.assign(session.redirectUrl);
        return;
      }

      const payMethod = laneToPayMethod(lane);
      if (!payMethod) {
        throw new Error("Domestic pay method is missing.");
      }

      const session = await createPortOneCheckout(apiBaseUrl, payload, payMethod);
      const response = await requestPayment(session.paymentRequest);

      if (!response) {
        return;
      }

      const completion = await completePortOneAttempt(apiBaseUrl, session.orderId, session.attemptId, {
        paymentId: response.paymentId,
        errorCode: response.code,
        errorMessage: response.message,
        pgCode: response.pgCode,
        pgMessage: response.pgMessage
      });

      if (completion.attemptStatus === "CAPTURED") {
        navigate(
          buildSuccessPath({
            amount: completion.amount,
            captureId: completion.captureId,
            currency: completion.currency,
            provider: "portone",
            receiptUrl: completion.receiptUrl
          })
        );
        return;
      }

      navigate(buildCancelPath("portone", completion.paymentStatus.toLowerCase()));
    } catch (submitError) {
      const message = submitError instanceof Error ? submitError.message : "Unexpected checkout error.";
      setError(message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <main className="flex-1 flex flex-col items-center justify-center px-8 py-12 max-w-md mx-auto w-full">
        <div className="w-full mb-12 flex flex-col items-center">
          <div className="relative mb-6">
            <div className="absolute inset-0 signature-gradient rounded-full blur-2xl opacity-10 transform scale-150" />
            <div className="relative w-32 h-32 rounded-full overflow-hidden border border-primary/10 shadow-[0_20px_50px_rgba(24,73,229,0.12)]">
              <img
                alt="Minwoo Kim"
                className="h-full w-full object-cover object-[center_16%]"
                src="/minwoo-profile.jpg"
              />
            </div>
          </div>
          <h2 className="text-3xl font-headline font-extrabold tracking-tight text-on-surface mb-1">Pay to Minwoo</h2>
          <p className="text-center text-sm text-on-surface-variant leading-relaxed mt-3">{copy.subcopy}</p>
        </div>

        <form className="w-full" onSubmit={handleSubmit}>
          <div className="w-full mb-5 flex flex-wrap items-center justify-center gap-2">
            {domesticTestEnabled ? (
              <>
                <button
                  className={lane === "domestic-card" ? "rounded-full bg-primary-container px-4 py-2 text-sm font-semibold text-primary" : "rounded-full bg-surface-container-low px-4 py-2 text-sm font-semibold text-on-surface"}
                  type="button"
                  onClick={() => setLane("domestic-card")}
                >
                  {copy.domesticModeLabel} · CARD
                </button>
                <button
                  className={lane === "domestic-transfer" ? "rounded-full bg-primary-container px-4 py-2 text-sm font-semibold text-primary" : "rounded-full bg-surface-container-low px-4 py-2 text-sm font-semibold text-on-surface"}
                  type="button"
                  onClick={() => setLane("domestic-transfer")}
                >
                  {copy.domesticModeLabel} · TRANSFER
                </button>
              </>
            ) : null}
            <button
              className={lane === "international" ? "rounded-full bg-primary-container px-4 py-2 text-sm font-semibold text-primary" : "rounded-full bg-surface-container-low px-4 py-2 text-sm font-semibold text-on-surface"}
              type="button"
              onClick={() => setLane("international")}
            >
              {copy.internationalModeLabel}
            </button>
          </div>

          <div className="w-full bg-surface-container-lowest p-8 rounded-[2rem] shadow-[0_8px_32px_rgba(15,23,42,0.04)] mb-8 flex flex-col items-center">
            <label className="text-on-surface-variant font-label text-xs uppercase tracking-[0.2em] mb-4">{copy.enterAmount}</label>
            <div className="flex items-baseline justify-center gap-2 max-w-full overflow-visible">
              <span className="shrink-0 text-4xl font-headline font-bold text-primary">{symbolFor(activeCheckout.currency)}</span>
              <input
                className="min-w-0 max-w-full bg-transparent border-none p-0 text-6xl leading-none font-headline font-black text-on-background focus:ring-0 text-center selection:bg-primary-container/30"
                inputMode="numeric"
                style={{ width: amountInputWidth }}
                type="text"
                value={amountInput}
                onChange={(event) => setAmountInput(event.target.value.replace(/[^0-9]/g, ""))}
              />
            </div>
            <div className="mt-3 text-xs font-semibold uppercase tracking-[0.2em] text-on-surface-variant">{activeCheckout.currency}</div>
            <div className="flex gap-3 mt-8 flex-wrap justify-center">
              {activeCheckout.amountPresets.map((preset) => (
                <button
                  key={preset}
                  className={preset === amount ? "px-5 py-2 rounded-full bg-primary-container text-primary font-body text-sm font-semibold transition-all active:scale-95" : "px-5 py-2 rounded-full bg-surface-container text-on-surface font-body text-sm font-semibold transition-all active:scale-95 hover:bg-surface-container-high"}
                  type="button"
                  onClick={() => setAmountInput(String(preset))}
                >
                  {formatPreset(locale, activeCheckout.currency, preset)}
                </button>
              ))}
            </div>
          </div>

          <div className="w-full px-4 mb-6">
            <div className="flex items-center gap-3 bg-surface-container-low rounded-xl px-4 py-3 group focus-within:bg-surface-container-high transition-colors">
              <span className="material-symbols-outlined text-outline">edit_note</span>
              <input
                className="bg-transparent border-none p-0 focus:ring-0 text-on-surface-variant font-body text-sm w-full placeholder:text-outline"
                placeholder={copy.notePlaceholder}
                type="text"
                value={note}
                onChange={(event) => setNote(event.target.value)}
              />
            </div>
          </div>

          <p className="w-full px-4 mb-6 text-sm text-on-surface-variant leading-relaxed">{copy.helper}</p>

          {error ? (
            <div className="w-full mb-6 rounded-[1.5rem] bg-error-container/20 px-5 py-4 text-sm text-on-error-container border border-error/10">
              {error}
            </div>
          ) : null}

          <div className="w-full">
            <button
              className="w-full signature-gradient text-on-primary font-headline font-bold text-lg py-5 rounded-full shadow-lg shadow-primary/20 transition-all duration-300 active:scale-[0.98] hover:shadow-xl hover:shadow-primary/30 disabled:opacity-60"
              disabled={submitting || amount <= 0}
              type="submit"
            >
              {submitting ? "Processing..." : activeCheckout.actionLabel}
            </button>
          </div>
        </form>
      </main>
      <div className="fixed top-0 left-0 w-full h-px bg-slate-200 z-[60]" />
    </>
  );
}
