# 무료 24시간용 배포 옵션

## 결론

토이 프로젝트 기준에서 가장 무난한 기본값은 `Cloudflare Workers`다.

이유:

- 무료 티어가 있다.
- 요청 기반이라 URL 자체는 24시간 열려 있다.
- 웹훅 수신 API와 간단한 체크아웃 생성 API에 잘 맞는다.
- Node 서버를 상시 띄워두는 방식이 아니라서 슬립 이슈가 비교적 덜하다.

## 후보 비교

### Cloudflare Workers

- 추천도: 가장 높음
- 장점: 무료, 빠름, 웹훅 받기 좋음, 글로벌 엣지
- 단점: 전통적인 long-running 서버가 아니다. 일부 Node 라이브러리는 그대로 못 쓴다.
- 적합도: 결제 토이 프로젝트, 링크 결제, webhook API

### Supabase

- 추천도: 조건부 추천
- 장점: Postgres, Auth, Storage, Edge Functions를 한곳에서 관리할 수 있다.
- 단점: Free 플랜 프로젝트는 `1주 비활성` 시 pause 된다. 무료로 `항상 깨어 있는 결제 웹훅 서버`를 기대하면 어긋난다.
- 적합도: 토이 프로젝트, 관리자 도구, 작은 결제 API, DB 중심 백엔드

#### Supabase가 맞는 경우

- 결제 서버가 `짧은 HTTP 요청` 중심이다.
- `Edge Functions + Postgres` 조합으로 충분하다.
- 무료로 가볍게 시작하고, 실제 운영 시 `Pro`로 올릴 의향이 있다.

#### Supabase가 애매한 경우

- 무료 상태에서도 `절대 pause 되면 안 되는` 웹훅 수신기가 필요하다.
- 결제 이벤트가 드물어서 1주 이상 무요청 구간이 생길 수 있다.
- 항상 떠 있는 프로세스나 특정 Node 런타임 의존성이 강하다.

#### Supabase로 구현하면 이런 구조다

- `supabase/functions/create-checkout`
- `supabase/functions/webhooks-toss`
- `supabase/functions/webhooks-paypal`
- `payments`, `payment_events` 테이블은 Supabase Postgres
- 관리자 조회 화면은 Supabase Auth로 보호

#### 비용 관점

- Free: `$0`, 500MB DB, 50,000 MAU, `1주 비활성 시 pause`
- Pro: `$25/월`부터, free pause 제약 없이 운영용으로 넘어가기 쉬움

### Render

- 추천도: 낮음
- 장점: 익숙한 서버 배포 모델
- 단점: 무료 플랜 정책과 슬립 여부를 반드시 다시 봐야 한다.
- 적합도: 상시 프로세스가 정말 필요할 때만 검토

## 내가 이번 레포에서 선택한 것

- 런타임: Cloudflare Workers
- API 프레임워크: Hono
- 향후 저장소: Cloudflare D1 또는 외부 Postgres

## 주의

`24시간 서버`를 `항상 프로세스가 살아 있는 VM`으로 이해하면 무료 옵션은 대부분 금방 제한에 걸린다. 이번 프로젝트처럼 결제 생성과 웹훅 처리가 중심이면, `24시간 접근 가능한 서버리스 엔드포인트`를 쓰는 쪽이 더 현실적이다.
