# 결제 전략

## 목표

- 한국 사용자에게 국내 결제를 받는다.
- 해외 사용자에게 해외 결제를 받는다.
- 정산은 가능한 한 한국 계좌 기준으로 시작한다.
- 토이 프로젝트로 먼저 열고, 나중에 실서비스로 키운다.

## 추천 순서

### 추천안 A

- 국내: 토스페이먼츠
- 해외: PayPal
- 선택적 확장: PortOne 또는 Stripe

이 조합은 가장 현실적인 출발점이다.

- 국내 결제는 한국 사용자 경험에 맞춘다.
- 해외는 PayPal 링크 또는 체크아웃으로 빨리 붙일 수 있다.
- 서버는 결제사별 상태를 한 테이블 모델로 통합한다.

### 추천안 B

- 국내: 토스페이먼츠
- 해외: Stripe

이 조합은 구독, 링크 결제, 글로벌 카드 UX를 더 깔끔하게 만들 수 있다. 다만 실제 정산 계좌, 사업자 국가, 온보딩 가능 업종은 Stripe 쪽에서 사전 확인이 더 필요하다.

### 추천안 C

- PortOne + 국내 PG + 해외 PG

PG가 여러 개가 되거나 나중에 교체 가능성을 줄이고 싶을 때 쓴다. 첫 버전부터 넣으면 복잡도가 조금 더 올라간다.

## 서버에서 반드시 분리할 것

- 주문 생성
- 결제 시도 생성
- 승인 완료
- 실패
- 취소/환불
- 차지백/분쟁
- 웹훅 재처리

## 최소 데이터 모델

### payments

- `id`
- `provider`
- `provider_payment_id`
- `region`
- `status`
- `amount`
- `currency`
- `customer_email`
- `customer_name`
- `item_name`
- `created_at`
- `updated_at`

### payment_events

- `id`
- `payment_id`
- `provider`
- `event_type`
- `raw_payload`
- `received_at`

## 운영 포인트

- 결제 성공은 프론트 리다이렉트가 아니라 웹훅으로 최종 확정한다.
- 환불 가능 기간과 차지백 대응 자료를 분리 저장한다.
- 해외 결제는 통화가 다르면 금액 minor unit 처리를 명확히 한다.
- 정기결제를 붙일 거면 첫 버전부터 `customer`와 `billing agreement` 개념을 분리한다.
