# 호실 도어락 마스터키 — 소유자 전용 암호문 칸과 평문이 나오는 한 길

운영자 요청(2026-10-08): "도어락 마스터키 번호도 입력할 수 있는 항목… 운영자 레벨에서만 열람 및 수정… 그 아래는
항목 자체가 안 보이도록". 같은 날 호실 메모가 프리즘에서 인라인 편집이 됐다([[domain-modal-shell]] 의 호실 면).

## 사실

- 칸은 `Room.doorMasterKeyEnc` 하나다. **평문 금지.** `lib/pii` 의 AES-256-GCM 암호문이고 AAD 가 `room:<방 id>` 다
  (외국인등록번호 `Tenant.foreignRegNoEnc` 와 같은 축, 라벨만 다르다). 키가 없으면 저장이 명시적으로 실패한다.
- 읽기 스코프는 `'security'`(`lib/auth/routeScope`)이고 **소유자(OWNER)만** 통과한다. 관리자(MANAGER)도 막힌다
  (외국인등록번호의 `identity` 보다 한 단 좁다). 막힌 역할에는 **등록 여부도 안 내려간다**: `getRoomDetail` 이
  `doorMasterKeySet: null` 을 보내고 화면은 도어락 절을 아예 안 그린다. 관리자에게 열려면 `READ_SCOPE_DENY` 의
  MANAGER 줄 하나를 지우면 된다.
- 평문이 나오는 길은 `app/(app)/room-manage/masterKeyActions.ts` 의 `revealRoomMasterKey` **하나**다. 값을 돌려주기
  전에 `room_master_key_views` 에 한 줄을 남긴다(`ForeignRegNoView` 거울, 조회 화면은 없다). 프리즘의 [보기] 가
  이 길을 밟고, 드러난 값은 위젯 상태에만 있다가 방 전환·프리즘 닫힘에 사라진다. 복사 버튼은 없다.
- **전역 omit**: `lib/prisma.ts` 가 `omit: { room: { doorMasterKeyEnc: true } }` 로 이 칸을 모든 조회에서 뺀다.
  select 없는 `findMany` 열두 자리(엑셀 내보내기·백업 JSON·호실 목록·수납 목록·계약 데이터 등)에 암호문이 딸려
  나가지 않는 한 줄이다. 그래서 **백업 JSON 에 마스터키가 안 들어가고 복원해도 돌아오지 않는다**(의도: 백업 한 장이
  전 호실 출입 코드가 되면 안 된다). 암호문을 읽는 자리는 명시 select 셋(상세 등록 여부·보기·저장)뿐이다.
- 쓰기는 `updateRoomMasterKey`(빈 값 = 지움, 40자 상한) 하나이고 호실 관리 폼에는 안 들어간다. 적용취소 토큰은
  **이전 암호문**이라 평문이 브라우저에 남지 않고, `undoUpdateRoomMasterKey` 는 `null` 또는 `v1:` 접두어만 받는다.
- 어떤 토스트·오류 문구·`console.*` 에도 값을 싣지 않는다. 액션의 오류는 고정 한국어 문장만 돌려준다(Prisma 오류는
  질의 인자를 찍어 암호문이 문장에 실릴 수 있어 통째로 바꾼다).

## 감지망

- `scripts/check-master-key-axis.mjs`(verify:fast) 일곱 축: ① prisma omit 줄 ② 평문 게터 호출처가 masterKeyActions
  하나 + 열람 기록이 값 반환보다 앞 ③ decryptPii 외부 호출 0 ④ export·import 라우트에 masterKey 0 ⑤ components·
  *Client.tsx 에 doorMasterKeyEnc 0 ⑥ console.* 와 같은 줄 0 ⑦ getRoomDetail 반환에 doorMasterKeyEnc 0.
  2026-10-08 역주입으로 일곱 축 전부 붉어지는 것을 확인했다(주석·호출 없는 import 는 유출이 아니라 넘긴다).
- `scripts/test-room-master-key.ts`(AAD 일치·불일치·변조·빈 값·접두어 19건), `scripts/check-pii-plaintext.ts`(verify:db)
  축 A2 가 rooms 전 행의 암호문 접두어를 본다.

관련: [[privacy-compliance]] · [[property-public-facts]] (권한 절) · [[regression-nets]]
