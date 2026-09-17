# 모달 껍데기 — 등장 모션과 막의 마감 (2026-09-17 신설)

`knowledge/` 에 이 축의 노트가 **0건**이었다. 그래서 같은 병이 네 번 났다.
`[[open-keyboard-field-visibility]]` 가 이 이름을 가리키고 있었는데 파일이 없었다.

여기 적는 것은 "모달이 화면에 앉는 껍데기"의 진실이다. 안에 무엇을 그리는지는 각 화면의 몫이고,
**뜨고 · 앉고 · 걷히는** 세 동작은 이 한 벌이 진다.

---

## 껍데기를 이루는 다섯 조각

| 조각 | 무엇을 지나 | 소유자 |
|---|---|---|
| 기하 순수 함수 | `overlayInsets` · `usableVvHeight` · `shouldWriteVvHeight` · `resumeAllowsShrink` · `bandHeight` | `lib/modalViewport.ts` |
| 띠 동기화 훅 | `--vv-top` · `--vv-bottom` · `--vv-h` 를 명령형으로 적는다 | `lib/useVisibleBand.ts` |
| 등장 마감 훅 | `.anim-overlay-in` · `.anim-panel-in` 을 **끝난 것을 확인하고** 뗀다 | `lib/useSettleEntrance.ts` |
| 모션 판정 정본 | "지금 돌고 있는가" · "어떻게든 끝났는가" | `lib/animationSettled.ts` |
| 모션 선언 | `@keyframes overlay-in` · `panel-in`, 클래스 둘 | `app/globals.css` §25.3 |

쓰는 이는 여덟이다(2026-09-17 전수).

- `components/ui/Modal.tsx` — 정본 모달. 변수 이름만 제 것(`--modal-vv-top` 등)으로 물려 쓴다
- `components/ui/ConfirmDialog.tsx` · `components/ui/PeekSheet.tsx` · `components/ui/ImageLightbox.tsx`
- `components/ui/inventory/MergeSheet.tsx` · `components/search/GlobalSearchHost.tsx`
- `app/(app)/inventory/InventoryClient.tsx` 의 수제 오버레이 둘(허브 부족 · 위치별 점검)

**`useVisibleBand` 를 고치면 이 여덟이 전부 움직인다.** 옮기기 모달 하나가 아니라 앱의 모든
모달 기하다. 손대기 전에 여덟을 다시 세고, 키보드가 뜨는 화면을 먼저 본다.

---

## 네 번의 이력 — 전부 같은 클래스다

| 날짜 | 무엇이 보였나 | 무엇이 원인이었나 |
|---|---|---|
| 2026-06-12 | 스플래시 드로잉 잔상, 멈춘 듯한 화면 | `/` 의 `redirect()` 가 meta-refresh 체인이 되어 떠나는 문서의 모션이 중간 프레임에 얼어붙은 채 남았다 |
| 2026-08-28 | 크림색 막이 화면을 덮고 조작이 통과 | 퇴장이 CSS transition 과 `setTimeout` 두 시계 위에 있었고, 백그라운드에서 페이지 시계가 멈췄다 |
| 2026-09-08 | "일부가 깨져보이는 현상" | 숨은 채(`document.hidden`) 마운트되면 등장 모션이 첫 프레임에 굳는다. 복귀 재동기 첫 패스가 낡은 스냅샷을 박았다 |
| 2026-09-16 (bf0a6fff) | 막이 25~30% · 패널이 위로 붙어 눌림 | 아래 둘, **동시에** |

**공통 문법이 하나다.** 화면의 어떤 상태가 *시간 위*에 놓여 있고, 그 시간이 우리 손 밖에서
멈춘다. 브라우저 탭이 죽거나, 앱을 나갔다 오거나, 화면이 꺼진다. 그러면 중간값이 최종값이 된다.

