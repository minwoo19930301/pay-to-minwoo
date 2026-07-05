# PLAN — pay-to-minwoo → ai-ing.org 결제 백엔드 (PortOne)

## 목표

기존 `pay-to-minwoo`(Hono 결제 코어)를 재사용해서, **ai-ing.org의 실제 PG 결제 백엔드**를
서브도메인(`pay.ai-ing.org`)으로 띄운다. PayPal/사진/도네이션 프런트는 떼고, **PortOne(국내 PG)**
어댑터로 교체한다. 핵심 자산인 도메인 모델(주문·결제시도·외부이벤트·정산·원장·감사·멱등성)은 그대로 유지.

## 확정된 방향

- **호스팅:** Vercel (무료, Hono 그대로 재사용) — 코드 손맛 우선, B안
- **프레임워크:** Hono (백엔드 API 전용, 기존 `src/` 유지)
- **PG:** PortOne (KRW 네이티브 → PayPal의 USD 제약 제거)
- **프런트:** ai-ing.org(`/Users/minwokim/Documents/Codex`, Cloudflare Pages)는 그대로 두고, 결제 버튼만 백엔드 호출로 교체

## 아키텍처

```
ai-ing.org            → 마케팅/슬라이드 (Cloudflare Pages, 현행 유지)
   └ 결제 버튼 ──────▶ pay.ai-ing.org 호출
pay.ai-ing.org        → 결제 백엔드 (Hono on Vercel) ← 코드 작업 영역
   ├ POST /api/v1/orders                    주문 생성 (서버가 금액 확정 + 멱등성)
   ├ POST .../payment-attempts/portone      결제 시도 기록
   ├ POST /api/v1/payments/complete         ★ 클라 성공콜백 후 서버가 PortOne REST로 재검증
   ├ POST /api/v1/webhooks/portone          ★ webhook 백스톱 (창 닫혀도 통지 수신)
   └ GET  /api/v1/admin/dashboard           관리자 (기존 재사용)
DB (Turso 유지 또는 Postgres 전환) → orders / payment_attempts / provider_events / ledger / audit / idempotency
```

## 핵심 설계 원칙 (완벽한 결제 시스템)

1. **서버가 진실의 원천.** 브라우저의 "성공"을 믿지 않는다. 결제 확정은 반드시 서버가
   PortOne REST `GET /payments/{id}`로 `status==PAID` & 금액 일치를 직접 대조한 뒤에만.
2. **멱등성은 어디에나.** 더블클릭·네트워크 재시도·webhook 재전송에도 결제가 두 번
   기록되지 않게 — idempotency 레코드 + DB unique 제약.
3. **명시적 상태 머신.** `CREATED → PENDING → PAID/FAILED/CANCELED → REFUNDED`,
   허용된 전이만. "결제됐나?"가 절대 모호하지 않게.
4. **외부 사실은 원본 그대로 기록.** PG 응답/webhook 페이로드를 `provider_events`에
   먼저 저장한 뒤 행동. 언제든 재구성·대조·감사 가능.
5. **확정 경로 이중화.** 동기(클라 `/payments/complete`) + 비동기(webhook) 두 경로가
   같은 멱등 확정 로직으로 수렴. 창이 닫혀도 webhook이 확정.
6. **장애 격리.** 결제 하나가 실패해도 다른 결제/시스템 전체를 죽이지 않는다. (t-test 교훈)
7. **대조·정합성.** 내 기록 vs PG 기록(금액/상태)이 불일치하면 조용히 받지 말고 거절·표시.
8. **돈의 흐름을 원장으로.** 확정 결제마다 `ledger`(결제액 credit / 수수료 debit / 순액).
9. **보안.** 서버 전용 API Secret 분리, webhook 서명 검증(서명 없는 통지는 신뢰 금지).

> 4~9는 이미 pay-to-minwoo 도메인 모델에 구현돼 있음 → 이번 작업은 **PortOne을 이 골격에
> 정확히 끼우는 것** + 핵심 경로 테스트(원칙 6·7 회귀 테스트).

## 단계별 플랜

### Phase 0 — 준비
- [ ] Vercel 계정 정리 (현재 `minwoo19930301` / naver 메일 로그인), 노출된 토큰 폐기
- [ ] PortOne 콘솔에서 storeId / channelKey(카카오페이·카드) / **API Secret(서버용)** / **Webhook Secret** 확보
- [ ] `pay.ai-ing.org` 서브도메인 DNS 준비

### Phase 1 — 백엔드 정리 (PayPal/사진 제거)
- [ ] `frontend/`(Netlify React, 사진 포함) 분리/삭제 — 백엔드만 남김
- [ ] PayPal 전용 라우트/리턴/취소 핸들러 정리
- [ ] 통화 USD 강제 → KRW 기준으로 전환 (`toMinorUnits` 등 KRW 검토: KRW는 minor unit 없음)

### Phase 2 — PortOne 어댑터 구현
- [ ] `src/portone.ts` 신규 (`src/paypal.ts` 자리 대체)
  - [ ] `getPayment(paymentId)` — PortOne REST `GET /payments/{id}` 조회
  - [ ] webhook 서명 검증 함수
- [ ] 라우트 추가: `POST /api/v1/orders/:orderId/payment-attempts/portone`
- [ ] 라우트 추가: `POST /api/v1/webhooks/portone`

### Phase 3 — 서버측 검증 플로우 (제일 중요)
- [ ] `POST /api/v1/payments/complete` : 클라가 `paymentId` 전달
  - [ ] PortOne REST로 실제 결제 조회 → `amount.total` == 주문금액 & `status==PAID` 대조
  - [ ] 일치할 때만 order 상태 PAID 전환 + `provider_events` 기록 + `ledger`/`audit` 기록
  - [ ] 불일치/위조 시 거절 + 기록
- [ ] webhook 수신 시 동일 재검증 로직 재사용 (멱등 처리)

### Phase 4 — 프런트 연동 (ai-ing.org)
- [ ] `Codex/index.html` `triggerPortOnePayment`: `PortOne.requestPayment` 성공 후
      → `pay.ai-ing.org/api/v1/payments/complete` 호출 → **서버 확정 응답으로** 영수증 표시
- [ ] channelKey/storeId 하드코딩 제거, 환경값/백엔드 주입으로 정리

### Phase 5 — 테스트 (t-test 교훈 반영)
- [ ] 오케스트레이션/엣지케이스 단위테스트: 금액 불일치, 미결제, webhook 중복, 부분 실패
- [ ] "매칭 안 되는 데이터가 와도 전체가 죽지 않는다" 회귀 테스트

### Phase 6 — 배포
- [ ] Vercel 배포 + env 시크릿(PortOne API Secret/Webhook Secret/DB URL) 등록
- [ ] `pay.ai-ing.org` 도메인 연결
- [ ] PortOne 콘솔 webhook URL = `https://pay.ai-ing.org/api/v1/webhooks/portone` 등록

## 결정됨

- **서브도메인:** `pay.ai-ing.org` ✅

## 미결정 (정하면 진행)

1. **DB:** Turso 유지(마찰 최소) vs Postgres 전환(백엔드 학습량 ↑) — *추천: 일단 Turso 유지*
2. **레포 전략:** `pay-to-minwoo` 레포 그대로 전환 vs ai-ing 전용 레포로 분리
