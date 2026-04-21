export type Locale = "ko" | "en";

export type Copy = {
  brand: string;
  handle: string;
  headline: string;
  subcopy: string;
  enterAmount: string;
  amountPresets: number[];
  currency: string;
  supporterNameLabel: string;
  supporterNamePlaceholder: string;
  noteLabel: string;
  notePlaceholder: string;
  primaryAction: string;
  helper: string;
  receiptTitle: string;
  successTitle: string;
  successBody: string;
  successDone: string;
  successReceipt: string;
  cancelTitle: string;
  cancelBody: string;
  retry: string;
  backHome: string;
};

export const copy: Record<Locale, Copy> = {
  ko: {
    brand: "Pay to Minwoo",
    handle: "김민우에게 보내기",
    headline: "민우에게 바로 보내는 도네이션",
    subcopy: "Vercel의 Node 결제 코어가 주문을 만들고 PayPal hosted checkout으로 USD 결제 승인과 capture를 처리합니다.",
    enterAmount: "금액 입력",
    amountPresets: [5, 10, 50],
    currency: "USD",
    supporterNameLabel: "보내는 사람 이름",
    supporterNamePlaceholder: "익명도 가능하지만 이름을 남겨도 됩니다",
    noteLabel: "메시지",
    notePlaceholder: "민우에게 남길 짧은 메모를 적어주세요",
    primaryAction: "PayPal로 결제하기",
    helper: "주문, 결제 시도, PayPal 이벤트, 정산 기록, 원장 기록을 backend에서 분리해 저장합니다.",
    receiptTitle: "처리 요약",
    successTitle: "전송되었습니다",
    successBody: "PayPal 승인 후 서버에서 capture가 완료되었습니다.",
    successDone: "완료",
    successReceipt: "영수증 보기",
    cancelTitle: "결제가 실패했습니다",
    cancelBody: "결제가 승인 또는 capture되지 않았습니다.",
    retry: "다시 시도",
    backHome: "처음으로"
  },
  en: {
    brand: "Pay to Minwoo",
    handle: "Send directly to Minwoo Kim",
    headline: "A direct PayPal donation flow for Minwoo",
    subcopy: "The Vercel Node payment core creates an order and uses PayPal hosted checkout for real approval and capture.",
    enterAmount: "Enter amount",
    amountPresets: [10, 50, 100],
    currency: "USD",
    supporterNameLabel: "Supporter name",
    supporterNamePlaceholder: "Optional, but useful when you want Minwoo to know who sent it",
    noteLabel: "Message",
    notePlaceholder: "Leave a short note for Minwoo",
    primaryAction: "Pay with PayPal",
    helper: "The backend stores orders, payment attempts, provider events, settlement records, and ledger entries separately.",
    receiptTitle: "Processing summary",
    successTitle: "Payment captured",
    successBody: "PayPal approval returned to the server and capture completed.",
    successDone: "Done",
    successReceipt: "View receipt",
    cancelTitle: "Payment failed",
    cancelBody: "The payment was not approved or captured.",
    retry: "Try again",
    backHome: "Back home"
  }
};