그래서 이 축의 규칙은 하나로 모인다. **벽시계로 마감하지 않는다.** "얼마나 지났나"가 아니라
"무엇이 실제로 일어났나"만 신호로 쓴다(2026-09-08 결정).

---

## bf0a6fff 의 두 경로

### (가) 옅어짐 — 등장 모션이 중간값에 굳는다

`.anim-overlay-in` 은 `opacity 0` 에서 출발해 기본 스타일(불투명)로 간다. `fill-mode` 가 없어
**안 돌면** 아무 일도 안 일어나지만, **돌다가 멈추면** 중간값에 굳는다. 합성 레이어가 옛
프레임에 남고, 등장 클래스가 계속 붙어 있으니 스타일 재계산도 안 일어난다.

마감 훅에 구멍이 있었다. 이펙트는 **페인트 뒤에** 돈다.

- `document.hidden` 을 이펙트가 도는 그 순간 **한 번만** 봤다
- 그 뒤로는 `animationend` 와 `visibilitychange` 만 들었다

모션이 시작된 뒤 리스너가 붙기 전에 화면이 잠깐 죽었다 살아나면, `visibilitychange` 는 이미
지나갔고 `animationend` 는 영영 안 온다. **이미 굳어 있는지를 붙는 시점에 확인하는 절이 없었다.**

봉합(반쪽이다. 남은 반쪽을 바로 아래 적어 둔다). 붙는 그 시점에 `runningAnimations(el)` 로
"지금 돌고 있는가"를 묻는다. 안 돌고 있으면(`finished` · `idle` · `paused`) 그 자리에서
클래스를 뗀다 — 그 제거가 재계산을 일으켜 굳은 프레임을 푼다. 돌고 있으면 그 모션의
`finished` 를 `allSettled` 로 기다린다.

**닫힌 창과 안 닫힌 창.** 이 물음은 붙는 그 한 순간만 본다. 모션은 160·200ms 인데 이펙트는
한두 프레임 뒤에 붙으므로, 새로 닫힌 것은 앞쪽 0~33ms 뿐이고 나머지 130~200ms 는 여전히
`animationend` 와 `visibilitychange` 둘만 지킨다 — 네 번 다 놓친 그 둘이다. 붙은 **뒤에**
모션이 멎고 복귀 `visibilitychange` 도 안 오면 `finished` 는 영영 안 풀리고 클래스도 영영
안 걷힌다. 다섯 번째가 난다면 그 창이다. 막으려면 연속 두 `requestAnimationFrame` 사이에
`animation.currentTime` 이 움직였는지를 본다 — 벽시계가 아니라 순서다.

**"끝났다는 신호"가 아니라 "안 돌고 있다는 사실"을 쓴다.** 벽시계 금지 결정은 그대로다.
취소도 끝의 한 갈래라 `allSettled` 여야 한다 — 등장 클래스를 떼는 일 자체가 취소다.

### (나) 눌림 — 보호가 한쪽 값에만 걸려 있었다

`useVisibleBand` 에 쓰는 이가 둘인데 관문이 하나에만 있었다.

- `syncSize()`(패널 높이)는 `usableVvHeight` · `shouldWriteVvHeight` · `resumeAllowsShrink` 를 **전부** 지났다
- `sync()`(오버레이 인셋)는 **하나도 안 지나고** `vv.height` 를 날것으로 넣었다
- `resyncPass` 가 `syncSize` 에만 게이트를 걸고 `sync()` 는 두 패스 모두 조건 없이 불렀다

받는 쪽도 열려 있었다. `overlayInsets` 의 `top` 은 상한이 있는데 `bottom` 은 하한만 있었다.
찢어진 스냅샷으로 `vv.height` 가 작게 오면 `bottom` 이 무한정 자라고, 오버레이 content box 가
화면 위쪽 짧은 띠로 쪼그라든다. `items-center` 가 그 띠 안에서 가운데를 잡으니 패널이 위로
붙고 `maxHeight: 100%` 가 본문을 누른다. 가로(`max-w-xs`)는 멀쩡하고 세로만 무너지는 것이 지문이다.

