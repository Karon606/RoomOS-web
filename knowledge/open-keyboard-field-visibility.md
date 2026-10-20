# 키보드가 뜰 때 입력 칸이 가려지는 문제 (2026-08-30 신고, 2026-09-02 시공 완료)

## 무엇이 문제인가 (운영자 원문)

> 재고관리나 여러 필드 입력 시 키보드가 표시될 때 입력하려는 필드가 아래나 위쪽으로 숨겨지는
> 오류가 곳곳에서 발견 돼. 기본적으로 입력하려는 필드를 선택하고 그 필드를 위해 키보드가
> 튀어나오면 입력할 필드는 항상 화면 중앙(키보드를 제외한 나머지 화면의 중앙)에 위치한다던지
> 와 같은 규칙이 필요할 것 같아. 이게 없으니 키보드가 나올 때 튀거나 숨겨지거나 하는 등
> 오류가 생겨. 이 규칙을 세우기 위해 전문가 섭외가 필수일 것으로 보인다.

**곳곳에서 난다는 것이 핵심이다.** 한 화면의 결함이 아니라 규칙이 없어서 생기는 클래스다.
그래서 개별 화면을 하나씩 고치는 것이 아니라 **정본 규칙을 세우고 그 규칙을 감지망으로 지키는**
방향이어야 한다.

## 지금까지 이 축에서 한 일 (착수 전 반드시 읽을 것)

이 저장소는 키보드 문제를 이미 여러 번 밟았고, 그 처방들이 서로 다른 자리에 흩어져 있다.
**새 규칙은 그것들을 대체하는 것이 아니라 그 위에 서야 한다.**

- `lib/modalViewport.ts` — 모달 기하 정본. `overlayInsets(vv)`·`usableVvHeight()`·
  `shouldWriteVvHeight(next, lastGood, fromResize)`. 불변식은 `top + bottom = innerHeight - vv.height`
  (팬 불변). **크기는 커질 때만 아무 이벤트에서나 받고, 줄어드는 것은 resize 에서만** 받는다
  (2026-08-29 회귀 봉합 — 두 증상의 방향이 반대라 한쪽만 막으면 다른 쪽이 터진다).
- `components/ui/Modal.tsx` — 위 정본을 쓰는 유일한 소비자. `--modal-vvh`·`--modal-vv-top`·
  `--modal-vv-bottom` 을 패널에 쓴다. `collapseFooterOnKeyboard` 옵트인이 있다(키보드가 열리면
  푸터를 통째로 접는다 — 액션 여섯이 세 줄로 접혀 본문이 38px 만 남던 실측 2026-08-29).
- `components/layout/ViewportOffsetGuard.tsx` — `--kbd-inset` 의 **단일 소유자**이고
  `html[data-kbd-open]` 을 스탬프한다. 여기 말고 다른 자리에서 그 변수를 쓰면 두 소유자가 싸운다.
- `app/globals.css` — `html[data-kbd-open] .kbd-collapse { display: none; }`.
- `scripts/test-modal-viewport.ts` — 27건. 인셋 산수와 크기 쓰기 방향을 고정한다.
- `scripts/check-kbd-collapse-optin.mjs` — 푸터 접힘 옵트인이 커밋 수단을 가리지 않는지 본다.
- `scripts/check-overlay-resume-resync.mjs` — 복귀 시 재동기화 축.

**즉 모달 안은 상당히 다뤄졌고, 없는 것은 "그래서 입력 칸을 어디에 두는가"다.**
지금은 브라우저의 기본 `scrollIntoView` 에 맡기고 있고, 그것이 화면마다 다르게 동작한다.

## 착수 절차 (운영자 확정 규칙)

1. **패널을 먼저 소집한다.** 오류신고 5단계 문법이다 — 분류·원문 표시 → 전문가 섭외 →
   계획 보고(코딩 금지) → 운영자 승인 → 시공. UX/UI 전문가와 디자인가이드를 따지는 웹디자이너는
   항상 포함한다. 모바일 인터랙션·접근성 관점도 필요하다(포커스 이동은 스크린리더 사용자에게
   다르게 들린다).
