import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { completePortOneAttempt } from "../lib/payment-client";

type PortOneRedirectPageProps = {
  apiBaseUrl: string;
};

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

export function PortOneRedirectPage({ apiBaseUrl }: PortOneRedirectPageProps) {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [message, setMessage] = useState("PortOne payment is being verified...");

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const orderId = params.get("orderId")?.trim() ?? "";
      const attemptId = params.get("attemptId")?.trim() ?? "";
      const paymentId = params.get("paymentId")?.trim() ?? undefined;
      const errorCode = params.get("code")?.trim() ?? undefined;
      const errorMessage = params.get("message")?.trim() ?? undefined;
      const pgCode = params.get("pgCode")?.trim() ?? undefined;
      const pgMessage = params.get("pgMessage")?.trim() ?? undefined;

      if (!orderId || !attemptId) {
        navigate(buildCancelPath("portone", "missing_redirect_context"), { replace: true });
        return;
      }

      try {
        const completion = await completePortOneAttempt(apiBaseUrl, orderId, attemptId, {
          paymentId,
          errorCode,
          errorMessage,
          pgCode,
          pgMessage
        });

        if (cancelled) {
          return;
        }

        if (completion.attemptStatus === "CAPTURED") {
          navigate(
            buildSuccessPath({
              amount: completion.amount,
              captureId: completion.captureId,
              currency: completion.currency,
              provider: "portone",
              receiptUrl: completion.receiptUrl
            }),
            { replace: true }
          );
          return;
        }

        navigate(buildCancelPath("portone", completion.paymentStatus.toLowerCase()), { replace: true });
      } catch (error) {
        if (cancelled) {
          return;
        }

        setMessage(error instanceof Error ? error.message : "PortOne payment verification failed.");
        navigate(buildCancelPath("portone", "verification_failed"), { replace: true });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [apiBaseUrl, navigate, params]);

  return (
    <main className="w-full max-w-md px-6 py-16 flex flex-col items-center justify-center mx-auto text-center">
      <div className="mb-6 h-16 w-16 rounded-full border-4 border-primary/20 border-t-primary animate-spin" />
      <h1 className="font-headline text-3xl font-extrabold tracking-tight text-on-background">Verifying payment</h1>
      <p className="mt-4 text-sm leading-relaxed text-on-surface-variant">{message}</p>
    </main>
  );
}