봉합 둘.

1. `bandHeight(height, lastGood, allowShrink)` 하나가 **이 프레임의 띠 높이**를 정하고, 높이도
   인셋도 그 한 값에서 나온다. 거부는 `0` 이 아니라 `lastGood` 으로 답한다 — 인셋이 같은 값을
   써야 팬 프레임마다 합이 안 흔들린다.
2. `overlayInsets` 의 두 항 모두 `[0, innerHeight - height]` 안으로 죈다. 주석이 선언한
   불변식(`top + bottom = innerHeight - height`)을 **양쪽 끝에서 다** 강제한다.

**교훈 한 줄. 보호가 한쪽에만 걸린 값 쌍은 언젠가 갈린다.** 2026-08-29 에 `top` 만 잠갔고,
09-08 에 높이만 관문에 넣었다. 두 번 다 "지금 터진 쪽"만 막았고, 두 번 다 반대쪽이 나중에 터졌다.

### (다) 굳은 `transform` 이 자손 `fixed` 를 가둔다 — 기전은 참, 이번 경로는 아니다

독립 검수가 셋째 가설을 냈다(2026-09-17). `.anim-panel-in` 은 `transform` 을 애니메이트하므로,
그 모션이 굳은 채 남으면 그 패널이 **`position: fixed` 자손의 기준 상자**가 된다. 겹친 모달을
바깥 모달 JSX 안에 렌더하면 안쪽 오버레이가 인셋 산수와 무관하게 바깥 패널 상자에 갇힌다.

**직접 쟀다(puppeteer-core + 로컬 Chrome, 402x812).**

| 배치 | 바깥 모션 | 바깥 패널 `transform` | 안쪽 오버레이 상자 |
|---|---|---|---|
| 형제 | 정상 종료 | `none` | `0,0 402x812`(화면 전체) |
| 형제 | 중간에 굳음 | `matrix(.9979, 0, 0, .9979, 0, .70)` | `0,0 402x812`(화면 전체) |
| 중첩 | 정상 종료 | `none` | `0,0 402x812`(화면 전체) |
| 중첩 | **중간에 굳음** | `matrix(.9979, …)` | **`16,57 369x699` = 바깥 패널 상자** |

**기전은 참이다. 그런데 신고 대상은 중첩이 아니라 형제였다.** `app/(app)/inventory/assets/AssetsClient.tsx`
의 상세 모달(`:1401`, `width="md"`)과 옮기기 모달(`:1701`, `z={260} width="xs"`)은 화면에서 겹쳐
뜨지만 JSX 에서는 `:921` 의 같은 부모 아래 **형제**다. `Modal` 은 포털을 안 쓰므로 DOM 에서도
형제고, 위 표의 첫 두 행이 그 배치다 — 굳어도 안쪽 상자는 화면 전체였다. 앱 껍데기 쪽에도
`transform` 을 건 조상이 없다.

**그래서 (나) 봉합은 여전히 "이번에 발동한 경로"를 막은 것이다.** 지문(가로 320pt 정확 · 세로만
무너짐)도 (나) 쪽에 맞는다 — 중첩 + 굳음에서는 스케일이 걸려 가로가 319 로 나온다.

**그래도 규칙 하나가 남는다. 겹친 모달을 바깥 모달 JSX 안에 렌더하지 않는다.** 지금은 아무 데도
그렇게 안 하고 있지만, 한 번 그렇게 쓰는 순간 위 넷째 행이 된다. 같은 이유로
`app/contract/[tenantId]/ContractView.tsx:1002` 의 "이 모달과 그 조상에 CSS transform 을 절대
걸지 말 것"이 서 있다 — 거기서는 서명 좌표가 어긋나고, 여기서는 기준 상자가 바뀐다. 한 원인이다.

---