2. **운영자가 제시한 규칙 자체가 검토 대상이다.** "키보드를 제외한 화면의 중앙"이 항상 옳은지,
   아니면 "가려지지 않는 최소 이동"이 나은지가 갈릴 수 있다. 중앙 고정은 짧은 폼에서 과한
   이동을 만들고(칸 하나 누를 때마다 화면이 크게 뛴다), 최소 이동은 긴 폼에서 칸이 키보드 바로
   위에 붙어 다음 칸이 안 보인다. **어느 쪽이든 근거와 함께 골라야 한다.**
3. **실측이 필요하다.** 어느 화면에서 실제로 가려지는지 목록을 만든다. 운영자가 "재고관리"를
   지목했으므로 거기부터. 모달 안(Modal 정본)과 모달 밖(페이지 폼)이 다르게 동작할 수 있다.
4. **정본 하나로 만든다.** 화면마다 손으로 스크롤을 맞추면 그 순간 다시 갈린다. 이 저장소가
   반복해서 배운 것이 "손사본은 언젠가 갈린다"이다.
5. **감지망을 세운다.** 새 규칙을 안 쓰고 제 스크롤을 만드는 자리를 잡는다. 결함을 일부러 심어
   실제로 잡는지 확인한다(`knowledge/regression-nets.md` 규칙).

## 함께 볼 것

- `iOS Safari` 와 `Android Chrome` 의 `visualViewport` 동작이 다르다. 이 저장소는 이미 그 차이로
  두 번 회귀를 냈다(2026-08-29 두 건). 새 규칙도 두 기기에서 실기 확인이 필요하다.
- `prefers-reduced-motion` — 스크롤 이동에 애니메이션을 넣는다면 이 설정을 존중해야 한다.
- 브랜드 가이드 §09(모션)·§20(브레이크포인트)·§08(오버레이 층).

## 관련 노트

[[domain-modal-shell]] · [[regression-nets]] · [[design-visual-identity]]


## 시공 결과 (2026-09-02, 패널 승인 3결정 + 9단계 시공)

운영자 승인 결정: 목표선 35% 유지(중앙 50%는 다음 칸 미리보기를 죽인다) · 스크롤 모션 보류 ·
가이드 §30 신설. 정본 서술은 docs/brand-guide-v2.0.md §30.

- `lib/keyboardViewport.ts` — 판정·기하 순수 정본 신설. 열림 문턱 60px, 줌 게이트 scale>1.02,
  겹침 상한 70% 클램프(기각에서 클램프로 정정), 복원 엡실론 2px(외장 단축바 스크롤 전쟁 봉합),
  재노출 목표선 35%. `scripts/test-keyboard-viewport.ts` 23건이 고정.
- `lib/useVisibleBand.ts` — Modal 의 띠 동기화를 훅으로 뽑은 정본. Modal 은 종전 변수명으로
  물려 픽셀 무변화. 수제 오버레이 여섯(확인창·살짝 보기·합치기(+내부 스크롤러 신설)·전역
  검색·재고 허브 부족·위치별 점검)을 전부 편입 — 인셋 두 항 + 패널 상한을 띠로.
- admin 셸에도 ViewportOffsetGuard 마운트 + main 자체 --kbd-inset 패딩(.app-main 재사용 금지).
- viewport 메타 interactiveWidget 'resizes-content' (Android 동작 고정).
- 감지망: `scripts/check-kbd-canonical.mjs` 신설(fixed inset-0 선언자는 훅 호출 또는 ALLOW
  사유 필수 + 허용 목록 케케묵음 검사) · check-standalone-scroll.mjs 에 admin 축 2건.
  역주입으로 실동작 확인.
- 명시적 비대응(패널 합의): iPad 플로팅·분할 키보드, PeekSheet iframe 내부 재노출,
  외장 단축바 아래 최하단 24px.
