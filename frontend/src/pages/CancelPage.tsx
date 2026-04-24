import { Link, useSearchParams } from "react-router-dom";
import type { Copy } from "../lib/content";

type CancelPageProps = {
  copy: Copy;
};

function providerLabel(provider: string) {
  if (provider === "portone") {
    return "PortOne / KG Inicis test";
  }

  return "PayPal";
}

export function CancelPage({ copy }: CancelPageProps) {
  const [params] = useSearchParams();
  const provider = params.get("provider") ?? "paypal";
  const reason = params.get("reason") ?? "unknown";

  return (
    <main className="w-full max-w-md px-6 py-12 flex flex-col items-center mx-auto">
      <div className="mb-10 relative">
        <div className="absolute inset-0 bg-error/5 blur-3xl rounded-full scale-150" />
        <div className="relative bg-surface-container-lowest h-24 w-24 rounded-full flex items-center justify-center shadow-[0_12px_40px_rgba(220,38,38,0.1)] border border-error/10">
          <span className="material-symbols-outlined text-error text-5xl" style={{ fontVariationSettings: "'FILL' 1" }}>error</span>
        </div>
      </div>

      <div className="text-center mb-10">
        <h1 className="font-headline text-on-surface text-[2rem] font-extrabold tracking-tight mb-3">{copy.cancelTitle}</h1>
        <p className="text-sm uppercase tracking-[0.2em] font-semibold text-on-surface-variant">{providerLabel(provider)}</p>
      </div>

      <div className="w-full space-y-3">
        <div className="bg-error-container/20 rounded-[1.5rem] p-5 flex items-start gap-4 border border-error/10">
          <div className="text-error mt-0.5">
            <span className="material-symbols-outlined text-[20px]">info</span>
          </div>
          <div className="text-sm font-body text-on-surface-variant leading-snug">
            <span className="font-semibold text-on-surface">{copy.cancelBody}</span> reason: {reason}
          </div>
        </div>
      </div>

      <div className="w-full mt-10 flex flex-col gap-3">
        <Link className="signature-gradient text-on-primary font-headline font-bold py-4 rounded-full w-full shadow-lg shadow-primary/20 transition-all duration-300 active:scale-[0.98] text-center no-underline" to="/">
          {copy.retry}
        </Link>
        <Link className="bg-secondary-container text-on-secondary-container font-headline font-bold py-4 rounded-full w-full transition-all duration-300 active:scale-[0.98] border border-outline-variant/50 text-center no-underline" to="/">
          {copy.backHome}
        </Link>
      </div>
    </main>
  );
}
