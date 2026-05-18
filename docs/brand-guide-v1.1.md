# stayeum — Brand & Design Guide v1.1 (요약)

2026-05-18 수령. 원본 HTML(Claude Design 제작)에서 토큰을 추출한 작업용 레퍼런스.
**이 가이드 기준으로 앱 전반 리스킨 필요** — 특히 상태별 카드 색상.

## ⚠ 현재 코드와의 충돌 (리스킨 시 반드시 정리)

1. **파란색** — v1.1은 `AWAIT(예정)` 상태에 **파란색 허용**(`b-blue` #1e40af).
   직전 ① 작업은 "파란색 전면 금지"로 모두 제거함 → v1.1 기준으로 되돌려야 함.
2. **Success = Warm Olive** (`#7A9A52` 채움 / `#4E6834` 텍스트) — 현재 쓰는
   `#1a6e4c`(짙은 그린) 아님. `--card-resident`·StatusBadge 등 전부 올리브로.
3. **Radius 스케일 변경** — v1.1: r-md 8 / r-lg 10 / r-xl 14.
   현재 globals.css: r-md 10 / r-lg 14. → 토큰 재매핑 필요.
4. **연체 카드 좌측 border 허용** — v1.1 "긴급 상태 패턴"은 연체 카드에
   `border-left:3px solid var(--tc)` 사용. ①의 "좌측 border 금지"와 충돌.
5. 뱃지 종류 확장 — b-success/warn/danger/neutral + pill(b-coral/green/amber/blue/teal) + b-overdue.

## 컬러 토큰 (:root)

```
--tc:#A03C2E; --tc-d:#7C2D26; --tc-s:#B85042;       /* Terracotta */
--camel:#C8A07D; --sand:#F2D9B8; --sand-s:#F5E5CC;
--cream:#FBF6EF; --cream-2:#F5EDE0;
--ink:#3D2418; --ink-s:#7A6553; --ink-m:#A89380;
--success:#4E6834; --success-bg:rgba(85,108,58,.09);  /* Warm Olive — swatch #7A9A52 */
--overdue:var(--tc); --overdue-bg:rgba(160,60,46,.18);
--border:rgba(61,36,24,.10); --border-s:rgba(61,36,24,.18);
--page:#E8DDD0;
```

## 상태 색상 (5단계)

| 상태 | 색 | 비고 |
|---|---|---|
| PAID 납부 | Warm Olive | `#4E6834` / bg `rgba(85,108,58,.10)` |
| AWAIT 예정 | **Blue** | `#1e40af` / bg `rgba(59,130,246,.08)` |
| UNPAID 미납 | Amber | `#8B5E0A` / bg `rgba(180,120,10,.1)` |
| OVERDUE 연체 | Terracotta Bold | filled `#A03C2E`, 7일 초과 시만 |
| VACANT 공실 | Warm Muted | `--ink-m` |

## Radius 토큰

`r-xs 4`(칩·태그 내) · `r-sm 6`(뱃지·입력) · `r-md 8`(버튼 sm) · `r-lg 10`(버튼 md·카드 sm) · `r-xl 14`(카드·KPI) · `r-2xl 18`(모달·앱아이콘) · `r-pill 999`(필 뱃지·필터).

## 타이포 (3폰트)

Pretendard(본문·UI) · DM Mono(숫자·금액·KPI·코드, `tnum`) · Plus Jakarta Sans(로고 워드마크 **전용**).
스케일: Display 36 / H1 28 / H2 22 / H3 18 / Body 14 / Small 12 / Caption 10.5(최소). letter-spacing body -0.01em, heading -0.025~-0.04em.

## 버튼

variant: primary(tc→tc-d) · secondary(cream-2→sand) · danger(tc 10%→18%) · ghost · subtle.
size: sm 36px r8 / md 40px r10 / lg 44px r10. 터치 타겟 최소 44px.

## 그림자

floating(모달·드롭다운·토스트·하단탭)에만. 카드·입력·버튼은 `border:1px solid var(--border)` — 그림자 금지.

## 모션

dur: fast 100 / base 150 / slow 200 / load 1600(ms). 인터랙션 피드백 150ms 이내.
`prefers-reduced-motion` 시 애니메이션 즉시 종료(기능은 동일 동작).
로딩: Arch 심볼 breathe 애니메이션(1.6s).

## 로고

Arch Symbol 단일 path(viewBox 0 0 130 100). 워드마크 stay(ink)+eum(tc).
최소 크기: 워드마크 12px / 심볼 16px. 기울이기·회전·그라데이션·그림자 금지.