- 0단계 계측(2026-10-13, 키보드 가림 신고 패널): 오류신고 [화면 계측]에 sentinel(fixed 상자 H·T0·bottom)·doc(clientH·scrollTop) 줄과 '키보드 세션' 링버퍼 표(lib/kbdTrace, 가드가 판정 뒤 관찰 호출, 신고 버튼을 누를 때 얼림)를 더했다. 동작 무변화이고 후보 1(innerHeight 대신 상자 기준틀) 시공 전에 client 원점 모형을 실기로 가리려는 것. 표의 H·T0·sy 열은 가드 사건마다 열린 모달 오버레이(fixed inset-0, 폭이 innerWidth 와 같을 때만)를 읽고, 마지막 rep 줄은 누른 순간 센티널을 잰다. 그래서 모달 안 칸은 팬한 뒤 언제 신고해도 팬 도중의 H·T0 가 남지만(링버퍼 300건, 팬 묶음은 접어 싣는다), 모달 없는 셸 폼은 키보드를 띄운 채 신고 버튼을 누른 그 한 순간만 남는다. 그 rep 줄의 focus·kbd 열이 원래 칸이 아직 포커스와 키보드를 쥐고 있었는지 말해 주고, 아니면 그 신고로는 셸 폼 쪽을 못 가른다. 열었을 때·제출할 때의 sentinel 줄은 메모 칸 autoFocus 때문에 신고창 자기 세션 값이다. 그물은 check-kbd-canonical 5).

## 기준틀 교체 (2026-10-20, 신고 be5316e8 "여전히 키보드에 가려져서 타이핑할 때 안보이는 오류가 있어. 스크롤해서 올리면 화면이 톡톡튀고")

운영자 승인 '추천대로'(계측과 수정을 한 배포). 패널 기록은 저장소 밖 `오류신고-정비/키보드가림-패널.md`, 신고 정리는 `2026-10-20-신고3건.md`.

### 원인

키보드가 열린 iOS Safari 에서 vv.height 는 늘 416(iPhone 812pt 화면)인데 innerHeight 가 세 상태를 오간다(신고 22건 계측).

- (a) innerHeight 812, offsetTop 0
- (b) innerHeight = 812 − offsetTop. 칸을 드러내려 팬한 10건 전부가 이것이다(top 190 이면 622).
- (c) innerHeight = vv.height(추정)

화면 고정 상자(fixed inset-0)는 innerHeight 를 따르지 않고 높이 H = 812 를 지키며, (b) 에서는 위 끝이 client 기준 −offsetTop 에 선다. 근거는 신고 be5316e8 계측이다. (b) 의 패널 위 끝을 이 모형으로 계산하면 119 로 계측과 맞고(innerHeight 를 상자 높이로 보면 214), 사진의 222 는 (c) 에서 인셋 0 일 때의 자리와 맞는다(`scripts/test-modal-viewport.ts` 가 두 값을 재현한다).

종전 정본은 innerHeight 를 그 상자의 높이로 전제했다. 그래서 (b) 에서 --kbd-inset 16(실제 206), 모달 아래 인셋 16 으로 패널이 95 내려앉아 아래 53 이 키보드 밑에 깔렸고, 재노출 띠는 offsetTop 만큼 아래로 잡혔다. (c) 에서는 열림 판정이 거짓이 되어 인셋 0·표식 제거·되감기(scrollTo 0,0)가 돌았다.

'톡톡 튀는' 것은 팬마다 iOS 가 innerHeight 를 고쳐 보고하며 window resize 를 내고, 가드와 useVisibleBand 가 그것을 복귀 재동기로 받아 두 번씩 다시 쓴 탓이다. 가드는 --kbd-inset 을 팬 차감 크기로 다시 써서 716e7b0c 의 '크기는 resize 에서만' 규칙을 window 쪽 문으로 비켜 갔고, (c) 에서는 열림이 거짓으로 뒤집혀 팬을 되감았다.

### 식 (정본 `lib/viewportFrame.ts` readKbdSnapshot 이 H·T0 를 재고, `lib/keyboardViewport.ts`·`lib/modalViewport.ts` 가 쓴다)