## 계측이 이 결함 앞에서 눈을 감았던 이유

오류신고에 화면 계측을 싣기 시작한 것이 2026-09-08 인데, 그 계측은 **네 번째 재현에서도 증거를
못 남겼다.** 화면이 깨진 bf0a6fff 와 멀쩡했던 be42800d 의 계측 블록이 한 글자도 다르지 않았다.

이유는 계측의 결함이 아니라 **사람이 신고하는 순서**였다. 사진을 붙이려면 사진 앱을 다녀와야
하고, 그 왕복이 곧 `visibilitychange` 다. 그것이 `useSettleEntrance` 의 `settle()` 과
`useVisibleBand` 의 `resync()` 를 둘 다 깨운다. **제출 시점에는 화면이 이미 스스로 나아 있다.**

직전 커밋 `c0182100` 이 그것을 고쳤다 — 모달이 뜬 직후에 한 번 재서 들고 있다가(`probeAfterEntrance`)
제출 때 나란히 싣는다(`probeReport`). 그 커밋이 "지금 도는 모션의 `finished` 를 기다린다"는
수법을 먼저 세웠고, 이번 시공이 같은 수법을 등장 마감에도 적용하며 정본
`lib/animationSettled.ts` 한 벌로 합쳤다. **두 벌로 두면 한쪽만 고쳐진다 — 실제로 하루 사이
그 일이 났다.**

읽는 법. 열었을 때의 `등장모션잔존` 이 0 이 아니고 제출할 때 0 이면, 그 사이의 앱 왕복이
화면을 고친 것이다. 그것이 이 병의 지문이다.

---

## 지금 서 있는 그물 넷

| 그물 | 무엇을 본다 |
|---|---|
| `scripts/test-modal-viewport.ts` (68건) | 기하 순수 함수. 팬 불변 · 두 항의 상한 · 높이 위생 · 쓰기 방향 · **관문을 지난 인셋** |
| `scripts/check-kbd-canonical.mjs` | 배선. 정본 호출 · 두 항의 `Math.min` · `bandHeight` 통과 · **`sync` 사거리에 `vv` 접근 금지**(본문을 중괄호 깊이로 자른다) · 계측 배선과 벽시계 금지 |
| `scripts/check-overlay-resume-resync.mjs` | 퇴장 타이머 · 등장 마감. **ref 가 등장 클래스를 단 바로 그 엘리먼트에 붙었는가**(호출도 태그도 전수) · 붙는 시점 확인 · **이름으로 거르는가** · `allSettled` · 벽시계 금지 |
| `scripts/check-overlay-backdrop.mjs` (신설) | 막의 **존재 · 농도 값 · z 순서**. 층 토큰이 실재하는가 · 등장 클래스가 시작 프레임을 붙잡지 않는가 · **등장 모션이 실제로 도는가**(`.anim-X { animation: X <길이> }`) |

**호출 한 줄만 보는 그물은 그물이 아니다.** `check-overlay-resume-resync` 의 등장 절은 여태
`useSettleEntrance(` 라는 글자가 파일에 있기만 하면 통과했다. 네 번째 재현이 날 때까지 초록이었다.

**낱말도 그물이 아니다(독립 검수 2026-09-17).** 날것 금지가 `height:\s*vv\.height` 라는 문자열
하나만 봤고, `Math.round(` 를 한 겹 씌우면 게이트가 전부 초록인 채 결함이 복원됐다. 진리표는
순수 함수만 부르니 훅을 한 줄도 안 지난다. **그래서 1차 방어는 그물이 아니라 구조다** — `sync`
가 `vv` 를 클로저로 안 보고 `(h, offsetTop, innerHeight)` 를 인자로만 받는다. 그물은 그 구조가
되돌려지는 것까지 본다(본문의 `vv.` 접근 · 인자 두 항 · `vv.height` 를 읽는 자리가 하나인가).

