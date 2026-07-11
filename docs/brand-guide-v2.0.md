# stayeum Design Guide v2.0 (통합 정본)

> v1.1(브랜드 기초) · v1.2(컴포넌트) · v1.3(§09~§26) · addendum 2026-07을 하나의 완결 문서로 재구성했다 (2026-07-11).
> 증분 서술은 전부 절대 서술로 흡수했다: 어떤 항목이든 이 문서 하나로 최종 수치를 확인한다.
> 코드와 이 문서가 다르면 코드가 틀린 것이다. 사람용 렌더 버전: `stayeum Design Guide v2.0.html`.
> 구§ 참조는 문서 말미 "부록 A 매핑표"로 추적한다.

## §00 충돌 목록

해소됨 (우선순위 addendum > v1.3 > v1.1·v1.2 결정 메모 > HTML 원본, 또는 명시 정정):
1. 입력 radius: v1.2 데모 8px vs v1.3 6px → v1.3 명시 정정, **6px** (§12)
2. 숫자 서체: v1.1·v1.2 DM Mono vs v1.3.2 퇴출 → **Pretendard + tnum**. 구§21 원문의 "DM Mono 19px" 등도 서체만 Pretendard tnum으로 읽고 크기·웨이트 유지 (§05·§06·§22)
3. 토스트: v1.2 warn 포함 4종 vs v1.3 warn 폐기 → **success·error·info·urgent** (§15)
4. 브랜드 로더: v1.1 breathe 1.6s → v1.2 line-draw 3.2s, 용도는 §21이 재정의 (셸 없는 구간 전용)
5. VACANT 배경: v1.2 rgba(160,120,80,.10) vs v1.3 별칭 → **--neutral-bg rgba(61,36,24,.05)** (§04)
6. --success-bg 알파: v1.1 .09 vs v1.3 .10 → **.10**
7. 모달 z: v1.2 "200+" vs v1.3 → **--z-modal 300** (§08)
8. 보증금 배지: v1.2 데모 파랑 vs §14.4 → **--deposit-* 카멜** (§04·§11)
9. 장문 토스트 예문의 em dash: §25.1(현 §29)이 이후 성문화한 전면 규칙 → 예문을 가운뎃점 표기로 수정
10. 투명 틴트: 토큰표 rgba 리터럴 vs addendum → 코드는 **color-mix(in srgb, var(--coral) N%, transparent)**, 표의 rgba는 의도값 (§28)

미해소 → 전건 해소 (운영자 결정 2026-07-11):
1. **InventoryCard radius**: 14px(r-xl)로 정규화 확정 — 토큰 체계 예외 제거, 코드 반영 완료 (§22)
2. **테이블 내부 z 리터럴**: §08에 지역 예외 조항 명문화로 해소 — 코드 불변 (§08·§23)

---

## §01 브랜드

- 미션: "머무름과 이음이 만나는 곳에서, 운영자가 더 여유롭게 사람을 만날 수 있도록."
- 3가지 이음: 1 운영자와 입실자를 잇다(관계) · 2 데이터와 의사결정을 잇다(직관) · 3 과거의 기록과 미래를 잇다.
- 성격: 따뜻하고 인간적 · 묵직하고 신뢰감 · 차분하고 안정적 · 현대적이고 깔끔. 아닌 것: 통통 튀는, 차갑고 기술적, 부동산 앱(직방·다방), 호텔·여행 앱(Airbnb) 느낌.
- 보이스: 명확·사실적·짧고 구체적("401호 입실자 수납 완료"), 조용한 피드백("저장되었습니다"). 과도한 캐주얼·이모지·격려 문구·과잉 긍정 금지. 상세는 §29.
- 표기: 본문 stayeum / 스테이음. 워드마크 stay**eum** / 스테이**음** (eum·음만 테라코타). 금지: StayEum, STAYEUM, stay-eum, stay·eum. 도메인 stayeum.com.

## §02 로고 시스템

- 심볼: 단일 아치 브러시 획, viewBox 0 0 130 100, path `M 8 82 C 8 32 22 8 55 8 C 88 8 121 32 121 82 A 8.5 8.5 0 0 1 104 82 C 104 44 80 26 55 26 C 30 26 28 44 28 82 A 10 10 0 0 1 8 82 Z`. 정점은 왼쪽으로 살짝 기욺.
- 워드마크: Plus Jakarta Sans 전용. stay(--ink) + eum(--tc). 락업: 심볼 + 1px 디바이더 + 워드마크.
- 앱 아이콘: 테라코타 바탕 + cream 아치, radius r-2xl 비례. 80/44/24px에서 사이즈별 보정 path.
- 규칙: 클리어스페이스 "e" 높이 이상 · 영문/한글 워드마크 단독 사용(동시 배치 금지) · 그라데이션·그림자·글로우·아웃라인·기울이기·회전·왜곡·임의 색 금지 · 최소 크기 워드마크 12px / 심볼 16px.

## §03 컬러와 상태 5단계

```css
:root {
  --tc:#A03C2E; --tc-d:#7C2D26; --tc-s:#B85042;
  --camel:#C8A07D; --sand:#F2D9B8; --sand-s:#F5E5CC;
  --cream:#FBF6EF; --cream-2:#F5EDE0; --page:#E8DDD0;
  --ink:#3D2418; --ink-s:#7A6553; --ink-m:#A89380;
  --success:#4E6834; --success-bg:rgba(85,108,58,.10);
  --overdue:var(--tc); --overdue-bg:rgba(160,60,46,.18);
  --border:rgba(61,36,24,.10); --border-s:rgba(61,36,24,.18);
}
```
- 별칭(코드 호환): --coral = --tc · --persimmon-* = --tc-* · --ink-3 = --ink-s.
- Warm Olive 스와치 #7A9A52(채움) / #4E6834(텍스트).
- 상태 5단계 (좌측 팁 = fg와 동일):

