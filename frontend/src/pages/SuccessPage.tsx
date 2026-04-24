import { Link, useSearchParams } from "react-router-dom";
import type { Copy } from "../lib/content";

type SuccessPageProps = {
  copy: Copy;
};

function formatAmount(currency: string, rawAmount: string) {
  const amount = Number(rawAmount || 0);
  if (currency === "KRW") {
    return amount.toLocaleString("ko-KR");
  }

  return amount.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

function providerLabel(provider: string) {
  if (provider === "portone") {
    return "PortOne / KG Inicis test";
  }

  return "PayPal";
}

export function SuccessPage({ copy }: SuccessPageProps) {
  const [params] = useSearchParams();
  const amount = params.get("amount") ?? "0";
  const currency = params.get("currency") ?? "USD";
  const provider = params.get("provider") ?? "paypal";
  const receiptUrl = params.get("receiptUrl") ?? "";

  return (
    <>
      <main className="relative w-full max-w-md px-8 py-12 flex flex-col items-center text-center mx-auto">
        <div className="relative mb-12">
          <div className="absolute -z-10 top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-64 h-64 bg-primary-container opacity-40 rounded-full blur-3xl" />
          <div className="w-32 h-32 signature-gradient rounded-full flex items-center justify-center shadow-[0_20px_50px_rgba(24,73,229,0.2)]">
            <span className="material-symbols-outlined text-white text-6xl" style={{ fontVariationSettings: "'FILL' 0, 'wght' 700" }}>check</span>
          </div>
        </div>

        <div className="space-y-4 mb-10">
          <h2 className="font-headline font-extrabold text-4xl tracking-tight text-on-background">{copy.successTitle}</h2>
          <p className="text-sm uppercase tracking-[0.2em] font-semibold text-on-surface-variant">{providerLabel(provider)}</p>
        </div>

        <div className="w-full mb-12">
          <div className="bg-surface-container p-6 rounded-[1.5rem] text-center">
            <p className="text-on-surface-variant text-xs uppercase tracking-widest font-semibold mb-2">Total Amount</p>
            <div className="flex items-center justify-center gap-1">
              <span className="text-primary font-headline font-extrabold text-3xl">{currency === "KRW" ? "₩" : "$"}</span>
              <span className="text-on-background font-headline font-extrabold text-4xl">{formatAmount(currency, amount)}</span>
              <span className="text-on-surface-variant font-headline font-medium text-lg ml-1">{currency}</span>
            </div>
          </div>
        </div>

        <div className="w-full space-y-4">
          <Link className="block w-full py-5 signature-gradient text-white font-headline font-bold rounded-full text-lg shadow-xl hover:shadow-2xl transition-all duration-300 active:scale-95 no-underline text-center" to="/">
            {copy.successDone}
          </Link>
          {receiptUrl ? (
            <a className="w-full py-5 bg-secondary-container text-on-secondary-container font-headline font-bold rounded-xl text-lg hover:bg-secondary-fixed-dim transition-all duration-300 active:scale-95 flex items-center justify-center gap-2 no-underline" href={receiptUrl} rel="noreferrer" target="_blank">
              <span className="material-symbols-outlined">receipt_long</span>
              {copy.successReceipt}
            </a>
          ) : (
            <button className="w-full py-5 bg-secondary-container/60 text-on-secondary-container/70 font-headline font-bold rounded-xl text-lg flex items-center justify-center gap-2 cursor-not-allowed" disabled type="button">
              <span className="material-symbols-outlined">receipt_long</span>
              {copy.successReceipt}
            </button>
          )}
        </div>
      </main>

      <div className="fixed inset-0 -z-20 opacity-30 pointer-events-none">
        <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-primary-container rounded-full blur-[120px] -translate-y-1/2 translate-x-1/3" />
        <div className="absolute bottom-0 left-0 w-[500px] h-[500px] bg-tertiary-container rounded-full blur-[120px] translate-y-1/2 -translate-x-1/3" />
      </div>
    </>
  );
}