- 열림 = H − vv.height > 60
- 겹침(셸 --kbd-inset, 오버레이 아래 인셋) = H − offsetTop − vv.height. 오버레이 위 인셋 = offsetTop.
- 재노출 띠 = client 기준 T0 + offsetTop 부터 vv.height 만큼(`visibleBand`)
- 키보드가 선 동안(표식 + 키보드 칸 포커스 + 기준틀 열림, `windowResizeIsPan`)의 window resize 는 팬이다. 가드는 판정만 갱신(기록 'wr')하고 인셋 재기록·재노출·복원을 안 한다. 훅은 vv scroll 과 같은 onPan 한 번이다.
- 팬으로 받았어도 두 프레임 뒤에 한 번 더 본다(`resyncAfterPan`, 검수 반영). 키보드가 내려가는 순간의 window resize 가 아직 옛 vv 로 읽혀 팬이 되고 그 뒤 vv resize 가 빠지면 표식과 여백 396 이 남기 때문이다. 닫힘이면 그때만 재동기하고, 여전히 열림이면 아무것도 안 한다. 같은 프레임의 rAF 는 이벤트와 같은 vv 를 보므로 두 프레임이다.
- 위치로 쓰는 값은 --kbd-inset 이 아니다. 도면 하단 시트(fixed bottom)는 useVisibleBand 의 --vv-bottom(상자 좌표의 겹침, 팬마다 갱신)을 쓴다. 종전 --kbd-inset 은 팬 동안 그대로라 (b) 에서 396 만큼 떠 실제 겹침 206 보다 190 위로 잘렸다. 화면 고정 팝업의 아래 공간도 innerHeight 대신 보이는 띠 아래 끝(`visibleBottomNow`)으로 센다(usePopoverAnchor, 재고 창고 고르기).
- 오류신고 계측의 센티널(viewportProbe sentinelRect)도 정본 상자(`frameBoxRect`) 하나를 잰다. 둘이면 판정과 계측이 다른 상자를 잰다.

716e7b0c 규칙과의 관계. 그 규칙은 '셸 여백(스크롤러 패딩)은 vv resize 에서만 쓴다'이다. window resize 는 그 규칙 밖의 문이었고, 이번에 그 문을 팬으로 묶어 규칙이 새지 않게 했다. 키보드가 진짜 내려가는 resize 는 열림이 거짓이라 종전 재동기로 간다.

측정. 상자는 처음 잴 때 body 끝에 하나 만들어 계속 쓴다(보이지 않음·누름 없음·aria-hidden). 가드와 훅이 같은 vv 이벤트를 들어 둘 다 부르므로, 같은 프레임·같은 vv 값이면 한 번 잰 값을 돌려주고 다음 rAF 에 지운다. 상자를 못 재거나 폭이 문서 폭과 다르면(transform 조상) 종전 틀(H = innerHeight, T0 = 0)로 답한다.

셸 여백(--kbd-inset)을 컨테이너 기준(.app-main 아래 끝 − 띠 아래 끝)으로 바꾸지 않은 이유(검수 지적 4). 그 값도 팬마다 달라져, 쓰는 순간 716e7b0c 의 '팬 동안 패딩을 다시 쓰면 scrollHeight 가 오르내려 scrollTop 이 되감긴다'로 돌아간다. 여백은 위치가 아니라 스크롤 여유라 팬 동안 넉넉한 것(396 대 실제 206)은 칸을 가리지 않는다. 값은 vv resize 순간(키보드가 서는 때, 대개 팬 전)에 적혀 그때의 실제 겹침과 같다. 닫힐 때 한 번에 0 이 되는 것은 종전과 같고(종전에도 열림 값이 그대로 남았다가 닫힘에 0), 여유 구간까지 스크롤했을 때만 클램프가 생긴다. 문서 scrollY 가 0 이 아닌 경우는 가드가 A 패턴(문서 스크롤 없음) 셸에만 서므로 대상이 아니다. 안드로이드·데스크톱은 0 그대로다.

같은 클래스 innerHeight 점검(검수 지적 5). 팝업 둘(usePopoverAnchor, 재고 창고 고르기 높이 상한)은 키보드가 선 채 열릴 수 있어 정본으로 옮겼다. 도면 시트 끌기 상한(innerHeight × 0.88)과 영수증 보정 캔버스 크기는 키보드 기하가 아니라 화면 대비 크기라 두고 주석을 달았다. 오류신고 버튼 끌기 클램프도 화면 끝 기준이라 무관하다.

동치. H = innerHeight, T0 = 0 이면 판정·겹침·복원·띠·인셋·관문이 종전과 한 조합도 안 다르다(키보드 2352 조합, 모달 4320 조합 전수). 데스크톱에서 가로 스크롤바가 있으면 H 가 그만큼 작게 재지는데, 그때 종전 식은 스크롤바 높이만큼 아래 인셋을 더 줬다. 이 저장소의 셸은 html·body 가 overflow hidden 이라 해당이 거의 없다.

### 그물