| 상태 | fg | bg | 용도 |
|---|---|---|---|
| PAID 완납 | #4E6834 | rgba(85,108,58,.10) | 수납 완료 |
| AWAIT 예정 | #1E40AF | rgba(30,64,175,.08) | 파랑 허용 유일 계열 |
| UNPAID 미납 | #8B5E0A | rgba(180,120,10,.10) | 기한 경과 1~6일 |
| OVERDUE 연체 | var(--tc) Bold | rgba(160,60,46,.13) + 보더 .22 | 7일 초과에만 · 배지 filled |
| VACANT 공실 | var(--ink-m) | --neutral-bg | 입주자 없음 |

- 적용 범위 전면 통일: 수납 표·호실 카드·대시보드 방현황·알림 행·필터 칩. 대시보드에도 OVERDUE 필수. 상태색을 차트에 쓸 땐 상태 토큰 그대로 (viz 대체 금지).
- Do: --tc는 CTA·강조에만, --cream이 카드 배경. Don't: raw 무지개색·임의 hex·라이트 UI 순백/순흑·구코랄 rgba(244,98,58,…) (전면 금지, 2026-07-10 전수 제거).

## §04 의미색 정본과 시각화 팔레트

원칙: 웜 단색계 + 쿨 액센트 1종(블루). 새 hue 금지. 각 의미 = fg / bg / ring / solid.

| 의미 | 토큰 | 라이트 | 다크 | 다크분기 |
|---|---|---|---|---|
| danger 삭제·에러·미수 | --danger-fg / -bg / -ring | #A03C2E / rgba(160,60,46,.08) / .22 | #E08A75 / rgba(224,138,117,.12) / .28 | 분기 |
| | --danger-solid / fg | #A03C2E / #FBF6EF | 동일 | 고정 |
| success 완납·긍정 | --success-fg / -bg / -ring | #4E6834 / rgba(85,108,58,.10) / .22 | #A3BF7B / rgba(163,191,123,.14) / .30 | 분기 |
| | --success-solid / fg | #4E6834 / #FBF6EF | 동일 | 고정 |
| warning 미납·경고·변동 | --warning-fg / -bg / -ring | #8B5E0A / rgba(180,120,10,.10) / .24 | #D9A648 / rgba(217,166,72,.14) / .30 | 분기 |
| | --warning-solid / fg | #8B5E0A / #FBF6EF | 동일 | 고정 |
| info 예정·정보·양도인 | --info-fg / -bg / -ring | #1E40AF / rgba(30,64,175,.08) / .20 | #93A9D1 / rgba(147,169,209,.14) / .30 | 분기 |
| | --info-solid / fg | #1E40AF / #FBF6EF | 동일 | 고정 |
| deposit 보증금 | --deposit-fg / -bg / -ring | #8A6843 / rgba(200,160,125,.16) / .40 | #D4B494 / rgba(212,180,148,.14) / .28 | 분기 |
| reserve 예약 | --reserve-fg / -bg / -ring | #6E5C49 / rgba(140,122,102,.14) / .32 | #BBA892 / rgba(187,168,146,.12) / .26 | 분기 |
| overdue 연체 | --overdue-fg (텍스트) | #A03C2E | #E08A75 | 분기 |
| | --overdue-solid / fg (배지) | #A03C2E / #FBF6EF | 동일 | 고정 |
| neutral 공실·기본 | --neutral-fg / -bg / -ring | #7A6553 / rgba(61,36,24,.05) / .14 | #C7B5A2 / rgba(242,232,220,.06) / .14 | 분기 |
| in-progress 점검·처리 중 | --inspect-fg / -bg / -ring | #7A5A32 / rgba(200,160,125,.18) / .50 | #C8A07D / rgba(200,160,125,.16) / .40 | 분기 |

