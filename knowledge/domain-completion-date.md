# 완료 처리 날짜 (2026-09-17)

운영자 원문 — "어제 완료한건데 어제날짜로 완료했다고 입력할 방법이 없네? 이와 비슷한 요청을 한 것
같은데… **뭔가를 완료처리하고 처리 날짜가 기록되는 건은 항상 날짜를 수동으로 입력할 수 있게 해줘.
당연히 디폴트는 현재시간 기준이지만…**"

"비슷한 요청을 한 것 같은데"가 맞다. 같은 병을 이미 두 번 앓았다.

| 때 | 어디 | 무엇이 틀렸나 |
|---|---|---|
| 2026-08-24 | 현금영수증 발행일 | 다섯 저장 경로가 각자 `new Date()` — 클릭한 순간이지 발행한 날이 아니다. 발행 32건 중 29건이 두 날이 달랐다 |
| 2026-09-03 | 보증금 정산일 | 네 경로가 갈려 두 곳이 '오늘'이었다. 413호가 퇴실 09-02인데 기타수익이 09-03에 앉았다 |
| 2026-09-17 | 요청·점검 완료일 | 같은 클래스. 세 번째라 값 결정을 정본 하나로 모았다 |

## 정본

`lib/completionDate.ts`

```
resolveCompletionAt({ picked, existing, column, today, now }): Date
assertNotFuture(ymd, today): { ok: true } | { ok: false; reason: string }
```

- **고른 날 > 기존 값 > 지금.** 고른 날짜가 있고 오늘 이하면 그 날, 없으면 기존 값을 지키고,
  기존 값도 없으면 지금이다. 디폴트가 현재시간이라는 운영자 문장 그대로다.
- **기존 값 보존이 급소다.** 다른 칸만 고쳐 재저장했는데 날짜가 오늘로 밀리면, 그 값으로 세는
  합계·주기가 소리 없이 움직인다. 현금영수증에서 `updatePayment` 이 원래부터 지키던 규칙이다.
- **`column` 은 선택이 아니라 사실이다.** 같은 `'2026-09-16'` 이
  `@db.Date` 칸에서는 `ymdToDbDate`(UTC 자정), 타임스탬프 칸에서는 `kstDateTimeToUtc`(KST 자정)로
  가야 한다. 바꿔 넣으면 하루가 밀리는데 **Vercel(UTC)에서는 맞게 나와** 사람 눈에 안 보인다.
  날짜 변환은 `lib/kstDate` 하나다. 새로 만들지 않는다.
- **미래는 값 결정이 안 막는다.** 부르기 전에 `assertNotFuture` 로 거부한다. 조용한 폴백은
  운영자가 고른 날과 저장된 날을 갈라 놓고 화면은 아무 말도 안 한다.

진리표는 `scripts/test-completion-date.ts` 32케이스(`verify:fast` 등재). **KST 자정 경계를 반드시
포함한다** — `today` 를 UTC 로 뽑으면 KST 00~09시에 운영자가 사는 '오늘'이 미래로 거부된다.

## 사실 자리와 로그 자리를 가른다

| 구별 기준 | 사실 자리 | 로그 자리 |
|---|---|---|
| 뜻 | **언제 일어났나** | **언제 눌렀나** |
| 어제 것을 적을 수 있어야 하나 | 그렇다 | 아니다(누른 시각이 곧 사실) |
| 값 결정 | `resolveCompletionAt` | `new Date()` 가 맞다 |

전수(2026-09-17 기준, 스키마에서 접미사로 뽑은 완료 계열 칸).

| 칸 | 표 | 갈래 | 어디서 받나 |
|---|---|---|---|
| `TenantRequest.resolvedAt` | 요청·컴플레인 | 사실 | /requests 완료 확인 줄 · 입주자 정보 › 요청·컴플레인 탭 · 엑셀 임포트 '해결일' |
| `Checklist.lastCheckedAt` · `ChecklistLog.checkedAt` | 점검 | 사실 | 체크리스트 카드 완료 줄 · 이력·메모 모달 |
| `RoomWork.doneDate` | 작업 | 사실(`@db.Date`) | 작업 행 완료 폼 |
| `RoomCleaning.doneDate` | 청소 | 사실(`@db.Date`) | 청소 행 완료 폼 |
| `LeaseTerm.undoneAt`(단기 연장 JSON) · `ItemNameMergeRun.undoneAt` | 적용취소 | **로그** | 안 묻는다 |