**등장 클래스를 쓰면 마감이 있어야 한다 — 오버레이 여부와 무관하다.** 그물이 여태 `fixed
inset-0` 을 같이 요구해서 `app/contract/[tenantId]/ContractView.tsx` 의 원격 알약이 틈에 서
있었다. 거기서 굳으면 막이 남는 게 아니라 **제출 버튼이 통째로 안 보인다** — 506호가 제출 없이
나간 사고와 같은 결말이다. 전제를 뺐고 그 알약에 마감을 붙였다.

### 알려진 공백 — **없다**(2026-09-17 에 마지막 하나를 닫았다)

`check-overlay-backdrop.mjs` 의 `KNOWN_GAPS` 는 지금 빈 목록이다. 목록이 빈 것은 검사가 없다는
뜻이 아니다 — 여덟 오버레이가 전부 세 축(존재·농도·z)과 마감 축을 실제로 지난다.

#### 닫힌 공백 — MergeSheet 의 회복 경로 (2026-09-17)

`MergeSheet` 의 등장은 정본 모션이 아니라 `setTimeout(10ms)` + `transition-opacity` 토글이다.
딤은 `absolute inset-0` 로 전면을 덮고 `onClick={onClose}` 를 달고 있으며, 루트는 `fixed inset-0`
에 `pointer-events` 해제가 없다. **전이가 중간에 멎으면 옅은 막이 화면을 덮고 조작을 먹는다 —
신고 bf0a6fff 와 똑같은 증상이다.** 여덟 중 유일하게 `animationend` 도 `visibilitychange` 도
안 들어 회복 경로가 하나도 없었다. 처음에 이 자리를 "멎으면 반쯤 올라온 시트이지 화면을 먹는
옅은 막이 아니다"라고 적었는데 **그 말이 틀렸고**(독립 검수 2026-09-17에 바로잡음), 운영자가
"회복 경로만 붙인다"로 승인했다(정본 모션으로 갈아타기는 곡선·길이가 바뀌어 디자이너 패스 대상).

**정본을 넓혔다 — 두 벌로 만들지 않았다.** `lib/animationSettled.ts` 의 두 함수는 `@keyframes`
모션만 다뤘다(이름을 `animationName` 으로 읽는다). CSS 전이는 `getAnimations()` 에 `CSSTransition`
으로 잡히고 이름이 `transitionProperty` 라 그 물음에서 빠진다. 같은 수법이 필요하니 같은 정본에
**전이 갈래 하나**를 붙였다 — `stuckTransitions(el)`. 쓰는 이가 하나라 훅(`useSettleTransition`
같은 것)은 따로 세우지 않고 `MergeSheet` 안에서 마감한다.

- 무엇을 듣나. `transitionend`(딤·패널 각각)와 `visibilitychange` 둘. **`shown` 이 참일 때만.**
- 무엇을 하나. **남아 있는데 안 도는 전이를 `cancel()`** 한다. 취소는 효과를 즉시 걷어 계산값이
  클래스가 정한 끝값(`opacity-100` · `translate-y-0`)으로 떨어지고, 그 재계산이 굳은 프레임을
  푼다 — 등장 클래스를 떼는 것과 같은 수법이다.
- **속성으로 안 거른다.** 모션 쪽이 이름으로 거르는 이유(무한 반복 `animate-pulse` 하나가
  `finished` 를 영영 안 내준다)가 전이에는 없다 — 전이는 유한하다. 게다가 Tailwind v4 의
  `translate-y-*` 가 실제로 움직이는 속성은 `transform` 이 아니라 **`translate`** 다(`lib.js` 확인:
  `transition-transform` = `transform, translate, scale, rotate`). 이름으로 걸면 그 이름이 바뀌는
  날 회복이 조용히 죽는다.

**실측(puppeteer-core + 로컬 Chrome, 402x812).** 같은 술어를 브라우저에 심어 넷을 쟀다.