- 별칭: --status-paid-* = --success-* · --status-await-* = --info-* · --status-unpaid-* = --warning-* · --badge-overdue-* = --overdue-solid · --status-vacant-* = --neutral-*.
- 6개 확정 결정: 1 danger 빨강은 테라코타로 흡수(삭제 버튼 soft, 파괴적 확인 solid, 에러 박스 bg+ring+fg) · 2 success 초록은 올리브 단일(비결제 긍정 포함) · 3 amber는 단일 --warning-* · 4 deposit 보라→카멜, reserve teal→토프 (라이트값도 교체) · 5 blue 정보·양도인은 --info-*로 await와 통합(동일 hex) · 6 페일 틴트는 bg/fg/ring 트라이어드 1:1.
- 다크 리매핑 함정: -fg는 다크에서 밝아진다. 솔리드 배지/버튼 배경 = -solid(양 모드 동일 깊은 값) + --on-solid 글자(#FBF6EF, 양 모드 고정). --cream은 다크에서 표면색(니어블랙)으로 뒤집히므로 솔리드 채움 위 글자에 금지(2026-07-11 뷰 전환 탭 다크 글자 회귀로 확정). 틴트 칩·인라인 텍스트 = -fg + 투명 틴트 bg. -fg를 솔리드 배지 bg에 쓰지 말 것.
- 리터럴 정합 2건: Badge pale-green(#eef2e5+#4e6834)은 --success-bg + --success-fg 쌍으로 (text만 토큰화 금지) · StatusBadge ROW_TINT 6종은 "공용" 의도 폐기, 각 --{semantic}-bg로 (연체 행은 --danger-bg + 좌측 3px --overdue-fg 보더, 별도 --overdue-bg 없음).
- Tailwind 치트시트: text-red-500 → --danger-fg · bg-red-50 → --danger-bg · ring-red-200 → --danger-ring · bg-red-500(solid) → --danger-solid. emerald/green → success · amber/yellow → warning · blue/sky/indigo → info · purple/violet → deposit · teal/cyan → reserve · gray/slate → neutral. 연체 강조는 --overdue-fg, 미수 음수는 §06(--danger-fg).
- viz 팔레트: --viz-1 #A03C2E · 2 #C8A07D · 3 #7A9A52 · 4 #B47A0A · 5 #7C2D26 · 6 #C77F6F · 7 #93A77E · 8 #8C7A66. 시리즈는 1부터 순서대로, 건너뛰기 허용·역전 금지. KPI 수치 색에 viz 금지 (기본 --ink, 강조 --tc, 긍정 --success).

## §05 타이포그래피

- 3폰트: Pretendard Variable(한글·UI 전반·모든 숫자 tnum, 300~800) · DM Mono(가이드 문서·코드 표기 전용, 제품 UI 숫자 금지) · Plus Jakarta Sans(로고 워드마크 전용).
- 스케일: Display 36/700/1.1/−.04em · H1 28/700/1.15/−.03 · H2 22/700/1.2/−.025 · H3 18/600/1.3/−.02 · Body 14/400/1.6/−.01 · Small 12/500/1.5 · Caption 10.5/500/1.4(최소) · KPI 숫자 Pretendard 700 tnum.
- 규칙: body 자간 −0.01em, 헤딩 −0.025~−0.04em(클수록 조임) · 모든 데이터 숫자 tnum · 최소 10.5px · h1 정본 text-xl font-bold(+필요 시 InfoHint), 수제 크기 금지.

## §06 금액·숫자 표기

| 맥락 | 형식 | 예 |
|---|---|---|
| 표·KPI·카드 | ₩ prefix + tnum 600 필수 | ₩450,000 |
| 문장·토스트·라벨 | 숫자 + 원 접미, 본문 폰트 | 253,333원 |
| 음수(환불·감액·미수) | −(U+2212) + --tc | −80,000원 |
| 증감 긍정 / 부정 | + --success / − --tc | +20,000 / −50,000 |
| 0원 | 0원 그대로 · 대상 없음(공실)은 대시 기호 | |
| 축약(만) | 차트 축·스파크라인·요약 칩에서만 | 1,234만 |

- 축약 금지 구역: 표·정산서·계약서·확인 다이얼로그 (법적·정산 맥락은 전체 자릿수).
- 인라인 toLocaleString()+'원' 금지: 포맷 유틸 단일 경유.

## §07 스페이싱 · Radius · 그림자

- 4px 베이스 그리드. space-1 4 / 2 8 / 3 12 / 4 16 / 5 20 / 6 24 / 8 32 / 12 48.
- radius: r-xs 4(칩·태그 내) · r-sm 6(뱃지·입력) · r-md 8(버튼 sm·status row) · r-lg 10(버튼 md·카드 sm) · r-xl 14(카드·KPI) · r-2xl 18(모달·앱아이콘) · r-pill 999.
- 그림자는 부유 요소(모달·드롭다운·팝오버·툴팁·토스트·하단 알약)에만: `0 16px 48px -16px rgba(61,36,24,.22)`. 카드·입력·버튼·사이드바는 border 1px --border.

## §08 레이어(z-index) 위계

```css
--z-base:0; --z-sticky:100; --z-pill:120; --z-dropdown:150; --z-drawer:200;
--z-modal:300; --z-modal-2:310; --z-modal-3:320; --z-confirm:340;
--z-lightbox:360; --z-toast:400; --z-loader:500;
```
- 토큰 외 z값 금지. 형제 정렬은 DOM 순서로. 모달 중첩 최대 3중, 각자 backdrop(추가 어둡기 보정 금지). Esc는 최상단 레이어만. 토스트는 모달 위에서도 보임. 모달 내 드롭다운은 부모 모달 z+1.
- --z-pill 근거: sticky 위, dropdown·drawer 아래 (열리면 알약을 덮는다).
- **지역 예외(운영자 결정 2026-07-11)**: 컴포넌트 내부의 격리된 스태킹 컨텍스트(표의 sticky 헤더 z-30·고정 열 z-20 등)는 소규모 리터럴 허용 — 전역 레이어 토큰과 충돌할 수 없는 범위에 한한다.

## §09 모션

- --dur-fast 100ms(버튼 색·호버) · --dur-base 150ms(기본) · --dur-slow 200ms(카드 transform·드로어) · --dur-load 3200ms(브랜드 로더 1사이클) · --ease-default ease · --ease-in-out · --ease-sharp cubic-bezier(.4,0,.2,1)(모달·드로어).
- 컴포넌트: Button bg 150 · Input focus 150 · Nav hover 150 · Room card hover transform 180(translateY −2px) · Modal open 200 · Drawer 250 sharp · Brand loader 3200.
- 정본 전환 모션(2026-07-06, 전부 motion-safe): 슬라이딩 인디케이터(SegmentedControl·ViewTabs 활성 표시 200ms ease-out, offsetLeft/offsetWidth 실측 · 하단 내비는 상단 2px 코랄 바, pending 시 즉시 이동) · 오버레이 등장(.anim-overlay-in 160ms + .anim-panel-in 200ms translateY 10px + scale .97, Modal·ConfirmDialog · MergeSheet는 슬라이드업 유지) · 콘텐츠 전환(.anim-view-in 180ms 4px 상승, 상태 없는 표시 전용 컨테이너에만). 새 모션은 160~200ms·동일 이징 재사용.
- 금지: transition-all · 데스크톱 hover:scale(터치 active:scale-95~0.98은 허용) · 그라데이션·글로우.
- prefers-reduced-motion: 모든 애니메이션 즉시 완료, 기능 동일. 터치 타겟 44px · focus-visible 링 전 컴포넌트 필수.

## §10 버튼 · Btn

- variant: primary(--tc → --tc-d, cream 글자) · secondary(--cream-2 → --sand, 다크 hover는 #332619) · danger(--danger-bg → --danger-ring, --danger-fg 글자 · soft) · ghost(투명 → --cream-2) · subtle(--cream-2, 텍스트만 진해짐).
- size: sm 36px r8 / md 40px r10 / lg 44px r10. 터치 타겟 44px.
- 제출 중: 버튼 내 스피너 14px stroke 2.5 회전 0.8s + 라벨 "저장 중…", disabled + 폼 잠금, 너비 고정.
- 확인 라벨은 항상 동사("저장"·"전환"·"영구 삭제"), "확인"·"예" 금지. raw button 직접 작성 금지 (439곳 점진 교체).

## §11 배지 · Badge

- 정본 범위: 의미색 토큰 쌍(success·warning·info·danger·coral pale) 표준 상태 배지만. 카테고리 동적 틴트·canvas 메타 칩·오버레이(absolute)·숫자 카운터·버튼형은 범위 밖(별도 패턴).
- 틴트 배지 = -bg + -fg + inset 1px -ring, r-pill. 솔리드(b-overdue) = --overdue-solid + cream, 양 모드 동일. size sm 11px / md 12px.
- 병렬 패턴: 수납 상태 먼저, 일정 상태 뒤 ([미납] [퇴실 예정]) · 간격 4px · 최대 2개 · 3개 이상은 2개 + "+1" 뉴트럴 · 보조줄 10.5px --ink-m, 구분자 ' · ', 숫자 tnum ("12일 초과 · 6/13 퇴실 D-3").
- 보증금 배지는 deposit 카멜 (파랑 금지).

## §12 폼 입력

```css
--input-radius:6px; --input-h:40px; --input-h-touch:44px; --input-pad:9px 13px;
--input-border:1.5px solid var(--border-s); --input-border-focus:var(--tc);
--input-ring-focus:0 0 0 3px rgba(160,60,46,.12);
```
- radius 6px(r-sm) 전 입력 통일 (근거: 토큰표 규정 + 코드 다수파 176곳). 높이 40 / 모바일 44, textarea min 80. 13.5px Pretendard, 금액·숫자 tnum. bg --cream-2. placeholder --ink-m. 라벨 12px/500 --ink-s, 5px 간격. 에러: 보더 --tc + 11px --tc-d 메시지.
- 모달 내 폼: dirty 후 배경클릭 무시 · Esc·X는 일반 확인 경유("작성 중인 내용이 있습니다. 닫을까요?" [계속 작성] primary / [닫기] ghost) · pristine은 즉시 닫힘.
- 특수: 자동 합산 읽기전용(bg --sand-s, 보더 없음, tnum, "자동 계산" 캡션, 포커스 불가) · 상호배타는 체크박스 금지 → 세그먼트(36px, 선택 --cream + 보더 --tc) · 임시저장 칩(점 6px --success + "임시저장됨 14:32" / 저장 중 --camel + "저장 중…").
- 금액 입력 ₩ prefix 고정. 한 폼 안 입력 높이 혼용 금지 (인라인 검색 36px 예외).

## §13 모달 · Modal

- width xs·sm·md·lg. backdrop rgba 검정 70%(모드 불변). radius r-2xl 18. max-height 90vh 내부 스크롤. ESC·backdrop 닫기(§12 dirty 정책 우선). z --z-modal 300, 중첩 +10. 그림자 0 16px 48px −16px rgba(61,36,24,.24). 푸터 취소 좌·확인 우. 등장 .anim-overlay-in + .anim-panel-in.
- 아키텍처: 복잡한 다중탭 엔터티 상세(수납·입주자 통합) = 전역 Prism 셸(EntityModal) · 단순 추가/수정 폼 = 페이지 Modal. 수제 모달 금지 (17개 파일 흡수 대상).

## §14 확인 다이얼로그 · ConfirmDialog

- 네이티브 confirm()/alert() 전면 금지 (71곳 교체).
- 공통: 너비 360px(영향 고지형 420px, max calc(100vw−32px)) · r-2xl · --cream · backdrop rgba(0,0,0,.7) · z 340 · 패딩 24px 일체형 · 제목 16/700 · 본문 13.5/400 --ink-s lh 1.65 · 버튼 btn-md 취소 좌/확인 우 · 등장 opacity+scale(.96→1) 200ms sharp · 초기 포커스는 취소 버튼.
- 3단계: 일반(아이콘 없음 · primary · 취소 ghost · Esc/배경 허용) · 주의(삼각형 20px #8B5E0A · primary · 취소 secondary · 배경클릭 무시) · 파괴적(원형 20px --tc · solid --tc + 동사 라벨 · 취소 secondary · 배경클릭 무시 · 영향 목록 박스).
- 영향 고지형: 영향 목록 박스(bg rgba(160,60,46,.06), border 1px rgba(160,60,46,.2), r-md, 패딩 12px 14px, 항목 12.5px --ink-s, 건수 tnum 600) + 경고문 12px/600 --tc-d "이 동작은 되돌릴 수 없습니다." 건수는 반드시 서버 실데이터. 초고위험만 입력 확인 추가, confirm 2연타·체크박스 동의 금지.
- 액션 시트형(3지 이상, choiceDialog(altLabel)): 행 48px · 14/500 좌측 정렬 + 아이콘 16px · 구분선 --border · hover --cream-2 · 파괴 선택지 텍스트 --tc · 취소는 분리된 하단 ghost full width · 모바일은 바텀시트(상단 r 18, safe-area). 취소·Esc·배경은 항상 무변경(§27.5), 제3 동작은 별도 버튼.
- Do: 제목에 대상 이름 명시. Don't: 다이얼로그 안 다이얼로그(액션시트→확인 1회만 허용).

## §15 토스트

- 4종 (칩 색은 모드 불변): success #1E2E14/보더 rgba(78,104,52,.45) · error #5A1A10/rgba(160,60,46,.5) · 수동 닫기 항상 · info #3D2418/보더 없음 · urgent #7C2D26/rgba(160,60,46,.5). warn 폐기(미납→info, 연체→urgent).
- 위치: 하단 중앙 고정, bottom calc(24px + env(safe-area-inset-bottom)). 최대 폭 420px / 모바일 calc(100vw−32px). r-lg 10, 패딩 10px 16px, 텍스트 13px #FBF6EF, 아이콘 14px stroke 2.5.
- 모션: 등장 translateY(12→0)+opacity 200ms · 퇴장 150ms.
- 지속: 1줄 2400ms · 장문 5200ms · 액션 6000ms(hover 중 일시정지).
- 장문형: 1행 결과 13/600 + 2행 부가 12.5/400 rgba(251,246,239,.75) lh 1.55 최대 3줄 · 금액·일수 tnum. 예: "퇴실일 변경으로 일할 정산을 재계산했습니다 · 19일치 253,333원".
- 액션 버튼: 우측 텍스트 13/700 --sand #F2D9B8(고정), hover 밑줄, 히트 44x44.
- 스택: 동시 최대 3, 신규 아래, 간격 8px, 4번째 도착 시 최고(最古) 퇴장. 동일 메시지 연속은 카운트 배지 (x2).
- Don't: 3줄 초과 설명은 토스트가 아니라 다이얼로그/인라인 에러.

## §16 적용취소 · Undo

- 원칙: 적용하는 모든 기능엔 적용취소가 항상 있어야 한다.
- 라벨 "적용취소" 단일 ('해제'·'되돌리기' 등 교체). 모호하면 명사 보강("병합 적용취소"). 아이콘 rotate-ccw 14px + 6px 간격, 단독 사용 금지.
- 진입점 우선순위: 1 토스트 액션(6초) · 2 원위치 btn-subtle sm · 3 상세 화면 액션 메뉴. 토스트는 보조: 사라져도 2·3으로 항상 가능해야 충족.
- 되돌릴 수 없는 동작: 라벨 옆 캡션 "(되돌릴 수 없음)" 10.5px --tc-d · §14 파괴적 다이얼로그 경유 · 가짜 undo 제공 금지.
- Do: 적용취소 후에도 결과 토스트. Don't: 적용취소를 danger 색으로.

## §17 빈 · 로딩 · 스켈레톤

- 첫 로딩 = 스켈레톤(실제 레이아웃 모양, shimmer 1.5s, 최대 8개, 스피너 단독 금지) · 갱신 = 상단 진행 바 2px --tc indeterminate 1.2s(콘텐츠 유지) · 라우트 전환 = §21 결정표 · 빈 상태 = EmptyState(아이콘+제목+설명+CTA 최대 1, 점선 보더) · 인라인 "불러오는 중…" 원칙 금지(예외: 셀렉트 옵션 로딩 캡션 1곳).
- EmptyState·SkeletonRows가 유일 정본. 잦은 전환 라우트는 loading.tsx 필수. 스켈레톤+진행 바 동시 사용 금지.

## §18 상태 알림 행 · 긴급 강조

- Status Row: 좌측 3px 팁(border-left, 상태색) + --{semantic}-bg + r-md 8 + 패딩 10~11px 14px + 배지 min-width 54px + gap 12px. 알림 센터·대시보드 처리 리스트·타임라인용. 일시 피드백은 토스트, 영속·리스트형은 Status Row.
- 연체 카드: border-left 3px var(--tc) + bg --danger-bg + 호실번호·금액 --tc + b-overdue "연체 D+N". 공실 카드: 좌측 팁 --ink-m + opacity .6.
- 진행형 알림(해소까지 매일): 미납·재고·수령 대기·퇴실 경과("경과 N일 · 처리 필요"). 일정 알림(당일만)과 구분.

## §19 내비게이션 · 테이블 · 보조 정본

- 사이드바: 모바일 드로어 w-240 · 태블릿 아이콘 w-64 · 데스크탑 w-220. Active: --tc 텍스트 + 좌 2.5px --tc + rgba(160,60,46,.06).
- 데이터 테이블(기본형): 헤더 --cream-2 + 10.5px 700 대문자 --ink-m · 행 보더 --border · 식별자 --ink bold tnum · 금액 우측 정렬 · 연체 행 §18. sticky 확장은 §23.7.
- 페이지 인셋: AppShell(main p-4 md:p-6) 단일, 페이지 자체 패딩 금지.
- h1: text-xl font-bold (+InfoHint), 수제 크기 금지.
- AiQuotaHint: AI 트리거 버튼 옆 정본, "무료 AI n회 남음" + (i) 발급 안내(AiKeyGuide 단일 출처), 본인 키 영업장 자동 숨김.
- InfoHint: 제목은 짧은 명사구 (팝오버 헤더 잘림 방지).

## §20 반응형 전환

- 브레이크포인트 768px: 미만 카드 리스트 / 이상 데이터 표.
- 표→카드 매핑: 1행 좌 식별자(1순위) · 1행 우 상태 뱃지(1순위) · 2행 이름·기간(2순위) · 3행 금액 tnum(1순위) · 하단 캡션 10.5px --ink-m(3순위) · 4순위 이하는 상세에서.
- 카드 터치 영역 = 카드 전체. 카드/표 쌍은 동일 정렬·필터 상태 공유.

## §21 콜드 스타트 로딩 체계

```css
--loader-delay:300ms; --loader-min:1000ms; --splash-intro:3200ms;
--splash-fade:400ms; --splash-slow:5000ms;
--cold-bg:#E8DDD0; --cold-bg-dark:#000000;
```
- 판정 기준 하나: 앱 셸이 살아있는가. 있으면 스켈레톤, 없으면 브랜드 로더. 동시 발동 금지.
- 결정표: 1 콜드 부트(셸 없음)=풀스크린 스플래시+인트로 · 2 로그인→첫 진입=스플래시 유지→셸 크로스페이드→콘텐츠 스켈레톤 · 3 라우트 전환(셸 유지)=본문 스켈레톤만 · 4 데이터 갱신=진행 바 2px · 5 모달·위젯 내부=인라인 스켈레톤/버튼 스피너 · 6 PWA=OS 스플래시→1→2. 로더 용도는 셸 없는 구간(1·2·6)+로그아웃·계정 전환뿐.
- 스플래시: 배경 --cold-bg(=--page, manifest와 동일값 강제) / 다크 #000000. 로더 마크 104px + 워드마크 44px, 모바일(<640px) 세로 스택(워드마크 32px, 디바이더 생략). 위치 수직 중앙 −8%. 5s 초과 캡션 "연결이 느립니다. 계속 시도 중입니다" 12.5px --ink-s, 재시도 버튼 10s 초과. 퇴장 400ms 크로스페이드(빈 화면 경유 금지). z 500.
- 인트로 시퀀스(1회성): 0~1.0s 아치 line-draw(왼→오른쪽, cubic-bezier(.65,0,.35,1)) · 1.0~1.4 디바이더+EN 워드마크 · 1.4~2.0 hold · 2.0~2.35 EN→KO 크로스페이드 · 2.35~3.2 KO hold · exit max(3.2s, 앱 준비)+400ms. 완주 보장(임계 미적용 유일 예외). 세션당 1회(sessionStorage sy-intro-seen), 재진입은 생략+임계 적용. 종료 후에도 로딩 중이면 3.2s마다 KO↔EN 교차. 아치 stroke는 viewBox를 벗어남: svg overflow:visible 필수. reduced-motion: 정적 EN 락업. 스킵 버튼 금지. 인트로 중 prefetch 병행.
- 타이밍 임계: 300ms 안에 끝나면 미표시 · 보였으면 1000ms 유지 · 1.0s 이후 200ms 페이드아웃 중단 허용(사이클 정수배 대기 금지).
- FOUC: index.html 인라인 critical CSS `html{background:#E8DDD0}` + 다크 미디어쿼리 `#000000` + theme-color meta 2종. 흰 화면 0ms. 다크 감지는 CSS로만.
- 로그인: 제출 중 버튼 스피너+"로그인 중…"+잠금+너비 고정 · 소셜 리디렉트는 스플래시 재사용 · 인증 실패는 스플래시 즉시 퇴장→폼+인라인 에러.
- PWA: manifest background #E8DDD0 = --page 일치 강제(불일치는 릴리즈 블로커) · theme #A03C2E · 3단계 배경 동일 · 다크 PWA는 manifest 라이트 유지, 웹 스플래시부터 다크.

## §22 재고·리스트 컴포넌트

- InventoryCard: bg --cream · border 1px --border · radius 14px r-xl(§00 결정 — 13px에서 정규화) · 패딩 13/14px. .sel = border --tc + ring 2px rgba(160,60,46,.16). .attn = 좌 3px --tc. 제목 14.5/600 −.015em + 인라인 뱃지 gap 6px. 메타 11.5px --ink-m. 핵심 수치 19px/700 tnum 우측(위험 시 --tc, 단위 11px --ink-m) · 슬롯은 항상 1개. 액션 행 34px r8, 주 버튼 1개만 solid --tc. 체크박스 22px r7 on=--tc(선택 모드만). 펼치기 11.5px 행.
- SectionHeader: 마커 슬롯(카테고리=색 점 11px / 위치=아이콘 14px --ink-m) + 이름 13/700 + 카운트 11px tnum --ink-m + chevron 접기. 패딩 상14 하6(첫 상2).
- SelectionPillBar: bg --ink · r 15 · left/right 14 · bottom 16 · shadow lg · z --z-pill 120. 카운트 13/600 흰색, 숫자 --sand tnum. 액션 36px r9 (ghost rgba(255,255,255,.13) / 주액션 solid --tc-s). 닫기 34px. 탭별 가능한 액션만 노출(숨김, 비활성 아님). 합치기는 양 탭 공통.
- MergeSheet: 합치기 단일 바텀시트. bg --cream · 상단 r 20 · 패딩 8/18/20 · scrim rgba(31,26,23,.45) · z --z-modal 300. 그립 38x4. 제목 16/700. 대상 select 44px r10 bg --cream-2. 방향 확인 박스("이 카드 → 남는 카드", 화살표 --tc) 필수. 액션 취소(secondary)+합치기(solid --tc, flex 1.6) 46px. 모든 진입점 수렴. 실행 후 §16 undo 토스트 (환경설정에 숨기지 않음).
- 상세 진입: 카드 본문 탭 → 상세 풀화면(양 탭 공통). 가벼운 합산은 카드 내 펼치기.

## §23 리스트·테이블 화면

- ListPageShell 순서: 헤더(제목+우측 1~2 CTA/월선택) → 풀폭 SearchBar → 1차 필터(SegmentedControl) → (정렬·표시항목) → 본문(모바일 카드 / 768px 이상 sticky 테이블) → EmptyState. 섹션 간격 12px.
- SearchBar: 좌 돋보기 SVG + cream + 우 지우기 + 풀폭 약 40px. 항상 노출.
- 식별자: 호실번호·입주자명 = --ink bold tnum. 테라코타는 OVERDUE·.attn에만.
- 1차 필터 = SegmentedControl(라디오·단일, '전체'=해제). 토글 칩 금지. 고급필터는 별도 패널.
- 선택 모드: '선택' 토글 → 체크박스(모바일 카드 좌 / 데스크탑 sticky 호실셀, 선택 시 coral 체크) → SelectionPillBar(unit 개/명/실) → 배치 액션. 수납 일괄: 미수 호실 자동필터 → 확인 Modal(합계 tnum + DatePicker + 방법 세그먼트) → 성공 토스트 [적용취소]. 금액은 서버 권위 재계산.
- sticky 테이블: thead sticky top-0 z-30 cream · 식별자 열 sticky-left z-20 cream(§08 지역 예외) · 호실셀 좌 3px 상태색 · 열 리사이즈 · 768px 전환 시 상태 공유.
- 모달 아키텍처: 복잡 상세=EntityModal / 단순 폼=Modal.

## §24 대시보드·위젯

- KpiCard: 수치 1개 + 보조 1줄. 타입 3종: 강조(bg --tc, 1~2장, 내부 cream 계열만, 음수 캡션 --sand) · 일반(cream+border) · 경고(.attn 좌 3px + --danger).
- 차트 색 매핑(lib/chartColors.ts 단일 출처): 수입 --tc · 지출 --ink-s · 기타수익 --camel · 보증금 --deposit-fg · 예비비 --reserve-fg · 완납 --success-fg · 예정 --info-fg · 미납 --warning-fg · 연체 --overdue-solid. raw hex 8종 치환.
- 위젯 셸: bg --cream · border 1px --border · r-xl · 공통 헤더·진입 표시 · 그림자 없음.
- 진입: 페이지=Link / 상세=entityModal / 폼=Modal. window.location.href·router.push 혼용 제거.
- 반응형: 모바일 1열 → sm/md/lg 분기 (고정 열수 금지). 빈·로딩: 위젯별 Skeleton + dashboard/loading.tsx.
- 연체 배지: 미납(1~6일 --warning) → 연체(7일 초과 --overdue-solid "연체 D+N"). 1일부터 단계 노출.

## §25 뷰 전환 탭 · ViewTabs

- 판별: 필터(좁힘, '전체' 있음, SegmentedControl 트랙형) vs 뷰 전환(교체, 항상 1개 활성, ViewTabs 코랄 채움) vs 링크 탭(라우트 이동, ViewTabs 외형 + a href).
- 정본 = A 코랄 채움 조인트 + role=tablist. B(트랙형)의 뷰 전환 용도·C(rounded-2xl) 폐기. SegmentedControl 자체는 필터 전용 존속.
- 스펙: 컨테이너 inline-flex · r 10(r-md) · border 1px · overflow hidden · bg --cream · 세그 사이 1px 구분선. 세그 40px 이상(모바일 44pt: 세로 패딩 12px) · 10px 16px · 14/600 · radius 0. 활성 --coral + --on-solid 텍스트(#FBF6EF 고정 · white 금지 · --cream 금지: 다크에서 표면색으로 뒤집힘) · 비활성 --cream + --warm-mid · hover --cream-2 + --warm-dark 150ms · focus outline 2px --coral offset 2 · disabled --warm-muted.
- 라벨 접미: {라벨} ({값}) · 만 축약·부호·tnum · 정산·법적 금액 미부착 · 빈 괄호 금지.
- 개수: 2~4 권장, max 5. 모바일 넘침은 가로 스크롤(nowrap+페이드 마스크), 축약·2줄 금지. scrollIntoView 금지(scrollLeft만).
- 링크 탭: a role=tab + aria-selected/aria-current · SPA Link.
- 배치: 제목 아래 한 줄. MonthSelector 동시엔 탭 좌/셀렉터 우.
- API: SegmentedControl value: string|null vs ViewTabs activeId: string(null 불가) · suffix·href는 ViewTabs 전용.
- 마이그레이션: 재고 탭(시맨틱 추가, r 12→10) · 수납 탭(동일) · 재무 TABS(B→A) · 리포트 탭(C→A, white→cream).

## §26 인쇄 서류

- 원칙: 본문 먹1색(--p-ink), 컬러는 헤더 룰·금액 강조·워드마크만 · 라운드·그림자·이모지·일러스트 금지 · 발행번호·사업자정보·도장 영역 상시 노출 · 흑백 안전(위계는 굵기·크기·선) · 수치는 mm/pt.
- 폰트: Pretendard static TTF 4웨이트(400/500/600/700)만 임베드, 폴백 NanumGothic. pdf-lib tnum 미적용 → 표·금액 우측 정렬. 서류 1건 = 1가족. 본문 word-break: keep-all.
- 토큰(lib/printTokens 단일 출처): --p-ink #1F1A17 · --p-ink-muted #6B5D4F · --p-tc #A03C2E · --p-label-bg #F2ECE3 · --p-rule #D8CFC4 · --p-rule-strong #9A8A78 · --p-paper #FFFFFF(인쇄만 순백 허용). A4 여백 좌우 20 상 18 하 20mm, 콘텐츠 170mm. 선: hairline 0.4pt · rule 0.6pt · header-rule 1.6pt.
- 타입(pt): 제목 20/700(A5 17) · 발행 메타 9/400 · 소제목 12/600(좌 3pt 테라코타 탭 선택) · 표 라벨 10/500 · 값 10.5/400 · 금액 강조 15/700 --p-tc 우측 · 본문 10.5 lh1.6 · 주석 8.5 · 푸터 8. 최소 8.5pt(8pt는 푸터·법적 주석만).
- 키-값 행: 라벨열 40mm(--p-label-bg) · 행 9mm · 데이터행 8mm · 셀 패딩 좌우 4mm 상하 2mm. 가로 hairline 위주, 세로선은 라벨/값 경계 1개.
- 헤더: 밴드 22mm, 로고 14mm + 영업장명 14pt/700 + 사업자정보 9pt + No.·발행일 우측 + 테라코타 룰 1.6pt.
- 푸터: "made with stayeum"(stay --p-ink / eum --p-tc, 8pt) baseline 하단 12mm. 페이지 번호는 2p 이상만.
- 서명·도장: 우측 정렬, 서명란 60mm. 도장 PNG 18x18mm를 "(인)" 위 오버레이. 서명줄과 위 문구 사이 최소 11mm. 도장을 로고로 재사용 금지.
- 포맷: No. YYYYMMDD-NNN · YYYY년 M월 D일 · YYYY.MM.DD ~ YYYY.MM.DD · ₩+쉼표 축약 금지 · 한글 병기(금 사십오만원정) · 음수 − + --p-tc.
- 브랜딩 경계: 레이아웃을 우리가 정하면 ON, 정부/제3자 고정 양식이면 OFF.
- 문서별: 입실료 납부 확인서 = A5 세로 · pdf-lib · 여백 14/12/14 · 콘텐츠 120mm · 라벨열 34mm · 헤더밴드 18mm · 로고 12mm · 풀 브랜딩. 계약서 = A4 · puppeteer 가능 · 조항 10.5pt lh1.7 · 2p부터 간략 헤더 · 조항은 CONTRACT_CONFIG(영업장 DB) 주입, 레이아웃 고정, 강조 마커→--p-tc · 혼합 브랜딩. 실거주 확인서 = 정부 원본 오버레이 · 나눔고딕 먹1색 10pt 칸 중앙 · 브랜딩 OFF.

## §27 인터랙션 문법

- 27.1 저장: 단일 값 즉시 반영형(토글·스텝퍼·셀렉트 1개)=즉시 저장+토스트, 버튼 없음 · 폼형(2필드 이상/텍스트)=저장 버튼 상시 노출(조건부 등장 금지) · 파괴적·대량=ConfirmDialog+undo 병행. 같은 카드 안 혼용 금지.
- 27.2 실패: 서버·통신=토스트(화면 무반응 금지) · 검증=인라인 · 이중 통지 금지 · fire-and-forget promise는 catch 필수.
- 27.3 선택 모드: 명시 '선택' 버튼 정본, 롱프레스는 보조. 롱프레스 전용 진입 금지.
- 27.4 undo vs 확인창: 비파괴=토스트 [적용취소] · 파괴적=ConfirmDialog(danger, impact) 그리고 가능하면 undo도. 택일 아님. undo 불가는 확인창에서 고지.
- 27.5 취소는 무해: '취소'·Esc·배경 클릭은 항상 무변경. 취소에 실 동작 금지, 제3 선택지는 버튼 3개(choiceDialog).
- 27.6 검색 스코프: 현재 필터(탭·월) 안에서. 스코프 밖은 "다른 보기에 N건 ›" 안내(자동 해제 금지). 월 범위 고지는 "OO은 선택한 달 기준입니다" 단일 문형.
- 신규 기능은 이 §를 통과해야 UI/UX 정합 게이트를 넘는다.

## §28 다크모드

```css
[data-theme=dark] {
  --d-page:#000000; --d-card:#1A130E; --d-card-2:#261C14;
  --d-ink:#F2E8DC; --d-ink-s:#C7B5A2; --d-ink-m:#93816F; /* 캡션 한정 */
  --d-border:rgba(242,232,220,.08); --d-border-s:rgba(242,232,220,.16);
  --d-tc-text:#C9614C; --d-success:#A3BF7B; --d-amber:#D9A648;
  --d-blue:#93A9D1; --d-overdue:#E08A75;
  --sand:#332619; --sand-2:#3D2E1F; /* 보조 버튼 hover 표면 */
}
```
- 페이지 배경 트루 블랙 #000000 (OLED 절전·번인 · 다크 배경에 한해 순흑 허용). 온도는 카드(#1A130E)·텍스트(#F2E8DC)·액센트가 담당. 순백 텍스트는 다크에서도 금지.
- 원칙: 토큰 쌍 강제(라이트 표면 + 다크 텍스트 조합이 사고 원인) · 라이트 카드 반입 금지(강조는 숫자 색·좌측 팁) · 대비 본문 4.5:1 / 24px+ 숫자 3:1 · solid terracotta 카드 허용(1화면 1개, 내부 cream 계열만, 음수 캡션 --sand) · 투명 틴트는 color-mix · 전환은 토큰 치환만(하드코딩 금지).
- 모드 불변 목록: 토스트 칩(bg 고정 + #FBF6EF + 액션 #F2D9B8) · 인쇄 문서(항상 라이트 종이) · 스크림(rgba 검정) · 구글 로고 · 배치도 캔버스 · 코랄 솔리드 위 #fff · §04의 -solid 전부.
- 상태 다크: PAID #A3BF7B/rgba(163,191,123,.14) · AWAIT #93A9D1/.14 · UNPAID #D9A648/.14 · OVERDUE #E08A75 텍스트, solid 배지 --tc 유지 / rgba(160,60,46,.30) · VACANT --d-ink-m / rgba(242,232,220,.06).
- 감사 6건 교체: 순이익 위젯 → --d-card + 라벨 --d-ink-s + 수치 --d-success + 좌 3px 팁 · 매출 −45% → --sand(700 보강 가능) · 보증금 보라 → #D4B494 · 예비비 틸 → #A3BF7B · 예정 블루 → #93A9D1 · 공실 레드 → --d-ink-m.

## §29 마이크로카피 · AI 지문 방지

- em dash 금지 (사용자 노출 문자열 전체): 완결 문장이면 마침표 두 문장 · 짧은 부연이면 가운뎃점 · 리스트 라벨 설명이면 콜론.
- 화살표(→) 최소화: 이동 링크 › · 설정 경로 > · 화살표는 값의 전환 표시에만 ("6월 → 7월로 변경").
- 이모지 전면 금지 (경고 삼각형·체크 포함). 느낌표 금지 (마침표로 끝). 진행형 말줄임 '…' 단일 (마침표 3개 금지 · 79곳 통일 완료).
- 톤: 성공 토스트는 명사형/간결 완결문("등록됨"·"저장됐습니다") · "성공적으로 ~되었습니다" 금지 · "~할 수 있습니다/해보세요" 반복 금지 · 버튼 라벨 동사·명사 2~6자.
- 멀티테넌트 중립: "야간에" 같은 운영자 개인 상황 특정 문구 금지 · 개인화 불가 맥락(단체 발송)에서 변수 표기({이름}) 노출 금지.
- 점검: 사용자 노출 문자열에서 em dash · 전환 표기 외 화살표 · 이모지 · "요!" 검색 결과 0. 모션 측 금지(transition-all·hover:scale·그라데이션)는 §09 정본.

---

## 부록 A · 구버전 § 매핑표

v1.2 → v2.0: §01→§01 · §02→§02 · §03→§03(+의미색 §04) · §04→§05 · §05→§07 · §06→§10·§11·§12·§18(카드)·§13 · §07→§19(사이드바·테이블)·§17(빈상태·스켈레톤)·§15(토스트)·§18(상태행·긴급)·§21(로더) · §08→§09

v1.3 → v2.0: §09→§14 · §10→§16 · §11→§15 · §12→§08 · §13→§12 · §14→§04(14.3 뱃지 병렬은 §11) · §15→§06 · §16→§17 · §17→§20 · §18→§21 · §19→§28 · §20→§26 · §21→§22 · §22→§23 · §23→§24 · §24→§25 · §25→§29(25.3 모션은 §09) · §26→§27

v1.1 md → v2.0: 컬러 토큰·상태→§03 · radius·그림자→§07 · 타이포→§05 · 버튼→§10 · 모션→§09 · 로고→§02

addendum 2026-07 → v2.0: 다크모드 보강→§28(구코랄 금지는 §03에도) · Badge 범위→§11 · choiceDialog→§14 · EmptyState/SkeletonRows→§17 · AiQuotaHint·InfoHint→§19 · 문법 확정→§27 · 말줄임→§29 · 진행형 알림→§18 · 페이지 인셋·h1→§19(§05) · 마이크로카피→§29

커버리지: 전 섹션 반영.
