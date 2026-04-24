export type Locale = "ko" | "en";

export type Copy = {
  brand: string;
  handle: string;
  headline: string;
  subcopy: string;
  enterAmount: string;
  notePlaceholder: string;
  domesticModeLabel: string;
  internationalModeLabel: string;
  domesticAmountPresets: number[];
  internationalAmountPresets: number[];
  domesticCurrency: string;
  internationalCurrency: string;
  domesticCardAction: string;
  domesticTransferAction: string;
  paypalAction: string;
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
    headline: "민우에게 보내는 결제 코어",
    subcopy: "해외는 PayPal hosted checkout, 국내 테스트는 PortOne + KG이니시스 채널로 분리해 실제 결제 도메인을 다룹니다.",
    enterAmount: "금액 입력",
    notePlaceholder: "민우에게 남길 짧은 메모를 적어주세요",
    domesticModeLabel: "국내 테스트",
    internationalModeLabel: "해외 PayPal",
    domesticAmountPresets: [10000, 30000, 50000],
    internationalAmountPresets: [10, 30, 50],
    domesticCurrency: "KRW",
    internationalCurrency: "USD",
    domesticCardAction: "국내 카드 테스트 결제",
    domesticTransferAction: "국내 계좌이체 테스트 결제",
    paypalAction: "PayPal로 결제하기",
    helper: "주문, 결제 시도, provider event, settlement, ledger를 분리해서 저장합니다.",
    receiptTitle: "처리 요약",
    successTitle: "전송되었습니다",
    successBody: "결제 승인 후 서버 검증까지 완료되었습니다.",
    successDone: "완료",
    successReceipt: "영수증 보기",
    cancelTitle: "결제가 실패했습니다",
    cancelBody: "결제가 승인되지 않았거나 서버 검증에 실패했습니다.",
    retry: "다시 시도",
    backHome: "처음으로"
  },
  en: {
    brand: "Pay to Minwoo",
    handle: "Send directly to Minwoo Kim",
    headline: "Payment core for Minwoo",
    subcopy: "International checkout uses PayPal, while domestic test checkout can be routed through PortOne-backed PG channels in preview environments.",
    enterAmount: "Enter amount",
    notePlaceholder: "Leave a short note for Minwoo",
    domesticModeLabel: "Domestic test",
    internationalModeLabel: "International PayPal",
    domesticAmountPresets: [10000, 30000, 50000],
    internationalAmountPresets: [10, 50, 100],
    domesticCurrency: "KRW",
    internationalCurrency: "USD",
    domesticCardAction: "Test domestic card",
    domesticTransferAction: "Test account transfer",
    paypalAction: "Pay with PayPal",
    helper: "The backend stores orders, attempts, provider events, settlements, and ledger entries separately.",
    receiptTitle: "Processing summary",
    successTitle: "Payment verified",
    successBody: "Approval completed and the server verified the provider payment.",
    successDone: "Done",
    successReceipt: "View receipt",
    cancelTitle: "Payment failed",
    cancelBody: "The payment was not approved or server verification did not complete.",
    retry: "Try again",
    backHome: "Back home"
  }
};