- `scripts/test-keyboard-viewport.ts`: (a)(b)(c) 실기 스냅샷 진리표(열림·겹침 396/206/396·복원 금지·띠 0~416·재노출), (b) 중간 팬 여섯, 종전 식이 틀린 자리 넷, 동치 전수, window resize 팬 판정표.
- `scripts/test-modal-viewport.ts`: Modal CSS 를 그대로 계산해 (a)(b)(c) 패널 아래 끝이 키보드 선 위인지, 종전 식으로 넣으면 신고 계측(119·16·222)이 그대로 나오는지, 동치 전수.
- `scripts/test-keyboard-viewport.ts` 정본 절: readKbdSnapshot 을 가짜 DOM(상자 T0 −190·H 812, 그리고 T0 0·H = inner)으로 직접 불러 기준틀을 그대로 넘기는지, 같은 프레임 한 번만 재는지, 이상한 상자는 종전 틀인지 본다. 늦은 재확인 판정표.
- `scripts/check-kbd-canonical.mjs` 6)~9): 키보드 기하 경로(keyboardViewport·modalViewport·useVisibleBand·ViewportOffsetGuard)의 innerHeight 금지(정본 readKbdSnapshot·visibleBottomNow 본문만 허용), 훅이 스냅샷 frameH·offsetTop 을 그대로 넘기는지(오버레이 인셋은 상자 좌표라 frameTop 은 안 쓴다), 가드 재노출 인자가 band.top·band.bottom 인지, windowResizeIsPan 첫 인자가 표식 검사인지, 팬 분기는 허용 목록(기록·늦은 재확인 rAF·return)만, 늦은 재확인 본문 고정, --kbd-inset 을 위치로 쓰는 자리 금지, 팝업 공간의 innerHeight 금지. 검수 역주입 다섯 건이 이제 빨간불이다.
- 계측: 키보드 세션 표에 화면 방식 줄(display-mode · navigator.standalone)을 더했고, 가드가 판정한 줄의 H·T0 열은 이제 판정에 쓴 기준틀이다(모달이 없는 셸 폼도 남는다). 'wr' 사건은 vs 와 한 팬 묶음으로 접는다.

### 실기 합격 기준 (배포 후 운영자 확인)

- iPhone 사파리 탭과 홈화면 앱 각각, 입주자 등록 모달 맨 아래 메모 칸을 눌러 타이핑한다. 패널 아래 끝과 메모 칸이 키보드(와 떠 있는 자동완성 막대) 위에 보이고, 글자가 보인다.
- 키보드를 띄운 채 모달 본문을 손가락으로 위아래로 스크롤해도 패널이 위아래로 튀지 않는다(이전 증상 '톡톡').
- 셸 폼(예: 재고 점검)에서 아래쪽 칸을 눌러도 키보드가 선 동안 화면이 맨 위로 되감기지 않는다.
- 키보드를 내리면 화면이 원래 자리로 돌아온다(잔존 오프셋 복원).
- 홈화면 앱에서 키보드를 내린 상태로 오류신고를 보내 계측의 sentinel H 와 vv h 차이가 60 이하인지 본다. 넘으면 키보드가 없는데 열림으로 판정되는 기기다(안전영역·주소창 몫이 상자에만 잡히는 경우).
- 도면 편집(모바일)의 하단 시트에서 칸을 눌러 키보드를 띄운 채 팬해도 시트 위가 잘리지 않는다.
- 갤럭시 Chrome 에서 같은 동작이 종전과 같다(안드로이드는 H = innerHeight, T0 = 0).
- 재현되면 그 자리에서 키보드를 띄운 채 오류신고 버튼을 누른다. 표 맨 위 화면 방식 줄과 H·T0·inner 열이 상태 (a)(b)(c) 를 가른다.

### 범위 밖(보고만)

입주자 등록 저장 버튼을 Modal 푸터로 옮기는 일(패널 R4), 입주자 폼 결함(메모 포커스 링, 메모 rows=2, 희망 조건 select 38px)은 이번에 손대지 않았다.

가드가 없는 공개 경로(B 패턴, 문서 스크롤 페이지)의 모달은 훅(새 기준틀의 오버레이 인셋)만 받고, 가드 몫(셸 여백·재노출·window resize 팬 처리)은 이번 범위 밖이다.
