> [!warning] 구버전(v1.2) — 정본은 docs/brand-guide-v2.0.md (2026-07-11 통합). 이 파일은 이력 보존용이며 § 대응은 v2.0 부록 A 매핑표 참조.

# stayeum — Brand & Design Guide v1.2 (요약 레퍼런스)

> 원본 HTML은 사용자 제공본. 본 파일은 코드 참조용 핵심 토큰 추출.
> v1.1 → v1.2 주요 변경: Status 5단계(연체 강조), Status Notification Row 패턴,
> Brand Loader(line-draw + 워드마크 교차) 모션, 카드 좌측 3px 팁 강조 패턴.

## 색상 토큰 (CSS 변수)

```
--tc:        #A03C2E   Terracotta — Primary / CTA / 로고 / OVERDUE
--tc-d:      #7C2D26   Terracotta dark — hover / 강조 텍스트
--tc-s:      #B85042   Terracotta soft (hover-ish)
--camel:     #C8A07D   Camel — 보조 라인·아이콘
--sand:      #F2D9B8   Sand — 정보 카드 배경·하이라이트
--sand-s:    #F5E5CC   Sand soft
--cream:     #FBF6EF   Cream — 카드/모달/사이드바 배경 (#fff 금지)
--cream-2:   #F5EDE0   Cream 2 — 페이지 배경 보조
--ink:       #3D2418   Ink — 모든 텍스트/아이콘 (#000 금지)
--ink-s:     #7A6553   Ink soft — 보조 텍스트
--ink-m:     #A89380   Ink muted — placeholder·메타
--success:   #4E6834   Warm Olive 다크 — 납부 status fg
--success-bg:rgba(85,108,58,.09)   Warm Olive 페일 — 납부 status bg
--overdue:   var(--tc)             Terracotta — 7일 이상 연체에만
--overdue-bg:rgba(160,60,46,.18)
--border:    rgba(61,36,24,.10)    카드 1px 보더
--border-s:  rgba(61,36,24,.18)    강조 보더
--page:      #E8DDD0                페이지 배경
```

## 상태 5단계 (Status Strip)

| 상태 | bg | fg | 좌측 팁 보더 | 용도 |
|---|---|---|---|---|
| PAID 납부 | rgba(85,108,58,.09) | #4E6834 | #4E6834 | 완납 |
| AWAIT 예정 | rgba(59,130,246,.08) | #1e40af | #1e40af | 납부 예정 |
| UNPAID 미납 | rgba(180,120,10,.10) | #8B5E0A | #8B5E0A | 기한 경과 |
| **OVERDUE 연체** | rgba(160,60,46,.13) + border .22 | **var(--tc)** Bold | **var(--tc) 3px** | **7일 이상** |
| VACANT 공실 | rgba(160,120,80,.10) | var(--ink-m) | var(--ink-m) | 입주자 없음 |

## 상태 알림 행 (Status Row) 패턴

> 알림센터·대시보드 등 여러 상태가 한 화면에 들어가는 곳.
> 좌측 3px 컬러 팁(border-left) + 상태 배지 + 본문.

```
display: flex; align-items: center; gap: 12px
padding: 10–11px 14px
border-radius: 8px (r-md)
border-left: 3px solid {status-color}
background: {status-color} @ 6–9% alpha
badge: same status, min-width 54px, justify-content: center
```

## 카드 — 카드 좌측 팁 보더(긴급 상태)

```
.room-card.overdue {
  border-left: 3px solid var(--tc);
  background: rgba(160,60,46,.03);
  room-num, amount: color: var(--tc);
}
.room-card.vacant {
  border-left: 3px solid var(--ink-m);
  opacity: .6;
}
```

## 모달

- backdrop: `black/70`
- border-radius: `r-2xl (18px)`
- max-height: `90vh` (내부 스크롤)
- ESC·backdrop 클릭으로 닫기
- box-shadow: `0 16px 48px -16px rgba(61,36,24,.24)`
- z-index: 200+ (앱 헤더 100 위)

## 토스트 피드백

```
.toast { bg: var(--ink); color: #FBF6EF; r: 10px; padding: 10px 16px; }
.toast.success { bg: #1E2E14; border: rgba(78,104,52,.45) }
.toast.warn    { bg: #5A3800; border: rgba(180,120,10,.4); color: #FDDFA0 }
.toast.error   { bg: #5A1A10; border: rgba(160,60,46,.5);  color: #FFCBBF }
.toast.urgent  { bg: var(--tc-d); border: rgba(160,60,46,.5) }
```

토스트는 **일시적 피드백**(저장 완료 등), 상태 알림 행은 **상시·리스트형 알림**.

## 반경 토큰

| 토큰 | 값 | 용도 |
|---|---|---|
| r-xs | 4px | 칩·태그 내부 |
| r-sm | 6px | 배지·입력 |
| r-md | 8px | 버튼 sm·status row |
| r-lg | 10px | 버튼 md·카드 sm |
| r-xl | 14px | 카드·KPI |
| r-2xl | 18px | 모달·앱 아이콘 |
| r-pill | 999px | 필 배지·필터 |

## 폰트

- Pretendard Variable — 한글·UI 전반 (300–800)
- DM Mono — 금액·KPI·ID·코드 (400, 500) — `font-feature-settings: 'tnum'` 항상
- Plus Jakarta Sans — **로고 워드마크 전용**, 다른 곳 금지

## 모션 토큰

```
--dur-fast:  100ms   버튼 색상, 호버 배경
--dur-base:  150ms   기본 UI 전환 (default)
--dur-slow:  200ms   카드 transform, 드로어
--dur-load:  3200ms  브랜드 로더 1 사이클
--ease-default:  ease
--ease-in-out:   ease-in-out         로딩·슬라이드
--ease-sharp:    cubic-bezier(.4,0,.2,1)   모달·드로어
```

## 브랜드 로더 (페이지 이동·라우트 전환)

3.2초 사이클:
- 0–1.0s: 아치 stroke draw (왼쪽→오른쪽) — '쌓다' 은유
- 1.0–1.4s: 마크 fill + 디바이더 + 워드마크 fade-in
- 1.4–2.7s: 록업 hold
- 2.7–3.2s: fade-out
- ×2 cycle: 워드마크 EN → KO 교차 (stayeum → 스테이음)

## 접근성

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    transition-duration: 0.01ms !important;
  }
}
```

모든 인터랙티브 요소 최소 터치 타겟 44px. focus-visible 포커스 링 필수.

## v1.1 → v1.2 호환성 메모

- `--coral` (v1.1) → `--tc` 동일 색상 alias 유지 (코드 호환).
- `--persimmon-*` → `--tc-*` alias.
- `--ink-3` (v1.1) → `--ink-s` (v1.2). 둘 다 유지.
- Status 색상은 v1.1 `--status-paid-*` 등을 v1.2 표기로 마이그레이션.
