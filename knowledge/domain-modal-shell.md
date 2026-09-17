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

봉합. 붙는 그 시점에 `runningAnimations(el)` 로 "지금 돌고 있는가"를 묻는다. 안 돌고 있으면
(`finished` · `idle` · `paused`) 그 자리에서 클래스를 뗀다 — 그 제거가 재계산을 일으켜 굳은
프레임을 푼다. 돌고 있으면 그 모션의 `finished` 를 `allSettled` 로 기다린다.

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
| `scripts/check-kbd-canonical.mjs` | 배선. 정본 호출 · 두 항의 `Math.min` · `bandHeight` 통과 · **`overlayInsets` 에 `vv.height` 날것 금지** · 계측 배선과 벽시계 금지 |
| `scripts/check-overlay-resume-resync.mjs` | 퇴장 타이머 · 등장 마감. **ref 가 등장 클래스를 단 바로 그 엘리먼트에 붙었는가** · 붙는 시점 확인 · `allSettled` · 벽시계 금지 |
| `scripts/check-overlay-backdrop.mjs` (신설) | 막의 **존재 · 불투명도 · z 순서**. 층 토큰이 실재하는가 · 등장 클래스가 시작 프레임을 붙잡지 않는가 |

**호출 한 줄만 보는 그물은 그물이 아니다.** `check-overlay-resume-resync` 의 등장 절은 여태
`useSettleEntrance(` 라는 글자가 파일에 있기만 하면 통과했다. 네 번째 재현이 날 때까지 초록이었다.

### 알려진 공백

- `MergeSheet` 의 등장은 정본 모션이 아니라 `setTimeout(10ms)` + `transition-opacity` 토글이다.
  같은 클래스의 위험이지만 고치면 모션 곡선·길이가 바뀌어 웹디자이너 패스가 필요하다.
  `check-overlay-backdrop.mjs` 의 `KNOWN_GAPS` 에 사유와 함께 올라 있다(운영자 결정 대기).

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

## 관련 노트

[[open-keyboard-field-visibility]] · [[regression-nets]] · [[mobile-scroll-viewport]] · [[design-visual-identity]]