다른 그물이 이미 보는 두 축은 여기서 빼 둔다. 두 그물이 같은 줄을 울면 고치는 사람이 어느 규칙을
따를지 모른다.

- `PaymentRecord.cashReceiptIssuedAt` · `CashReceipt.issuedAt` → [[cash-receipt-refund]] 규칙 20·20-b
- `LeaseTerm.depositReturnDate`(정산일) → `scripts/check-deposit-return-date-axis.mjs`
- `Expense.receivedAt`(자재 수령) → **다음 회차.** 시점별 재고·평균 소모율·재주문 리드타임이 전부
  그 축에 얹혀 있어 따로 다룬다([[domain-inventory]]).

## 화면 문법

세 자리가 같은 문법이다 — 현금영수증 발행일 확인 줄이 정본이다(`PaymentRecordList` 의 `crAskId`).

- 완료 버튼을 누르면 **바로 완료하지 않고 인라인 확인 줄을 편다.** 새 모달을 띄우지 않는다.
- 라벨은 **`완료일`**. `처리일`은 **클릭한 날로 읽힌다** — 보증금 정산일 축 ⓒ 가 이미 같은 이유로
  막았다. /requests 의 정렬 옵션 라벨도 `완료일`로 맞췄다(한 축에 두 이름을 두지 않는다).
- 확인 버튼은 **`완료 기록`**(현금영수증의 `발행 기록` 과 같은 꼴).
- 날짜 칸 껍데기는 **자기 폼 형제와 같은 한 벌**이다(§12). `check-datepicker-shell` 이 강제한다.
- **끄기(적용취소)는 이 줄을 안 거친다.** 날짜가 필요 없다.
- `maxDate={kstYmdStr()}` 로 미래를 못 고르게 한다. 서버 `assertNotFuture` 와 두 겹이다.

## 적용취소 후 재완료에 날짜가 살아남는다

되돌렸다 다시 완료하면 오늘이 박히던 것이 **운영자 불만의 다른 얼굴**이었다. 선례는 현금영수증
토글의 `prevIssuedAt` 반환 + `restoreIssuedAt` 인자다(`setCashReceiptIssued`). 같은 규칙을 둘에 세웠다.

- `unresolveTenantRequest` 가 끄기 전 `resolvedAt` 을 **ISO 문자열로 돌려준다.** 화면이 그것을 들고
  있다가 적용취소 때 `resolveTenantRequest(id, undefined, undefined, prev)` 로 되살린다.
- `deleteChecklistLog`(= 점검 완료의 적용취소)가 지운 로그의 `checkedAt`·`memo` 를 돌려준다.
  적용취소의 적용취소는 `markChecklistDone({ restoreCheckedAt })` 로 **밀리초까지** 되살린다.
- 복원은 날짜 정본을 안 태운다 — 태우면 그 날 자정으로 뭉개져 감사 흔적이 사라진다.

`ChecklistLog` 에는 **수정 문이 없다. 삭제가 곧 적용취소다.** 그 대칭을 깨지 않으려고 날짜는
완료 시점에만 받는다(나중에 고치려면 지우고 다시 기록한다).

## 뒤늦게 적는 점검이 예정일을 앞당기지 않게

지난 점검을 뒤늦게 적을 수 있게 되면서 `Checklist.lastCheckedAt` 이 **뒤로 밀 수 있다.** 9/15에
점검한 항목에 9/10을 적으면 `computeNextDue(lastCheckedAt + intervalDays)` 가 앞당겨져 멀쩡한
항목이 '경과'로 뜬다. 마지막 점검은 언제나 **가장 늦은 로그**다 — `markChecklistDone` 이 기존 값과
비교해 큰 쪽을 남긴다. `deleteChecklistLog` 가 삭제 후 하는 재계산과 같은 규칙이다.

## 감지망