| 국면 | `getAnimations()` | `playState` | `stuckTransitions` | 딤 opacity |
|---|---|---|---|---|
| 전이가 막 생긴 순간 | 1건 | `running`(`pending: true`) | **0** | 0 |
| 정상 종료 뒤 | **0건** | — | **0** | 1 |
| 90ms 에서 멎음 | 1건 | `paused` | **1** | **0.776** |
| 취소 뒤 | 0건 | — | 0 | **1** |

읽는 법 둘. **(1) 정상 경로는 무동작이다** — 끝난 전이는 목록에서 스스로 빠지므로(fill 이 없다)
걷을 것이 없고 `duration-200` 도 기본 easing 도 한 글자 안 바뀐다. **(2) 막 만들어진 전이는
`playState` 가 이미 `running` 이다**(대기 중인 play 작업이 있으면 running 이라는 명세. 대기 여부는
별도 속성 `pending` 이 진다). 그래서 `!== 'running'` 한 줄이 "이제 막 시작한 전이를 걷어 앱의 모든
페이드를 조용히 없애는" 창을 막는다. TS 의 `AnimationPlayState` 에 `'pending'` 이 아예 없다는
사실도 같은 것을 말한다 — 처음에 `!== 'pending'` 를 덧붙였다가 `tsc` 가 "겹치는 값이 없다"로
잡아냈고, 실측이 그 판정을 확인했다.

**남는 한 갈래는 못 막는다(정직하게 적는다).** 전이 객체가 이미 사라지고 계산값도 끝값인데
합성 레이어만 낡은 프레임에 남은 경우는 어떤 읽기로도 감지가 안 된다. 정본의 클래스 제거가 그
경우에 듣는 것은 제거가 **계산값을 실제로 바꾸기** 때문이다. 여기에는 뗄 클래스가 없다. 다만
그 상태는 복귀 시 브라우저가 대개 다시 그린다.

---

## 손댈 때의 순서

1. **쓰는 이 여덟을 다시 센다.** 훅을 고치면 전부 움직인다.
2. **키보드가 뜨는 화면을 먼저 본다.** 인셋에 하한·상한을 걸면 키보드 대응이 깨질 수 있다.
   `test-keyboard-viewport` · `test-modal-viewport` · `check-kbd-canonical` ·
   `check-kbd-collapse-optin` 이 그 축을 진다.
3. **정상 경로가 종전과 픽셀이 같은지 잰다.** 이 축의 수정은 "고장 난 스냅샷에서만 달라지고
   나머지는 한 픽셀도 안 달라진다"가 성공 조건이다.
4. **벽시계를 들이지 않는다.** 시간으로 마감하고 싶어지면 그것이 곧 다섯 번째 재현이다.
5. iOS Safari 와 Android Chrome 은 `visualViewport` 동작이 다르다. 두 엔진 실기 확인이 필요하다
   (`[[mobile-scroll-viewport]]`).
6. **회전 + 키보드 열림 구간을 잰다.** `resyncPass(1)` 은 축소를 거부하므로(`resumeAllowsShrink`)
   그 한 패스에서 인셋이 **낡은 띠 높이**로 계산된다 — 종전에는 인셋이 날것이라 이 구간만은
   맞았다. `pass(2)` 가 바로잡아 한두 프레임이지만, 헤드리스 "정상 경로 픽셀 동일" 표에 이
   구간이 없다(2026-09-17 독립 검수 지적, 미측정). 키보드를 올린 채 회전이 그 자리다.
7. **겹친 모달을 바깥 모달 JSX 안에 렌더하지 않는다.** 위 (다) 를 볼 것 — 굳은 `transform` 이
   자손 `fixed` 의 기준 상자가 된다. 지금은 전부 형제라 안 걸리고, 한 번 안에 넣는 순간 걸린다.

## 관련 노트

[[open-keyboard-field-visibility]] · [[regression-nets]] · [[mobile-scroll-viewport]] · [[design-visual-identity]]