`scripts/check-completion-date-axis.mjs`(`verify:fast` 등재). 기존 시간 그물 셋은 이 클래스를
**안 본다** — `check-ssr-local-now` 는 '오늘 만들기', `check-naive-datetime` 은 '오프셋 없는 일시',
`check-local-midnight-boundary` 는 '창의 양끝'이다. 셋 다 값을 어떻게 만드나만 보고, 운영자에게
물었나는 안 본다. `resolvedAt: new Date()` 는 타임존이 완벽해도 틀린 날을 박는다.

- ⓐ 값 — 완료 계열 칸에 `new Date()`(또는 '지금' 변수)를 박는 자리. **칸 이름은 `schema.prisma` 에서
  접미사로 뽑는다**(`check-naive-datetime` 이 `@db.Date` 명단을 스키마에서 읽는 그 관행).
  **새 완료 칸은 ALLOW 에 없으므로 fail closed 로 걸린다** — 그것이 이 축의 요점이다.
- ⓑ 서버 — 완료 액션 넷과 엑셀 임포트가 미래 가드·값 결정 정본을 지나는가.
- ⓒ 화면 — 완료일 칸과 `maxDate` 가 서 있는가.
- ⓓ 어휘 — 라벨이 `완료일`인가(`처리일` 금지).
- ALLOW 는 로그 자리 둘뿐이고 각각 사유를 적어 둔다. 명단은 최소로 유지한다.

역주입 6종 발화 확인(직접 대입 · '지금' 변수 · 스키마에 없던 새 칸 · 가드 호출만 삭제 ·
`maxDate` 삭제 · 라벨 되돌리기).

## 실측 (2026-09-17, 착수 전)

- 요청·컴플레인 18건 중 **완료 16건**. 완료일과 마지막 수정일이 **다른 날인 것이 9건** — 나중에
  손댄 건이 적지 않다. 목표 처리일이 있는 완료 16건 중 **7건이 목표일을 넘겨** 완료됐다.
  요청일에서 완료일까지 최소 0일 · 중앙 2일 · **최대 33일**. 클릭한 날과 일어난 날이 갈릴 여지가
  실제로 크다.
- 점검 로그 **8건이 전부 2026-05-06 하루**다. 그 뒤로 4개월 넘게 한 번도 안 눌렸다. "매일 누르는
  자리라 묻지 말자"는 반대 논거가 **데이터로는 성립하지 않는다** — 손이 문제가 되는 자리가 아니다.
- 미래로 박힌 완료 날짜는 **전 표 0건**이다(작업 42 · 청소 19 · 퇴실 34 · 재고 점검 839 · 폐기 0 ·
  무상 입수 12). `maxDate` 를 걸어도 기존 데이터와 충돌하지 않는다.

## 미래 봉합 전수

건 자리(2026-09-17). 화면 `maxDate` + 서버 `assertNotFuture` 두 겹.

- 요청 완료 · 점검 완료(신설) · 작업 완료일 · 청소 완료일 · 퇴실일(`moveOutDate` 만)
- 재고 — 점검일 · 보정일 · 점검 수정 · 폐기일 · 입수일 · 무상 입수 수정

안 건 자리와 이유.

- **서류 발급일** — `toolbar-field`/`rc-field` 예외라 네이티브 `input type=date` 이고 지금 구조에
  `maxDate` 를 걸 길이 없다. 미래 발급이 정당한 업무인지도 확인하지 못했다. **운영자 확인 대상.**
- **구매일(지출)** · **자재 수령일(`Expense.receivedAt`)** — 지출·재고 축이라 별건.
- **`app/(app)/tenants/TenantClient.tsx` 의 퇴실일 칸** — 다른 시공자가 잡고 있어 화면을 못 건드렸다.
  서버 가드(`applyStatusTransition`·`checkoutTenant`)는 걸었으므로 **거부는 되지만 달력에서 미래를
  고를 수는 있다.** 그 파일이 풀리면 `maxDate={kstYmdStr()}` 한 줄이 남는다.

## 관련

- [[cash-receipt-refund]] 발행일 축(선례) · [[deposit-return-pending]] 정산일 축 · [[regression-nets]]
