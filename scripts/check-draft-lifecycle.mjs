// 점검 임시저장(드래프트) 수명주기 배선 감지 — 실행: node scripts/check-draft-lifecycle.mjs
//
// 왜 필요한가. 2026-09-14 운영자 신고 — "임시저장 후 실저장을 눌렀는데 임시저장이 남아 있었고,
// 그 뒤 어느 숫자가 임시저장본이고 어느 것이 저장본인지 헷갈렸다". 근원은 기능이 아니라 **침묵**
// 이었다. 위치별 점검 패널의 doSave 가 실패를 setError 로만 적고 그대로 onClose 를 불렀는데,
// 인라인 모드의 onClose 는 화면 전환(changeView)이라 에러가 한 프레임도 안 그려졌다. 실패한
// 품목의 드래프트만 남아 '임시저장 남음' 으로 보였다.
//
// 잡는 것 아홉.
//   ① doSave 의 onClose 는 실패 0 조건 아래에만 선다.
//   ② 드래프트 삭제·저장의 반환값을 읽는다(양 화면 모두).
//   ③ 두 화면(아이템별 폼 · 위치 패널)의 임시저장 분기가 대칭이다.
//   ④ currentLocationBreakdown 이 restockedQty 를 싣는다(죽은 '지난 옮김' 표시의 근원).
//   ⑤ 이중 차감 확인창이 저장 경로에 꽂혀 있다.
//   ⑥ (2026-09-14 6단계) 서브트리 체인 저장의 세 축 — 순차·허브 마지막·이어 붙이기.
//   ⑦ (2026-09-15 '전체') 드래프트 읽기가 위치 수만큼 왕복하지 않는다.
//   ⑧ (2026-09-15 패널 안 옮기기) 완료 핸들러가 두 쌍의 입력·임시저장을 비우고, 적용취소가
//      이동 점검을 지우고 비운 값을 되쓴다.
//   ⑨ (2026-09-15 아이템별 폼 통일) 아이템별 점검 폼이 위치 패널과 같은 축·같은 행 문법·같은
//      저장 경로(서버 패치 접기)를 쓴다. 성공 통지의 주인도 그 폼 하나다.
//      (2026-10-12 2단계) 행 머리 '저장 N' + '그대로'(종전 '옮김 없음'·'저장된 값' 을 합친 한 이름),
//      발끝 고정([취소][임시저장][N곳 저장], form= 으로 폼에 붙는다), 창고 남음 줄은 패널에만(예외).
//      (2단계 검수) 행 머리 낱말은 '저장값 N'(주 버튼 'N곳 저장' 과 겹치지 않게), 키보드가 선 동안 접는 것은
//      정상 창고 요약·임시저장 칩·패널 안내 줄뿐이고 합계 줄·버튼 줄은 접지 않는다.
//   ⑩ (2026-10-19 신고 1daf641c) '채우기 전' 빈칸 해석이 세 화면(아이템별 폼·위치 패널·이력 수정 폼)에서 한 함수
//      (lib/stockLedger calcLocMove)를 저장값과 함께 부른다. 묻는 행(미결)은 저장에 안 싣고 버튼을 막으며, 그 행에
//      자리표시 '0' 이 없고, 안내문이 규칙과 맞고, 서버가 채움 ≤ 잔량·음수를 거부한다.
//
// ⑥ 을 왜 더하나. 트리 뒤로 한 저장이 (품목, 위치) **여러 쌍**을 담는다. 이 셋이 하나라도
// 빠지면 값은 저장되는데 장부가 조용히 틀어진다.
//   · 순차가 아니면(Promise.all) 같은 품목의 칸마다 새 점검이 서고, 그 각각이 직전 점검을
//     base 로 잡아 앞 칸의 실측이 사라진다. 화면에는 '저장됨' 만 뜬다.
//   · 허브 행이 마지막이 아니면 허브 실측을 먼저 쓰고 그 위에서 다시 차감해 이중으로 빠진다.
//   · 이어 붙이기(chainIds)가 없으면 두 번째 칸이 props 의 stale 한 lastCheckId 를 다시 집는다.
import { readFileSync } from 'node:fs'

const client   = readFileSync('app/(app)/inventory/InventoryClient.tsx', 'utf8')
const actions  = readFileSync('app/(app)/inventory/actions.ts', 'utf8')
const overview = readFileSync('app/(app)/inventory/overview.ts', 'utf8')
const merge    = readFileSync('lib/stockCheckMerge.ts', 'utf8')

const fails = []
const need = (name, cond, hint) => { if (!cond) fails.push(`${name}${hint ? ` — ${hint}` : ''}`) }

// 함수 하나만 잘라 본다 — 파일 전체로는 형제 함수의 코드가 섞여 판정이 무의미해진다.
function fnBody(src, header, from = 0) {
  const start = src.indexOf(header, from)
  if (start < 0) return ''
  let i = src.indexOf('{', start + header.length - 1)
  if (i < 0) return ''
  let depth = 0
  for (let j = i; j < src.length; j++) {
    if (src[j] === '{') depth++
    else if (src[j] === '}') { depth--; if (depth === 0) return src.slice(start, j + 1) }
  }
  return ''
}
const before = (s, a, b) => s.indexOf(a) >= 0 && s.indexOf(b) >= 0 && s.indexOf(a) < s.indexOf(b)
// 최상위 함수 한 채를 통째로 잘라 본다. fnBody 는 헤더 뒤 첫 '{' 를 몸통으로 잡는데, 이 함수들은
// 그 자리가 props **타입 주석**이라 타입만 잘려 나온다(판정이 통째로 무의미해진다).
// 두 화면의 행 문법 축(③·④·⑧·⑨)이 화면별로 세야 해서 맨 위에서 한 번 자른다.
function topFn(src, header) {
  const start = src.indexOf(header)
  if (start < 0) return ''
  const end = src.indexOf('\nfunction ', start + header.length)
  return end < 0 ? src.slice(start) : src.slice(start, end)
}
const itemForm = topFn(client, 'function CheckForm({ item, lastCheckBreakdown')
const locPanel = topFn(client, 'function LocationBatchCheckModal({ rows, onClose')

// ── ① 실패하면 닫지 않는다 ─────────────────────────────────────────
const doSave = fnBody(client, "const doSave = async (forceMerge?: boolean, dupDecision?: 'keep' | 'skip') => {")
need('doSave 를 찾음', doSave.length > 0)
need('doSave 가 onClose 를 한 번만 부른다',
  (doSave.match(/onClose\(\)/g) ?? []).length === 1,
  '닫는 자리가 둘이면 한쪽이 조건을 비껴간다')
// 체인이 멈춘 그 한 행을 실패 목록으로 세운다 — 뒤 행은 아예 시도하지 않았으므로 실패가 아니다.
// 반환 타입이 줄을 넘기므로 화살표 뒤 여는 괄호를 머리로 삼는다 — 타입 리터럴의 중괄호를
// 본문으로 오인하면 슬라이스가 한 줄짜리가 되고 아래 검사가 전부 거짓으로 통과한다.
need('runChain 선언을 찾음',
  /const runChain = async \(units: LocSaveUnit\[\], forceMerge: boolean, doneBefore: number, total: number, deferShort = false\):/.test(client))
const runChain = fnBody(client, "    Promise<{ stopped: 'hubShort' | 'failed' | null; done: number }> => {")
need('runChain 본문을 찾음', runChain.length > 200)
need('저장 실패 행을 목록으로 세운다',
  /setSaveFailed\(\[\{ id: locPairKey\(u\.r\.id, u\.locId\), label, error: humanError\(res\.error/.test(runChain))
need('멈춘 자리를 남긴다',
  /setSaveProgress\(\{ done, total, stoppedAt: label \}\)/.test(runChain),
  '비원자 저장이라 어디까지 갔는지를 말하지 않으면 무엇을 다시 눌러야 하는지 알 수 없다')
// §27.2 이중 통지 금지 — 채널은 인라인 하나다. 저장 실패에 토스트를 다시 얹으면 같은 사건을
// 두 번 알리는 것이고, 사라지는 토스트는 다시 시도할 자리를 못 남긴다(§18 영속·리스트형).
need('저장 실패를 토스트로 알리지 않는다',
  !/pushToast\('error'/.test(doSave) && !/pushToast\('error'/.test(runChain),
  '실패 채널은 버튼 줄 위 고정 영역의 인라인 목록 하나다')
need('실패가 있으면 닫지 않고 끝낸다',
  /if \(out\.stopped === 'failed' \|\| cleanupRef\.current\.length > 0\) return/.test(doSave),
  'return 이 없으면 그대로 닫힌다')
need('실패 분기가 onClose 앞에 있다',
  before(doSave, "if (out.stopped === 'failed' || cleanupRef.current.length > 0) return", 'onClose()'),
  '뒤에 있으면 실패해도 패널이 먼저 닫힌다(이 신고의 근원)')
need('실패가 있어도 성공분은 반영한다',
  before(doSave, 'onDone()', "if (out.stopped === 'failed' || cleanupRef.current.length > 0) return"))
need('오류 문구는 humanError 를 탄다',
  (runChain.match(/humanError\(/g) ?? []).length === 2,
  '영어 프레임워크 메시지가 한국어 폴백을 이기고 화면에 뜬다')
need('허브 부족이면 체인을 멈추고 모달을 유지한다',
  /setHubShortQueue\(\[\{/.test(runChain) && /return \{ stopped: 'hubShort', done \}/.test(runChain) &&
  /if \(out\.stopped === 'hubShort'\) return/.test(doSave))
need('허브 부족은 나머지 행을 버리지 않는다',
  /restUnitsRef\.current = units\.slice\(i \+ 1\)/.test(runChain),
  '버리면 팝업을 처리한 뒤 아래 칸의 실측이 조용히 사라진다')
// 허브 부족 팝업이 마감할 때도 같은 규칙을 탄다 — 여기만 무조건 닫으면 실패가 다시 사라진다.
const hubResolved = fnBody(client, 'const onHubShortResolved = async () => {')
need('onHubShortResolved 를 찾음', hubResolved.length > 0)
need('팝업 처리 뒤 체인을 이어 달린다',
  /await runChain\(rest, chainCtxRef\.current\.forceMerge, done, chainCtxRef\.current\.total\)/.test(hubResolved))
need('팝업 마감도 실패 0 일 때만 닫는다',
  before(hubResolved, "if (out.stopped === 'failed' || cleanupRef.current.length > 0) return", 'onClose()'))
// 실패 목록은 **스크롤 밖 고정 영역**이다 — 스크롤 안에 두면 품목이 열일 때 뷰포트 밖으로 밀린다.
need('패널에 실패 목록이 그려진다',
  /\{saveFailed\.length > 0 && \(/.test(client) && /\{saveFailed\.map\(f => \(/.test(client))
need('패널에 정리 실패 안내가 그려진다', /\{draftCleanupFailed\.length > 0 && \(/.test(client))
need('실패 영역이 스크롤 밖 shrink-0 이다',
  /\{\(saveFailed\.length > 0 \|\| draftCleanupFailed\.length > 0 \|\| \(saveProgress && saveProgress\.stoppedAt !== ''\) \|\| error\) && \([\s\S]{0,120}?shrink-0/.test(client),
  '스크롤 컨테이너 안에 있으면 10행에서 뷰포트 밖으로 밀린다')
// 달리는 중(stoppedAt === '')에는 이 영역을 아예 세우지 않는다 — 인라인 패널은 스크롤 컨테이너가
// 없어 '고정 영역' 이 문서 흐름이라, 진행 박스가 서면 발끝 버튼을 아래로 밀어낸다. 진행은 §29
// 진행형 하나(버튼 라벨 '저장 중… n/N')로만 말한다.
need('멈춘 자리 안내가 같은 고정 영역에 그려진다',
  /\{saveProgress && saveProgress\.stoppedAt !== '' && \(/.test(client))
need('달리는 중 진행 박스를 따로 세우지 않는다',
  !/저장 중 · <span className="tabular-nums">/.test(client),
  "박스와 버튼 라벨이 같은 상태를 두 문형으로 말하고, 박스가 발끝 버튼을 민다")
need('진행은 버튼 라벨의 §29 진행형 하나다',
  /저장 중… <span className="tabular-nums">\{saveProgress\.done\}\/\{saveProgress\.total\}<\/span>/.test(client))
need('실패 문안이 남은 임시저장 유무로 갈린다',
  /saveFailed\.some\(f => rowDrafts\[f\.id\] != null\)/.test(client),
  "드래프트가 없는데 '임시저장은 그대로 남아 있습니다' 는 거짓이다")
need('정리 실패 문안이 목록을 문장 끝에 둔다',
  /실패한 행이 있습니다\. \{draftCleanupFailed\.join\(', '\)\}\./.test(client),
  '라벨 뒤에 조사를 붙이면 이름에 따라 는/은 이 갈린다')

// ── ② 삭제·저장 반환값을 읽는다 ────────────────────────────────────
// 체인은 **순차**다. 병렬로 쏘면 같은 품목의 칸마다 새 점검이 서고 그 각각이 직전 점검을
// base 로 잡아 앞 칸의 실측이 사라진다 — 저장은 성공하고 장부만 틀어지는 종류의 결함이다.
need('저장이 순차 체인이다',
  /for \(let i = 0; i < units\.length; i\+\+\)/.test(runChain) && /await saveUnit\(u, forceMerge/.test(runChain),
  '병렬이면 같은 품목의 칸마다 새 점검이 서서 앞 칸의 실측이 사라진다')
need('저장 경로에 병렬 발사가 없다',
  !/Promise\.all(Settled)?\([^\n]*saveUnit/.test(client),
  '한 품목의 여러 칸은 같은 점검에 차례로 얹혀야 한다')
need('한 행씩 드래프트를 정리한다',
  /const del = await deleteStockCheckDraft\(u\.r\.id, u\.locId\)\.catch\(\(\) => \(\{ ok: false as const, error: '' \}\)\)/.test(runChain))
need('삭제 반환값을 실제로 검사한다',
  /if \(del\.ok\) cleanedKeysRef\.current\.add\(locPairKey\(u\.r\.id, u\.locId\)\)/.test(runChain) &&
  /else cleanupRef\.current\.push\(label\)/.test(runChain),
  'deleteStockCheckDraft 는 { ok:false } 를 돌려줄 수 있다')
need('검사 안 하는 드래프트 삭제가 남아 있지 않다',
  !/await Promise\.all\((savedOk|units)\.map\([^\n]*deleteStockCheckDraft/.test(client) &&
  !/^\s*(await|void) deleteItemDrafts\(/m.test(client),
  '반환값을 안 읽으면 정리 실패가 그대로 다음 진입의 유령 임시저장이 된다')
const clearAfterSave = fnBody(client, 'const clearDraftsAfterSave = async () => {')
need('아이템별 폼의 저장 후 정리가 정본 한 곳이다', clearAfterSave.length > 0)
need('그 정본이 반환값을 읽는다', /if \(!del\.ok\)/.test(clearAfterSave))
const clearDraft = fnBody(client, 'const handleClearDraft = () => {')
need('아이템별 비우기도 반환값을 읽는다', /if \(!res\.ok\) \{ pushToast\('error', res\.error\); return \}/.test(clearDraft))

// ── ③ 두 화면의 임시저장 분기가 대칭 ───────────────────────────────
const itemDraft = fnBody(client, 'const handleSaveDraft = () => {')          // 아이템별 폼
const locDraft  = fnBody(client, 'const handleSaveDraft = async () => {')    // 위치 패널
need('아이템별 임시저장을 찾음', itemDraft.length > 0)
need('위치별 임시저장을 찾음', locDraft.length > 0)
need('아이템별은 실패면 성공 토스트를 안 띄운다',
  before(itemDraft, "if (!res.ok) { pushToast('error', res.error); return }", "pushToast('success', '임시저장됨')"))
need('위치별도 실패면 성공 토스트를 안 띄운다',
  before(locDraft, 'if (failed.length > 0)', "pushToast('success', `${units.length}건 임시저장됨`)"),
  '형제가 갈리면 한쪽만 조용히 거짓말을 한다')
need('위치별은 실패면 칩·시각을 안 세운다',
  before(locDraft, 'if (failed.length > 0)', 'setLocDraftSavedAt(savedAt)'))
need('위치별 임시저장이 반환값을 읽는다',
  /const okFlags = settled\.map\(s => s\.status === 'fulfilled' && s\.value\.ok\)/.test(locDraft))
// 비우기 — 두 화면 모두 같은 자리·라벨, 확인창 없이.
need('위치 패널에도 임시저장 비우기가 있다',
  /const handleClearLocDrafts = async \(\) => \{/.test(client) &&
  /onClick=\{\(\) => \{ void handleClearLocDrafts\(\) \}\}/.test(client))
need('비우기 라벨이 두 화면에서 같다', (client.match(/>비우기<\/button>/g) ?? []).length === 2)
// 히트영역 — 글자만이면 27x13px 이다. §25 유사요소 확장을 두 화면 모두에.
need('비우기 히트영역이 두 화면 모두 44px 로 넓혀져 있다',
  (client.match(/before:absolute before:content-\[''\] before:-inset-x-3 before:-inset-y-\[15px\]/g) ?? []).length === 2)
const clearLoc = fnBody(client, 'const handleClearLocDrafts = async () => {')
need('위치 비우기도 반환값을 읽는다', /if \(okFlags\.some\(v => !v\)\)/.test(clearLoc))
// 일괄 비우기는 확인창 + 적용취소다(운영자 결정 2026-09-14). 아이템별 폼(1품목)은 즉시 —
// 규모가 달라서지 형제가 갈린 것이 아니다.
need('위치 일괄 비우기는 §14 확인창을 거친다',
  /await confirmDialog\(\{/.test(clearLoc) && /level: 'caution'/.test(clearLoc) && /confirmLabel: '비우기'/.test(clearLoc),
  '여러 품목이 한 번에 사라지는 동작이다 — 묻지 않으면 되돌릴 자리도 없다')
need('확인창 제목이 물음형이다', /임시저장을 비울까요\?/.test(clearLoc))
need('취소는 무해하다', /if \(!ok\) return/.test(clearLoc))
need('비운 뒤 §16 적용취소를 노출한다',
  /pushToast\('success', '임시저장 비움', \{[\s\S]{0,120}?action: \{ label: '적용취소', run:/.test(clearLoc),
  '적용취소 없이 지우면 6초 안에 되돌릴 길이 사라진다')
need('되돌릴 값을 지우기 전에 붙잡는다',
  before(clearLoc, 'const snapshot = (await getLocationDraftsFor(snapLocIds)', 'deleteStockCheckDraft(t.itemId, t.locId)'),
  '지운 뒤에는 서버에 물어볼 자리가 없다')
need('적용취소가 붙잡은 값을 그대로 되쓴다',
  /Promise\.allSettled\(snapshot\.map\(d => saveStockCheckDraft\(\{/.test(clearLoc))
need('되쓰기 실패를 삼키지 않는다', /if \(failedBack > 0\)/.test(clearLoc))
need('되돌린 뒤 칩·행 캡션·배지를 다시 세운다',
  /setRowDrafts\(restored\)/.test(clearLoc) && /setLocDraftSavedAt\(latest\)/.test(clearLoc) &&
  (clearLoc.match(/onDraftChange\?\.\(\)/g) ?? []).length >= 2)
// 행 단위 표시 — 어느 숫자가 임시저장본인지 행마다 말한다.
need('행 캡션 기준값을 들고 있다', /const \[rowDrafts, setRowDrafts\] = useState</.test(client))
need('행 캡션이 3상태로 갈린다',
  /rowDraftEdited\s*\n?\s*\? '임시저장 후 수정됨'/.test(client) && /`임시저장 \$\{fmtTime\(new Date\(rowDraft\.savedAt\)\)\}`/.test(client))
need('행 캡션이 정본 Badge 다',
  /<Badge tone="inspect">\s*\n?\s*\{rowDraftEdited/.test(client),
  '손 배지를 다시 그리면 같은 사실을 말하는 형제와 모양이 갈린다')
need('재진입 복원본을 기준 스냅샷으로 시딩한다',
  /const restoredOnly = locDraftSavedAt != null && locDraftSnapRef\.current == null/.test(client) &&
  /if \(restoredOnly\) locDraftSnapRef\.current = curSnap/.test(client),
  '안 세우면 판정식이 영원히 거짓이라 재진입 뒤 3상태가 안 뜬다')
need('행 캡션에 좌측 립이 없다', !/border-left[^\n]*inspect/.test(client), '§18 — 립은 예외 상태 전용이다')
need('getLocationDrafts 가 savedAt 을 함께 돌려준다',
  /trackedItemId, data: \{ before: v\.before, after: v\.after, savedAt: v\.savedAt \}/.test(actions),
  '시각이 없으면 행 캡션이 "언제"를 말할 수 없다')
// 2단계(2026-10-12) — 회색 참고줄 상자를 걷고 저장값은 행 머리 오른쪽 '저장값 N'(12px tnum)이 말한다
// (검수 10 — '저장 N' 은 발끝 주 버튼 'N곳 저장' 의 동사와 겹쳤다). 축은 그대로다: 저장본을 '직전' 이 아니라
// '저장' 계열로, 두 화면이 같은 말로.
need("행 머리가 저장값을 '저장값 N' 이라고 말한다(두 화면)",
  (itemForm.match(/>저장값 <strong/g) ?? []).length === 1 && (locPanel.match(/>저장값 <strong/g) ?? []).length === 1 &&
  !/>직전 잔량 <strong/.test(client) && !/>저장된 잔량 <strong/.test(client),
  "'직전'은 임시저장본과 구별이 안 된다 — 두 화면 모두 같은 말이어야 한다")

// ── ④ 죽은 '지난 옮김' 표시를 살린다 ───────────────────────────────
need('currentLocationBreakdown 이 restockedQty 를 싣는다',
  /const restockedOf = new Map<string, number>\(\)/.test(overview) &&
  /\.\.\.\(rq != null \? \{ restockedQty: rq \} : \{\}\)/.test(overview),
  '안 실으면 소비처 두 곳이 항상 undefined 라 이중 차감 신호가 구조적으로 안 뜬다')
need('마커는 표시 전용이다 — 잔량 맵(cur)에 안 들어간다',
  !/cur\.set\([^\n]*restocked/.test(overview))
// 한 줄에 같은 +N 이 두 번 뜨지 않게 축을 가른다 — 저장본 대 이번 입력.
// 낱말은 채움 계열이다(2단계 낱말 한 벌 — '옮김' 은 별개 기능인 위치 이동과 겹친다).
need('소비처 두 곳이 같은 문구다',
  (itemForm.match(/저장된 채움 <strong/g) ?? []).length === 1 && (locPanel.match(/저장된 채움 <strong/g) ?? []).length === 1 &&
  !/저장된 옮김( <strong|\{)/.test(client) && !/· 지난 옮김/.test(client) && !/이 점검에 반영된 옮김/.test(client))
// 아이템별 폼은 행 + 발끝 합계 줄 둘, 패널은 행 하나. 저장본(저장된 채움)과 한 줄에 같은 +N 이 두 번 뜨지 않게
// 이번 채움은 행 머리에 선다. 발끝 합계 줄은 360px 미만에서 앞말 '이번'을 뗀다(2026-10-19, 한 줄 유지).
need('이번 채움 축이 두 곳 다 갈렸다',
  (itemForm.match(/>이번 채움 <strong/g) ?? []).length === 1 &&
  (itemForm.match(/<span className="max-\[359px\]:hidden">이번 <\/span>채움 <strong/g) ?? []).length === 1 &&
  (locPanel.match(/>이번 채움 <strong/g) ?? []).length === 1 &&
  !/>이번 (입력|옮김) <strong/.test(client) && !/>창고에서 <strong/.test(client))

// ── ⑤ 이중 차감 물음 ───────────────────────────────────────────────
const dupFn = fnBody(client, 'const doubleRestockOf = (r: InventoryRow, lid: string, forceMerge?: boolean) => {')
need('이중 차감 판정 함수를 찾음', dupFn.length > 0)
need('마커가 있을 때만 묻는다', /if \(prevRestocked <= 0\) return null/.test(dupFn))
need('보충이 계산될 때만 묻는다', /if \(restocked <= 0\) return null/.test(dupFn))
need('머지되는 저장에서만 묻는다',
  /if \(!\(date === kstYmdStr\(\) && \(forceMerge \|\| \(sameDay && within6h\)\)\)\) return null/.test(dupFn),
  '새 점검으로 저장되면 마커가 안 겹쳐 물을 일이 없다')
need('저장 경로에 물음이 꽂혀 있다',
  /const dups = units\.filter\(u => doubleRestockOf\(u\.r, u\.locId, forceMerge\) != null\)/.test(doSave) &&
  /if \(dups\.length > 0 && !dupDecision\) \{ setDupUnits\(dups\); return \}/.test(doSave))
need('행마다 모달을 띄우지 않는다',
  !/confirmDialog/.test(doSave),
  '행 수만큼 모달을 연타하면 묻는 것이 아니라 막는 것이 된다')
need('물음은 형제 바와 같은 자리의 인라인 바다',
  /\{dupUnits\.length > 0 && \(/.test(client) &&
  /border-t border-\[var\(--honey\)\]\/40 bg-\[var\(--honey\)\]\/10 px-5 py-3 shrink-0 space-y-2/.test(client))
// 낱말은 채움 계열이다(2단계 검수 7 — 점검 중 창고에서 빼 오는 일은 '채움', '옮김' 은 위치 이동).
need('제목이 물음형이고 라벨 뒤 조사가 없다',
  /이미 채운 기록이 있습니다\. 더 채울까요\?/.test(client) && !/더 옮길까요|더 옮긴 것으로 저장/.test(client))
need('대상 목록이 §14 영향 목록 박스 문법이다',
  /<li key=\{locPairKey\(u\.r\.id, u\.locId\)\} className="text-\[12\.5px\] text-\[var\(--ink-s\)\]">/.test(client) &&
  /font-semibold" style=\{\{ fontFeatureSettings: "'tnum'" \}\}/.test(client))
need('두 갈래가 인자로 흐른다(상태 지연 함정 회피)',
  /doSave\(mergeChoice === 'merge', 'skip'\)/.test(client) &&
  /doSave\(mergeChoice === 'merge', 'keep'\)/.test(client))
need("'빼고 저장'은 그 행만 뺀다",
  /const skip = dupDecision === 'skip' \? new Set\(dups\.map\(u => locPairKey\(u\.r\.id, u\.locId\)\)\) : new Set<string>\(\)/.test(doSave) &&
  /units = units\.filter\(u => !skip\.has\(locPairKey\(u\.r\.id, u\.locId\)\)\)/.test(doSave),
  '저장 전체를 중단시키면 나머지 행의 실측이 버려진다')
need('다 빠지면 조용히 끝나지 않는다',
  /if \(units\.length === 0\) \{ setError\('저장할 행이 없습니다\.'\); return \}/.test(doSave))
need('서버 규칙은 안 건드렸다 — 물음은 클라이언트에만 있다',
  !/doubleRestockOf|더 채울까요|더 옮길까요/.test(actions))

// ── ⑥ 서브트리 체인 저장 (2026-09-14 6단계) ────────────────────────
// 저장 단위는 (품목, 위치) 쌍이다. 셋 다 값 대조로는 안 잡히는 축이다.
const buildUnits = fnBody(client, '  const buildUnits = (dirtyOnly = true): LocSaveUnit[] => {')
need('저장 단위를 만드는 자리를 찾음', buildUnits.length > 0)
// 2026-09-15 '전체' — 범위가 두 갈래다. 고른 칸이면 그 서브트리, '전체'면 숲 전체(목록 그대로).
need('점검 대상이 서브트리 전체(또는 숲 전체)다',
  /const scope = isAll \? locs : locId \? locSubtree\(locs, locId\) : \[\]/.test(client),
  '고른 칸만 담으면 트리를 만든 이유가 사라진다')
need('허브 행이 체인의 마지막이다',
  /return units\.sort\(\(a, b\) => \(a\.isHubUnit \? 1 : 0\) - \(b\.isHubUnit \? 1 : 0\)\)/.test(buildUnits),
  '허브 실측을 먼저 쓰면 그 위에서 다시 차감돼 이중으로 빠진다')
const saveUnit = fnBody(client, '  const saveUnit = async (u: LocSaveUnit, forceMerge: boolean, opts?: { allowHubClamp?: boolean; forceNew?: boolean }) => {')
need('saveUnit 을 찾음', saveUnit.length > 0)
need('같은 품목의 두 번째 칸부터 이어 붙인다',
  /const chained = chainIdsRef\.current\.get\(u\.r\.id\) \?\? null/.test(saveUnit) &&
  /const targetId = chained \?\? u\.r\.lastCheckId/.test(saveUnit),
  'props 의 stale 한 lastCheckId 를 다시 집으면 칸마다 새 점검이 선다')
need('이어 붙일 점검 id 를 실제로 기억한다',
  (saveUnit.match(/chainIdsRef\.current\.set\(u\.r\.id/g) ?? []).length === 2,
  '머지 경로와 생성 경로 둘 다 기억해야 세 번째 칸이 갈리지 않는다')
need('같은 저장에 허브 실측이 있을 때만 부족 게이트를 건너뛴다',
  /clampRef\.current = new Set\(units\.filter\(u => \{/.test(doSave) &&
  /if \(u\.isHubUnit\) return false/.test(doSave) &&
  /return hubId != null && \(measuredHubs\.get\(u\.r\.id\)\?\.has\(hubId\) \?\? false\)/.test(doSave),
  '조건 없이 통과시키면 쌀 사건의 조용한 0 클램프가 되살아난다')
need('클램프 판정이 서버로 실제로 간다',
  /allowHubClamp: clampRef\.current\.has\(locPairKey\(u\.r\.id, u\.locId\)\)/.test(runChain))
need('저장 memo 는 고른 루트의 표기 경로다(전체는 접두 패턴 밖 문자열)',
  /memo: isAll \? '전체 위치 점검' : `위치별 점검 \(\$\{selectedLoc\?\.pathName \?\? ''\}\)`/.test(saveUnit),
  "memo 는 저장 문자열이자 백필 매칭 키다 — 평면 이름이면 같은 이름의 칸이 둘일 때 복원할 수 없고, '전체'를 괄호 안에 넣으면 '전체'라는 위치가 생기는 순간 백필이 그 칸으로 오인한다")
need('임시저장 복원이 범위 전체를 읽는다',
  /const ids = \(locId === ALL_LOCATIONS \? locsRef\.current : locSubtree\(locsRef\.current, locId\)\)\.map\(n => n\.id\)/.test(client),
  '한 칸만 읽으면 아래 칸에 임시저장한 값이 사라진 것처럼 보인다')

// ── ⑦ 드래프트 읽기가 위치 수만큼 왕복하지 않는다 (2026-09-15 '전체') ──────────────
// getLocationDrafts 는 위치 하나에 쿼리 2개다. 위치마다 부르면 '전체'(18칸)에서 36 왕복이 되고,
// 위치를 늘릴수록 선형으로 는다. 한 번에 읽는 getLocationDraftsFor 로 고정한다(쿼리 2개).
const locEffect = (() => {
  const from = client.indexOf('  useEffect(() => {\n    if (!locId) return')
  if (from < 0) return ''
  const to = client.indexOf('}, [locId])', from)
  return to < 0 ? '' : client.slice(from, to)
})()
need('위치 선택 effect 를 찾음', locEffect.length > 0)
need('드래프트 읽기가 위치마다 왕복하지 않는다',
  !/\.map\([\s\S]{0,120}?getLocationDrafts\(/.test(locEffect),
  "'전체'는 위치 수 × 2 회 왕복이 된다 — 위치 목록을 통째로 넘기는 한 호출로 읽는다")
need('한 번에 읽는 액션을 부른다',
  /getLocationDraftsFor\(ids\)/.test(locEffect))
// 비우기 적용취소의 스냅샷도 같은 축이다 — 여기만 위치마다 돌면 '전체'에서 비우기 한 번에
// 36 왕복이 되고, 그 왕복이 끝나야 삭제가 시작된다.
need('비우기 스냅샷도 한 호출로 읽는다',
  /getLocationDraftsFor\(snapLocIds\)/.test(clearLoc) && !/getLocationDrafts\(/.test(clearLoc),
  '되돌릴 값을 붙잡는 자리가 위치 수만큼 왕복하면 비우기가 그만큼 늦어진다')
need('그 액션이 쿼리 두 개다',
  /export async function getLocationDraftsFor\(/.test(actions) &&
  /const \[locRows, nullRows\] = await Promise\.all\(\[\s*\n\s*prisma\.stockCheckDraft\.findMany\(\{ where: \{ locationId: \{ in: locationIds \}/.test(actions),
  '안에서 위치마다 도는 순간 호출부만 한 줄이고 왕복 수는 그대로다')

// ── ⑧ 패널 안 옮기기 (2026-09-15) ──────────────────────────────────
// 옮긴 순간 그 두 쌍(품목×출발지, 품목×도착지)의 **미저장 입력은 무효**다. 점검 시점 정렬은
// 옮김이 점검 전이든 후든 정합인데, 깨지는 경우가 딱 하나 있다 — '옮기기 전에 센 값을 옮긴 뒤에
// 저장'. 화면이 그 한 경우를 막지 않으면 값은 저장되고 장부만 조용히 틀어진다(⑥ 과 같은 종류).
// 비우기만 하고 되돌릴 길이 없으면 그것대로 사고이므로 적용취소까지 한 벌로 본다(§16).
const tDone = fnBody(client, 'const handleTransferDone = async (res: TransferDone) => {')
need('패널 이동 완료 핸들러를 찾음', tDone.length > 0)
need('완료 핸들러가 두 쌍을 대상으로 삼는다',
  /locId: res\.fromId/.test(tDone) && /locId: res\.toId/.test(tDone),
  '출발지만 비우면 도착지 칸에 옮기기 전에 센 값이 남는다')
need('완료 핸들러가 두 칸의 입력값을 지운다',
  /setBeforeQtys\(dropKeys\)/.test(tDone) && /setAfterQtys\(dropKeys\)/.test(tDone),
  '화면 입력을 그대로 두면 그 값이 다음 저장에서 옮긴 뒤의 실측으로 박힌다')
need('완료 핸들러가 그 쌍의 서버 임시저장도 지운다',
  /deleteStockCheckDraft\(p\.itemId, p\.locId\)/.test(tDone),
  '화면만 비우면 다음 진입에서 옮기기 전의 값이 되살아난다')
need('임시저장 삭제 반환값을 읽는다',
  /const okFlags = settled\.map\(s => s\.status === 'fulfilled' && s\.value\.ok\)/.test(tDone))
// 스냅샷은 **서버에서** 읽는다. 메모리 rowDrafts 는 지금 범위의 쌍만 담는데 지우기는 (품목, 위치)
// 키로 무조건 가므로, 범위 밖 도착지 드래프트는 지워지기만 하고 되돌릴 값이 없었다.
need('지우기 전에 스냅샷을 잡는다',
  before(tDone, 'const serverDrafts = await getLocationDraftsFor([res.fromId, res.toId])', 'deleteStockCheckDraft('),
  '지운 뒤에는 서버에 물어볼 자리가 없다')
need('스냅샷이 범위 밖 도착지까지 서버에서 읽는다',
  /getLocationDraftsFor\(\[res\.fromId, res\.toId\]\)/.test(tDone) && !/draft: rowDrafts\[/.test(tDone),
  '메모리 rowDrafts 로 잡으면 범위 밖 도착지 드래프트는 지워지고 되돌릴 값이 없다')
// 이동 점검은 같은 날·6시간 안이면 뒤따르는 위치 점검의 머지 대상이다 — 그대로 지우면 그 위에
// 얹힌 실측까지 사라진다. 기대값 셋을 되넘겨 '내가 만든 그 점검 그대로' 일 때만 지운다.
need('적용취소가 이동 점검을 지운다',
  /deleteStockCheck\(res\.checkId, \{ createdAtMs: res\.createdAtMs, rowCount: res\.rowCount, markerSum: res\.markerSum \}\)/.test(tDone),
  '이동은 점검으로 기록된다 — 그 점검을 지우는 것이 적용취소다(§16), 단 얹힌 점검이 없을 때만')
need('적용취소가 옮긴 뒤 새로 적은 입력을 덮지 않는다',
  (tDone.match(/if \(\(n\[s\.k\] \?\? ''\) === ''\) n\[s\.k\] = s\.(before|after)/g) ?? []).length === 2,
  '6초 사이에 새로 센 값이 옮기기 전 값으로 되돌아간다')
need('적용취소가 §16 토스트 액션에 달려 있다',
  /action: \{ label: '적용취소', run: \(\) => \{ void \(async \(\) => \{/.test(tDone))
need('적용취소가 있었던 임시저장만 되쓴다',
  /const had = snapshot\.filter\(s => s\.draft != null\)/.test(tDone) && /saveStockCheckDraft\(\{/.test(tDone),
  '없던 행까지 되쓰면 없던 임시저장이 생긴다')
need('적용취소가 입력 문자열도 되돌린다',
  /n\[s\.k\] = s\.before/.test(tDone) && /n\[s\.k\] = s\.after/.test(tDone))
need('늦게 눌린 적용취소는 다른 위치의 패널을 안 건드린다',
  /if \(locIdRef\.current === restoreLocId\)/.test(tDone),
  'handleClearLocDrafts 와 같은 갈림 — 안 가르면 다른 위치의 사실을 이 위치의 것처럼 말한다')
// 남은 드래프트가 없으면 발끝 칩도 내린다 — settleChain 의 규칙과 같은 축이다(전수 대조).
// 안 내리면 임시저장이 하나도 없는데 칩이 '임시저장 후 수정됨' 으로 남아 유령이 된다.
need('두 쌍을 비운 뒤 발끝 칩도 내린다',
  /Object\.keys\(rowDraftsRef\.current\)\.every\(k => keys\.includes\(k\) && okFlags\[keys\.indexOf\(k\)\]\)/.test(tDone) &&
  /setLocDraftSavedAt\(null\); locDraftSnapRef\.current = null/.test(tDone))
need('적용취소가 내렸던 칩을 다시 세운다',
  /if \(had\.some\(\(_, i\) => backOk\[i\]\)\) \{ setLocDraftSavedAt\(/.test(tDone),
  '되쓴 드래프트가 있는데 칩이 없으면 비울 길이 화면에서 사라진다')
need('완료 토스트는 하나다',
  (tDone.match(/pushToast\('success'/g) ?? []).length === 1,
  '§27.2 이중 통지 금지 — 모달이 또 띄우면 같은 사건을 두 번 알린다')
need('임시저장 정리 실패가 적용취소를 빼앗지 않는다',
  /const cleanupFailed = okFlags\.some\(v => !v\)/.test(tDone) &&
  /\.\.\.\(cleanupFailed \? \{ detail: /.test(tDone) &&
  !/if \(okFlags\.some\(v => !v\)\) \{ pushToast\('error'/.test(tDone),
  '옮기기는 이미 적용됐다 — 정리 실패로 되돌릴 길이 사라지면 그게 더 큰 사고다(§16)')
const tSubmit = fnBody(client, '  const submit = async () => {')
need('옮기기 모달의 submit 을 찾음', tSubmit.length > 0)
need('패널 진입에서는 모달이 제 토스트를 띄우지 않는다',
  /if \(!silent\) \{[\s\S]{0,400}?pushToast\('success'/.test(tSubmit),
  '완료 통지의 주인은 하나다 — 패널이 두 칸을 비운 사실까지 함께 말한다')
need('모달이 결과를 호출부에 넘긴다',
  /onDone\(\{\s*\n?\s*checkId, trackedItemId: item\.id, fromId, toId, qty: moveQty, swap: swapMode,/.test(tSubmit))
// 적용취소 기대값 — 옮기기 결과에 실어야 호출부가 '얹힌 점검' 을 가려낼 수 있다.
need('모달이 적용취소 기대값도 함께 넘긴다',
  /createdAtMs: res\.createdAtMs, rowCount: res\.rowCount, markerSum: res\.markerSum/.test(tSubmit))
// 행 버튼 — '그대로' 는 행 머리('저장 N' 과 같은 줄, 두 화면), '다른 곳으로' 는 패널 비허브 행의 입력칸 아래 줄.
// (2단계 2026-10-12 — 종전 목업 '좌 다른 곳으로 · 우 옮김 없음' 한 줄을 승인 계획으로 바꿨다.) 허브 행에는 두지 않는다(§27.1).
need('비허브 행에 다른 곳으로가 있다',
  (client.match(/>\s*다른 곳으로\s*</g) ?? []).length === 1)
const headCluster = (src) => {
  const a = src.indexOf('>저장값 <strong')
  if (a < 0) return ''
  const b = src.indexOf('</div>', a)
  return b < 0 ? '' : src.slice(a, b)
}
need("'그대로' 가 행 머리 '저장값 N' 과 같은 줄에 선다(두 화면)",
  /그대로/.test(headCluster(itemForm)) && /그대로/.test(headCluster(locPanel)),
  '입력칸 아래로 내리면 저장값과 그 값을 확정하는 버튼이 떨어져, 무엇을 그대로 두는지 화면이 말을 못 한다')
// 장부가 0(또는 기록 없음)인 칸에서는 옮길 것이 없다 — 열어도 출발지 칩이 하나도 없는 막다른 모달이다.
need('잔량 0 행에는 다른 곳으로가 없다',
  /\{prev != null && prev\.qty !== 0 && (!movePending && )?\(/.test(client),
  '눌러도 고를 출발지가 없는 모달이 뜬다')
// 셋이다 — 두 화면의 '그대로' 와 패널의 '다른 곳으로'. 종전에는 수제 유사요소 확장(before:h-11)으로 44px 를
// 냈는데, 2단계에서 정본 RowActionBtn(neutral — §03 코랄 테두리 금지)으로 옮겼다. 히트 44px 는 정본이 진다.
// 수제 확장이 한 자리라도 남으면 같은 버튼이 화면마다 다른 크기·색이 된다.
const rowActionCount = (label) => (client.match(new RegExp(`<RowActionBtn\\b[\\s\\S]{0,240}?>\\s*${label}\\s*</RowActionBtn>`, 'g')) ?? []).length
need('행 버튼이 정본 RowActionBtn 이다(히트 44px · neutral)',
  rowActionCount('그대로') === 2 && rowActionCount('다른 곳으로') === 1 &&
  !/before:absolute before:content-\[''\] before:-inset-x-2 before:-top-1 before:h-11/.test(client) &&
  !/<RowActionBtn[^\n]*tone="accent"[^\n]*>\s*(그대로|다른 곳으로)/.test(client),
  '글자만이면 19px 이다 — 정본이 44px 히트와 중립 테두리를 함께 진다')
const hubBranch = (() => {
  const a = client.indexOf('허브 위치 점검 — 잔량 1칸')
  const b = client.indexOf('비허브 위치 점검', a)
  return a >= 0 && b > a ? client.slice(a, b) : ''
})()
need('허브 행 가지를 찾음', hubBranch.length > 0)
need('허브 행에는 다른 곳으로가 없다',
  !/다른 곳으로/.test(hubBranch),
  "창고에서 나가는 이동은 도착지 행의 '채운 후' 가 정본이다 — 같은 일에 입구를 둘 만들지 않는다")
need('행 진입이 품목 고정·출발지 프리셀렉트로 연다',
  /<TransferStockModal rows=\{rows\} z=\{260\} lockItem silent\s*\n\s*initialItemId=\{rowTransfer\.itemId\} initialFromId=\{rowTransfer\.fromId\}/.test(client))
// 헤더 '위치 이동' 도 같은 구멍을 연다 — 두 진입이 같은 완료 핸들러를 타야 옆 버튼에 같은
// 결함이 남지 않는다. 통지의 주인도 둘 다 패널이다(silent).
need('패널의 두 진입이 모두 완료 결과를 소비한다',
  /onDone=\{result => \{ setRowTransfer\(null\); if \(result\) void handleTransferDone\(result\) \}\}/.test(client) &&
  /onDone=\{result => \{ setTransferOpen\(false\); if \(result\) void handleTransferDone\(result\) \}\}/.test(client),
  '헤더 진입만 빠지면 거기서 옮긴 뒤 옮기기 전 값이 그대로 저장된다')
need('패널의 두 진입이 모두 모달 토스트를 끈다',
  /<TransferStockModal rows=\{rows\} silent onClose=/.test(client) &&
  /<TransferStockModal rows=\{rows\} z=\{260\} lockItem silent/.test(client))

// ── ⑨ 아이템별 폼이 위치 패널과 대칭이다 (2026-09-15 운영자 승인 설계) ────────────────
// 같은 일(한 품목의 위치별 잔량을 적는다)을 두 화면이 서로 다른 축으로 하고 있었다.
//   · 허브 입력이 '채운 후'(afterQtys)에 묶여 있었다 — calcLocMove 가 후 − 전(빈칸=0)을 옮김량으로
//     셈해 **허브 자기 행에 +N 마커**가 박히는 입구였다(2026-09-11 김치). 패널은 이미 '잔량'(before)
//     으로 옮겼는데 이쪽만 남아 있었다.
//   · 허브 칸이 '자동 차감 후' 파생값으로 프리필돼 있었다 — 안 세어도 숫자가 든 칸이라, 그 파생값이
//     매번 **실측 선언(carried:false)** 으로 저장됐다.
//   · 단순 모드 입력칸이 직전 잔량으로 프리필돼 있었다 — 그 조건(hasPrev && !restockMode)은 성립할
//     수 없어 '이전' 접미까지 통째로 죽은 코드였다.
// 그리고 저장 경로가 갈려 있었다 — 클라가 허브를 미리 깎아 절대값으로 보내는 경로 B 였다.
// 지금은 두 화면 모두 서버에 패치를 보내고 서버가 접는다(경로 A). 아래는 그 대칭의 그물이다.
need('아이템별 점검 폼을 찾음', itemForm.length > 2000)
need('위치별 점검 패널을 찾음', locPanel.length > 2000)
// 허브 가지 — 입력은 beforeQtys 에 묶이고, 그 가지 안에 afterQtys 가 없다.
const itemHubBranch = (() => {
  const a = itemForm.indexOf('{rowIsHub ? (')
  const b = itemForm.indexOf(') : (', a)
  return a >= 0 && b > a ? itemForm.slice(a, b) : ''
})()
need('아이템별 폼의 허브 행 가지를 찾음', itemHubBranch.length > 0)
need('허브 입력이 beforeQtys 에 묶인다',
  /value=\{beforeStr\}/.test(itemHubBranch) && /setBeforeQtys\(p => \(\{ \.\.\.p, \[loc\.id\]/.test(itemHubBranch),
  "'채운 후'에 묶으면 후 − 전(빈칸=0)이 옮김량으로 셈해져 허브 자기 행에 +N 마커가 박힌다")
need('허브 가지에 afterQtys 가 없다',
  !/afterQtys|setAfterQtys/.test(itemHubBranch),
  '창고에서 창고로 옮기는 일은 없다 — 허브 칸은 실측 한 값이지 옮김이 아니다')
need('허브 보정 플래그(hubTouched) 상태가 아이템별 폼에서 사라졌다',
  !/setHubTouched|const \[hubTouched/.test(itemForm) && /const hubMeasured = /.test(itemForm),
  "허브 실측 여부는 beforeQtys[허브] 가 비었는가 하나로 말한다 — 같은 사실을 두 곳에서 말하면 드래프트 복원에서 갈린다")
// 폐기한 플래그는 **읽기만** 남는다 — 그 시절 문서를 복원할 때 허브 값이 '채운 후'에 들어 있다.
// 이 한 줄이 없으면 어제 임시저장한 허브 값이 오늘 폼에서 빈칸으로 열린다.
// 옛 문서 호환은 **드래프트를 읽는 세 자리 전부**에 선다(검수 지적 2026-09-16). 한 자리라도 빠지면
// 그 경로로 들어온 허브 값이 화면에 안 보이는 채(허브 칸은 before 를 그린다) enteredAny 의 과잉
// 입고 신호와 §12 칩의 '수정됨' 판정에만 들어간다.
need('옛 드래프트의 허브 값을 잔량 칸으로 옮기는 정본이 있다',
  /function hubDraftToBefore\(isHubCell: boolean, before: string, after: string\)/.test(client),
  '읽는 자리마다 손으로 쓰면 언젠가 한 자리만 바뀐다')
need('아이템별 문서 복원이 그 정본을 지난다',
  /const moved = hubDraftToBefore\(true, beforeOv\[hubLoc\.id\] \?\? '', afterOv\[hubLoc\.id\] \?\? ''\)/.test(itemForm),
  '구 문서 호환 한 줄 — 없으면 옛 임시저장의 허브 값이 조용히 사라진다')
need('아이템별 폼의 위치별 문서 병합도 그 정본을 지난다',
  /hubDraftToBefore\(\s*\n?\s*hubLoc != null && dr\.locationId === hubLoc\.id,/.test(itemForm),
  'cross-merge 로 들어오는 옛 값은 이 자리를 안 지나면 그대로 폼에 앉는다')
need('위치 패널 복원도 그 정본을 지난다',
  /const \{ before, after \} = hubDraftToBefore\(\s*\n?\s*isHubCell,/.test(locPanel),
  '패널만 빠지면 같은 값이 그쪽 화면에서 되살아난다')
need('임시저장 문서에 hubTouched 를 더는 쓰지 않는다',
  !/hubTouched, savedAt/.test(itemForm) && /data: \{ date, qty, memo, locationQtys, beforeQtys, afterQtys, savedAt \}/.test(itemForm),
  '쓰면서 읽으면 폐기가 아니다 — 새 문서는 허브도 beforeQtys 에 든다')
need('입력 상태가 빈 맵으로 시작한다(프리필 0)',
  (itemForm.match(/useState<Record<string, string>>\(\{\}\)/g) ?? []).length === 3,
  'locationQtys·beforeQtys·afterQtys 셋 다 — prevMap 으로 미리 채우면 안 센 값이 실측으로 저장된다')
need('아이템별 폼에 prevMap 프리필 시딩이 없다',
  !/prevMap\[l\.id\] != null \? String\(prevMap\[l\.id\]\) : ''/.test(itemForm),
  "채워 둔 값은 '세었다'는 뜻이 되어 버린다 — 빈칸이 정본이다")
// 행 문법 — 두 화면이 같은 버튼·같은 말을 쓴다. (타임라인 편집 폼 CheckEditForm 은 이 대칭의
// 대상이 아니다 — 저장된 점검 한 건을 고치는 다른 일이고 경로 B 에 남는다.)
// '그대로' — 저장된 값을 이번 실측으로 확정한다. 종전 '저장된 값'(창고 행)·'옮김 없음'(비허브 행)이 같은 일을 두 이름으로
// 하고 있어 한 이름으로 합쳤다(2단계). 글자는 화면마다 소스에 한 번이다(조건부 렌더) — 옛 두 이름은 남지 않는다.
need("'그대로' 버튼이 두 화면 모두에 있다",
  (itemForm.match(/>\s*그대로\s*</g) ?? []).length === 1 &&
  (locPanel.match(/>\s*그대로\s*</g) ?? []).length === 1 &&
  !/>\s*(저장된 값|옮김 없음)\s*</.test(itemForm + locPanel),
  '행 머리의 저장값을 칸에 채워 넣는 자리 — 한쪽만 있으면 같은 일에 입구가 갈린다')
// 창고 행 유령 재고(도메인 P1-1, 2026-10-12). 창고 칸은 허브 패치로 **맨 뒤에 덮어쓰는** 실측이라, 같은 저장에
// 채움(창고에서 빼 옴)이 있는데 옮기기 전 저장값을 그대로 적으면 옮긴 만큼이 두 번 남는다. 막는 축은 둘이다.
//   ⓐ 채움이 있으면 '저장된 값' 버튼을 안 그린다(그 자리에 자동 차감 캡션).
//   ⓑ 그래도 칸에 저장값이 남았으면(버튼을 먼저 눌렀거나 임시저장 복원) 경고 + 비우기를 띄운다.
//      ⓐ 만 있으면 입력 순서에 따라 값이 남는다(독립 검수 2026-10-12 재현) — 두 화면 모두.
// 술어 하나(canKeep)가 두 조건을 진다 — 행이 비어 있을 때만, 그리고 창고 행은 이번 저장에 채움이 없을 때만.
need("채움이 있으면 창고 행 '그대로' 를 안 그린다(두 화면)",
  /const canKeep = prevQty !== undefined && beforeStr === '' && afterStr === '' && !\(rowIsHub && restockSum > 0\)/.test(itemForm) &&
  /const canKeep = prev != null && beforeStr === '' && afterStr === '' && !\(rowIsHub && itemMoves > 0\)/.test(locPanel) &&
  /\{canKeep && \(\s*\n\s*<RowActionBtn[\s\S]{0,240}?그대로/.test(itemForm) &&
  /\{canKeep && \(\s*\n\s*<RowActionBtn[\s\S]{0,240}?그대로/.test(locPanel),
  '옮기기 전 창고 양을 실측으로 박는 입구다 — 허브 패치가 맨 뒤에 덮어써 옮긴 만큼이 두 번 남는다')
need('창고 칸에 저장값이 남으면 경고와 비우기가 선다(두 화면)',
  /const hubStale = rowIsHub && restockSum > 0 && beforeStr !== '' && Number\(beforeStr\) === prevQty/.test(itemForm) &&
  /\{hubStale && \(/.test(itemForm) &&
  /setBeforeQtys\(p => \(\{ \.\.\.p, \[loc\.id\]: '' \}\)\)/.test(itemForm) &&
  /const hubStale = rowIsHub && itemMoves > 0 && beforeStr !== '' && prev != null && Number\(beforeStr\) === prev\.qty/.test(locPanel) &&
  /\{hubStale && \(/.test(locPanel) &&
  /setBeforeQtys\(p => \(\{ \.\.\.p, \[k\]: '' \}\)\)/.test(locPanel),
  "버튼만 숨기면 '저장된 값' 을 먼저 누르고 아래 행을 채운 순서·임시저장 복원에서 그 값이 그대로 저장된다")
// 예외(2단계, 운영자 승인 계획) — 행마다의 '{창고} 남음' 줄은 **위치 패널에만** 선다. 아이템별 폼은 한 품목이라
// 위 고정 창고 요약이 같은 값을 말하고, 패널은 품목마다 창고가 달라 한 줄 요약이 성립하지 않는다. 비대칭을 봉인한다 —
// 폼에 되살아나면 같은 숫자가 한 화면에 행 수만큼 서고, 패널에서 빠지면 채울 창고를 볼 자리가 없다.
need('창고 남음 줄은 위치 패널 행에만 있다(아이템별 폼은 고정 요약이 말한다)',
  /\{hubStock\.pathName\} 남음/.test(locPanel) && !/\{(hubStock|hubLoc)\.pathName\} 남음/.test(itemForm) && !/const hubStock = /.test(itemForm),
  'knowledge/domain-inventory.md 화면도 한 벌 절의 예외 — 한쪽만 바꾸면 그 노트가 거짓이 된다')
// 발끝 고정(2단계) — 저장 버튼은 상세 모달 발끝에 서고 form= 으로 이 폼에 붙는다. 'N곳' 은 저장에 실릴 칸 수라
// 패치 조립부 그대로 센다(세는 규칙이 갈리면 '2곳 저장' 을 눌렀는데 3곳이 저장된다). 0 이면 비활성이다.
need('아이템별 폼의 저장 버튼이 발끝에서 form= 으로 붙는다',
  /<form onSubmit=\{handleSubmit\}[^\n]*id=\{formId\}/.test(itemForm) &&
  /<Btn type="submit" form=\{formId\}/.test(itemForm) &&
  /createPortal\(footer, footerSlot\)/.test(itemForm) &&
  /data \? <div data-check-footer="" \/> : <DetailCheckFooterSkeleton restock=\{/.test(client),
  '본문 끝에 두면 위치가 많은 품목에서 저장 버튼이 스크롤 밖이다(§27.1 저장 버튼 상시 노출)')
need("'N곳 저장' 이 패치 조립부로 세고 0 이면 비활성이다",
  /const restockSaveCount = restockMode \? buildLocationPatches\(\)\.length : null/.test(itemForm) &&
  /disabled=\{pending \|\| restockSaveCount === 0 \|\| pendingLocCount > 0\}/.test(itemForm) &&
  /\$\{restockSaveCount\}곳 저장/.test(itemForm),
  '화면이 따로 세면 버튼의 숫자와 실제 저장 칸 수가 갈린다')
// 키보드가 선 동안(html[data-kbd-open] .kbd-collapse) — 2단계 검수 1. 작은 아이폰에서 보이는 띠가 150px 안팎인데 고정 창고
// 요약(58px)이 그 위를 먹어, 재노출 정본이 칸을 올린 자리에서 행 머리('상단')가 요약 밑에 깔리고 칸 아래 다음 행 이름만
// 보였다(검수 실측 9칸 중 9칸). 전역 가드는 sticky 를 모르므로 이 화면이 띠를 돌려준다. 접는 것은 셋뿐이다 —
// 정상 창고 요약(넘침이면 경고 우선이라 안 접는다), 임시저장 칩(두 화면), 패널 발끝 안내 줄. 합계 줄과 버튼 줄은
// 접지 않는다(§27.1 저장 수단 상시 노출 — check-kbd-collapse-optin 이 Modal 옵트인만 보므로 여기서 본다).
need('키보드가 선 동안 정상 창고 요약·임시저장 칩만 접고 저장 수단은 안 접는다',
  /<div className=\{`sticky top-0 z-10[^`]*\$\{hubOverdrawn \? '' : 'kbd-collapse'\}`\}>/.test(itemForm) &&
  (itemForm.match(/className="kbd-collapse flex items-center justify-between gap-2 text-\[0\.65625rem\] rounded-lg/g) ?? []).length === 1 &&
  (locPanel.match(/className="kbd-collapse flex items-center justify-between gap-2 text-\[0\.65625rem\] rounded-lg/g) ?? []).length === 1 &&
  /<p className="kbd-collapse text-xs text-\[var\(--warm-mid\)\]">채운 만큼 각 품목의 창고 잔량에서 자동 차감됩니다\.<\/p>/.test(locPanel) &&
  (client.match(/className=[^\n]*kbd-collapse/g) ?? []).length === 4 &&
  !/kbd-collapse[^\n]*(type="submit"|이번 채움|점검 후 잔량|건 저장|곳 저장)/.test(client),
  '요약이 띠를 먹으면 칸의 이름이 가려지고, 저장 수단을 접으면 적는 동안 커밋할 길이 사라진다')
need("죽은 '이전' 접미가 아이템별 폼에서 사라졌다",
  !/>이전 \{/.test(itemForm),
  '프리필이 없으니 이전 값을 가리키는 접미도 성립하지 않는다')
need("'자동 차감 후' 라벨이 아이템별 폼에서 사라졌다",
  !/자동 차감 후/.test(itemForm),
  '허브 칸은 파생값 표시 자리가 아니라 실측 입력 자리다 — 파생은 참고줄이 말한다')
need("요약줄이 '창고 → 이동 합계' 가 아니다",
  !/창고 → 이동 합계/.test(itemForm),
  '§29 — 화살표는 값의 전환 표시에만 쓴다')
// 토스트 — 성공 통지의 주인은 CheckForm 하나다(§27.2 이중 통지 금지).
need('상세 모달이 저장 토스트를 다시 띄우지 않는다',
  !/점검을 저장했습니다/.test(client),
  '같은 사건을 두 번 알리고, 그 토스트의 액션은 6초 뒤 사라져 이어갈 자리를 잃는다')
const itemSubmit = fnBody(itemForm, '  const handleSubmit = (e: React.FormEvent) => {')
need('아이템별 폼의 제출 함수를 찾음', itemSubmit.length > 1000)
// 저장 토스트의 부가 옵션은 **한 곳**에서 만든다 — 갈래마다 손으로 쓰면 어느 갈래만 적용취소가
// 빠지거나 문장이 갈린다. 그 한 곳이 세 축을 지킨다(sameDayNotice 는 detail · deduped 면 적용취소
// 없음 · 적용취소 뒤 결과 토스트).
need('저장 성공 토스트가 공용 옵션 한 곳을 쓴다',
  /const checkSaveToastOpts = \(res: \{ id: string; sameDayNotice\?: boolean; deduped\?: boolean \}\) => \(\{/.test(itemForm) &&
  (itemSubmit.match(/pushToast\('success'/g) ?? []).length ===
  (itemSubmit.match(/checkSaveToastOpts\(res\)/g) ?? []).length &&
  (itemSubmit.match(/pushToast\('success'/g) ?? []).length >= 2,
  '잘못 센 값이 기준선으로 박히면 되돌릴 자리가 토스트뿐이다 — 한 갈래라도 빠지면 그 갈래만 못 되돌린다')
need('멱등으로 삼킨 저장에는 적용취소를 안 붙인다',
  /res\.deduped\s*\n?\s*\? \{ detail:/.test(itemForm) && /action: \{ label: '적용취소'/.test(itemForm),
  '그때 돌아온 id 는 이 제출이 만든 점검이 아니다 — 지우면 20초 전의 다른 저장을 지운다')
need('적용취소가 끝나면 결과 토스트를 낸다',
  /pushToast\('info', '재고 점검 저장을 적용취소했습니다'\)/.test(itemForm),
  '§16 Do — 적용취소 후에도 결과 토스트. 없으면 눌렀는지 아닌지 화면이 말을 안 한다')
need('세 갈래가 같은 문장이다',
  (itemSubmit.match(/pushToast\('success', '재고 점검 저장됨'/g) ?? []).length ===
  (itemSubmit.match(/pushToast\('success'/g) ?? []).length,
  '위치 있음·위치 없음이 다른 말을 하면 같은 저장이 화면마다 다른 사건처럼 보인다')
need('같은 날 안내는 별도 토스트가 아니라 detail 이다',
  !/pushToast\('info', '같은 날 점검이 이미 있습니다'/.test(client),
  '§15 — 토스트를 겹쳐 쌓지 않는다')
// 저장 경로 — 클라가 허브를 깎지 않는다.
need('아이템별 폼이 패치로 저장한다',
  /const buildLocationPatches = \(\): LocCheckPatch\[\] => \{/.test(itemForm) &&
  /locationPatches, isReconcile: reconcileMode,/.test(itemForm),
  '절대값(locationQtys)으로 보내면 클라가 미리 깎은 허브 파생값이 실측 선언으로 박힌다')
need('허브 패치는 적었을 때만, 맨 뒤에 실린다',
  /if \(hubLoc && hubMeasured\) \{[\s\S]{0,260}?patches\.push\(\{ checkedLocationId: hubLoc\.id/.test(itemForm),
  '허브 실측을 먼저 쓰면 그 위에서 또 차감된다 — 패널 buildUnits 와 같은 규칙')
need('허브 부족 재시도가 이동 출처와 허브 패치를 함께 거른다',
  /!exclude\.has\(p\.checkedLocationId\) && !\(moved && hubLoc != null && p\.checkedLocationId === hubLoc\.id\)/.test(itemForm),
  '이동 출처 칸을 그대로 다시 보내면 옮기기 전에 센 값이 이동 점검을 덮고, 허브 패치는 이동 전의 사실이라 옮겨 온 양을 지운다')
need('허브를 직접 센 제출은 부족 게이트를 끈다',
  /locationPatches, isReconcile: reconcileMode, allowHubClamp: hubMeasured,/.test(itemForm),
  '위치 패널의 measuredHubs·clampRef 와 같은 술어다 — 안 끄면 지금 세는 값이 정답인데 팝업이 서고 others 가 비어 화면이 거짓말을 한다')
need('막힌 자리를 위치 이름으로 말한다',
  /itemLabel: stuckName/.test(itemForm) && /res\.stuckLocationId/.test(itemForm),
  "itemLabel 이 빈 문자열이면 팝업이 어느 칸에서 막혔는지 말하지 못한다")
const serverPatches = (() => {
  const s = actions.indexOf('export async function createStockCheck(data: {')
  if (s < 0) return ''
  const e = actions.indexOf('\nexport ', s + 40)
  return e < 0 ? actions.slice(s) : actions.slice(s, e)
})()
need('createStockCheck 를 찾음', serverPatches.length > 2000)
need('서버가 두 갈래를 한 자리로 모은다',
  /const patches: LocCheckPatch\[\] \| null =/.test(serverPatches),
  'base 조립문이 갈리면 비대칭 가드(check-stock-ledger-parity)가 한쪽만 겨눈다')
need('서버가 복수 패치를 순서대로 접는다',
  /applyLocationChecks\(base, patches, data\.allowHubClamp\)/.test(serverPatches))
need('멱등창이 모든 패치의 일치를 본다',
  /const allSame = sameMeta && patches\.every\(p => \{/.test(serverPatches),
  '하나라도 다르면 새로 적은 값이 섞인 제출이다 — 삼키면 그 값이 저장되지 않은 채 저장됨이 된다')
// 숫자만 보면 "같은 숫자로 날짜만 어제로 고쳐 다시 저장" 이 통째로 삼켜진다 — 화면은 '저장됨' 인데
// 날짜도 메모도 안 바뀐다(검수 지적 2026-09-16). carried 축은 updateStockCheck 이 이미 보고 있었다.
need('멱등창이 날짜·메모·보정 여부도 본다',
  /const sameMeta = lastCheck\.date\.getTime\(\) === ymdToDbDate\(data\.date\)\.getTime\(\)[\s\S]{0,200}?lastCheck\.isReconcile === !!data\.isReconcile/.test(serverPatches),
  '숫자만 대조하면 날짜·메모만 고친 재저장이 조용히 삼켜진다')
need('멱등창이 그 행이 실측인지도 본다',
  /lb\.carried === false/.test(serverPatches),
  "이월(파생) 행은 '방금 내가 실측으로 쓴 그 행' 이 아니다")
need('멱등창이 패치 개수까지 본다',
  /patches\.length === lastMeasured/.test(serverPatches),
  'every 는 진부분집합에도 참이다 — 칸 하나를 지우고 다시 저장하면 전부 일치로 읽혀 통째로 삼켜진다')
need('삼킨 저장은 표식을 달고 돌아온다',
  /return \{ ok: true, id: lastCheck\.id, deduped: true \}/.test(serverPatches),
  '호출부가 이 표식을 봐야 §16 적용취소를 안 붙인다')
need('복수 패치의 순서·중복을 서버가 지킨다',
  /const ordered = \[\.\.\.patches\]\.sort\(/.test(merge) && /return \{ ok: false, duplicate: p\.checkedLocationId \}/.test(merge),
  "'허브는 맨 뒤' 는 장부의 정합 조건이지 호출부의 예의가 아니다 — 먼저 쓰면 그 실측 위에서 또 차감된다")

// ── 가드 우회 봉합 — '적었다' 를 값이 아니라 **집합**으로 든다 ─────────────────────────
// 검수가 설계한 변형 둘. ⓐ `useState({})` 는 두고 buildLocationPatches 안에서 빈 칸을 직전값으로
// 채운다. ⓑ 더 나쁜 것 — **드래프트 복원 이펙트**에서 beforeOv 를 프리필로 채워 setBeforeQtys 로
// 민다. 둘 다 위 축들이 전부 초록인 채 안 센 위치가 실측 패치로 나가고, ⓑ 는 부수로 hubMeasured 가
// 항상 참이 되어 **허브 부족 게이트까지 통째로 꺼진다**. 값은 안 바뀌므로 데이터 대조도 침묵한다.
//
// 봉합은 정규식을 늘리는 쪽이 아니라 **구조**다. '적었다' 는 사실을 값과 따로 든 집합(entered)이
// 말하고, 그 집합을 채우는 자리는 onChange 와 드래프트 복원 둘뿐이며, 복원조차 병합 결과가 아니라
// **서버 문서의 키**(draftedIds)에서만 가져온다. 그러면 프리필이 어느 자리로 숨어도 집합이 안 늘고
// 패치 수도 안 는다. 아래 축들은 그 구조가 서 있는지를 본다.
need("'적었다' 를 값과 따로 든 집합이 있다",
  /const \[entered, setEntered\] = useState<Set<string>>\(new Set\(\)\)/.test(itemForm) &&
  /const markEntered = \(id: string\) =>/.test(itemForm),
  "'문자열이 비었는가' 로 물으면 프리필이 어느 자리로 숨어도 그 값이 실측 패치로 나간다")
need('그 집합을 채우는 자리가 둘뿐이다',
  (itemForm.match(/setEntered\(/g) ?? []).length === 2,
  'onChange(markEntered)와 드래프트 복원 — 세 번째 자리가 생기면 그것이 다음 우회로가 된다')
need('복원이 **서버 문서의 키**에서만 가져온다',
  /const draftedIds = new Set<string>\(\)/.test(itemForm) &&
  /for \(const dr of drafts\) if \(dr\.locationId != null\) draftedIds\.add\(dr\.locationId\)/.test(itemForm) &&
  /setEntered\(new Set\(\[\.\.\.draftedIds\]\.filter\(/.test(itemForm),
  '병합 결과(beforeOv)에서 가져오면 그 앞에 끼워 넣은 프리필이 그대로 집합을 불린다')
const buildPatches = fnBody(itemForm, '  const buildLocationPatches = (): LocCheckPatch[] => {')
need('패치 조립부를 찾음', buildPatches.length > 200)
need('조립부의 술어가 그 집합이다',
  /if \(!entered\.has\(l\.id\)\) continue/.test(buildPatches),
  '안 적은 행을 실으면 아무도 안 센 값이 실측 선언(carried:false)으로 장부에 박혀 그 위치의 전파가 영구히 멈춘다')
need('허브 실측 판정도 그 집합을 본다',
  /const hubMeasured = hubLoc \? entered\.has\(hubLoc\.id\) &&/.test(itemForm),
  '값으로만 물으면 프리필 하나로 허브 부족 게이트가 통째로 꺼진다')
need('과잉 입고 신호도 그 집합을 본다',
  /restockMode \? entered\.size > 0 :/.test(itemForm),
  '값으로 물으면 아무것도 안 적었는데 경고가 뜬다')
need('안 적은 허브 행은 패치에 안 실린다',
  /if \(hubLoc && hubMeasured\)/.test(buildPatches),
  '허브를 안 적었으면 서버가 차감한 파생값을 이월로 남긴다 — 실측으로 박으면 안 된다')
need('조립부가 직전값(prevMap)을 끌어다 쓰지 않는다',
  !/prevMap/.test(buildPatches),
  '프리필이 state 에서 조립부로 자리만 옮긴 우회다 — 빈칸이 정본이라는 규칙은 저장 직전까지 살아야 한다')
// ④의 허브 제외 가지는 지금 닿지 않는다 — 지키는 것은 '분기가 있는가' 가 아니라 **두 조건이 배타인가** 다.
need('허브 패치 조건과 부족 게이트 조건이 배타다',
  /allowHubClamp: hubMeasured/.test(itemForm) && /if \(hubLoc && hubMeasured\)/.test(buildPatches),
  '허브를 적으면 게이트가 꺼지고, 게이트가 서면 허브 패치가 없다 — 이 배타가 깨지면 이동 뒤 재저장의 허브 제외 가지가 살아나야 한다')
need('재시도가 saveArgs 의 clamp 를 덮지 않는다',
  /allowHubClamp: saveArgs\.allowHubClamp \|\| !!o\.allowHubClamp/.test(itemForm),
  "팝업의 '옮겨서 채우기' 는 그 인자를 안 넘긴다 — 그대로 펴면 undefined 가 saveArgs 값을 덮는다")
// 차단 A — 팝업의 두 성공 토스트도 같은 규칙을 탄다.
const hubDialog = topFn(client, 'function HubShortDialog({ pending, onResolved, onExit }')
need('허브 부족 팝업을 찾음', hubDialog.length > 1000)
need('팝업의 retry 가 deduped 를 읽을 수 있다',
  /retry: \(opts: \{ allowHubClamp\?: boolean; excludeLocationIds\?: string\[\] \}\) => Promise<\{ ok: true; id: string; deduped\?: boolean \}/.test(client),
  '타입에 없으면 읽을 수조차 없어 같은 결함이 이 두 자리에 남는다')
need('삼켜진 재저장은 보충 점검을 적용취소 대상에서 뺀다',
  /const undoIds = res\.deduped \? \[\.\.\.moves\]\.reverse\(\) : \[restockId, \.\.\.\[\.\.\.moves\]\.reverse\(\)\]/.test(hubDialog),
  '그 id 는 이 제출의 결과가 아니라 20초 안에 있던 다른 저장이다 — 지우면 남의 기록을 지운다')
need('강행 저장 토스트도 같은 규칙이다',
  /pushToast\('success', '부족한 채로 저장했습니다', res\.deduped/.test(hubDialog),
  '두 자리 중 하나만 고치면 다른 경로로 같은 사고가 난다')

// ── ⑩ '채우기 전' 빈칸 해석의 정본 (2026-10-19 신고 1daf641c, 운영자 승인 C안) ─────────────────────
// 규칙이 06-14 '빈칸 = 저장값' 에서 09-01 '빈칸 = 0' 으로 뒤집혔고, 쌀 신고(2.5kg 에서 10kg 으로 채웠는데 +10)가 다시
// 저장값을 기대했다. 두 규칙의 답이 갈리는 행만 묻는다. 이 축이 지키는 것은 그 물음이 **세 화면 모두**에 서는가다.
// 한 화면이라도 둘짜리 해석(빈칸 = 0)을 부르면 그 화면만 옛 장부를 쓴다. 그리고 묻는 행이 저장으로 새지 않는가.
const ledgerSrc = readFileSync('lib/stockLedger.ts', 'utf8')
const invConstants = readFileSync('app/(app)/inventory/constants.ts', 'utf8')
const invLoading = readFileSync('app/(app)/inventory/loading.tsx', 'utf8')
const editForm = topFn(client, 'function CheckEditForm({ entry, stockUnit, itemLocations')
need('이력 수정 폼을 찾음', editForm.length > 2000)
need('해석 정본이 저장값을 받는다',
  /export function calcLocMove\(beforeStr: string, afterStr: string, savedQty: number \| null \| undefined\): LocMove \{/.test(ledgerSrc) &&
  /pending: true/.test(ledgerSrc),
  '저장값을 안 받으면 두 규칙의 답이 갈리는 행을 가를 수 없다(빈칸 = 0 으로 되돌아간다)')
// 호출은 전부 인자 셋이다. 괄호 짝을 세어 최상위 쉼표가 둘인지 본다.
const callArgs = (src, name) => {
  const out = []
  let i = 0
  while ((i = src.indexOf(name + '(', i)) >= 0) {
    let depth = 0, commas = 0, j = i + name.length
    for (; j < src.length; j++) {
      const ch = src[j]
      if (ch === '(' || ch === '[' || ch === '{') depth++
      else if (ch === ')' || ch === ']' || ch === '}') { depth--; if (depth === 0) break }
      else if (ch === ',' && depth === 1) commas++
    }
    out.push(commas + 1)
    i = j
  }
  return out
}
const clientCalls = callArgs(client, 'calcLocMove')
need('화면의 해석 호출이 전부 저장값과 함께다',
  clientCalls.length >= 4 && clientCalls.every(n => n === 3),
  `인자 둘짜리 호출이 남으면 그 자리만 빈칸 = 0 으로 돈다(호출 ${clientCalls.join(',')})`)
need('세 화면이 같은 함수를 저마다의 저장값으로 부른다',
  /const moveOf = \(l: StorageLocationItem\) => calcLocMove\(beforeQtys\[l\.id\] \?\? '', afterQtys\[l\.id\] \?\? '', prevMap\[l\.id\]\)/.test(itemForm) &&
  /const saved = r\.currentLocationBreakdown\.find\(lb => lb\.locationId === lid\)\?\.qty\s*\n\s*const \{[^}]*pending[^}]*\} = calcLocMove\(beforeStr, afterStr, saved\)/.test(locPanel) &&
  /const moveOf = \(l: \{ id: string \}\) => calcLocMove\(beforeQtys\[l\.id\] \?\? '', afterQtys\[l\.id\] \?\? '', savedBeforeOf\(l\.id\)\)/.test(editForm),
  '아이템별 폼은 행 머리 저장값(prevMap), 패널은 같은 출처(currentLocationBreakdown), 이력 수정 폼은 그 기록의 채우기 전. 한 화면만 빠지면 그 화면만 묻지 않는다')
// 이력 수정 폼의 저장값은 **그 기록의 그 행 채우기 전**(잔량 − 채움)이다. 이름만 보면 정의가 바뀌어도(잔량을 그대로 쓰거나
// null 로 비우면) 위 축은 초록이다. 정의 자체를 본다(검수 2026-10-19 빈틈).
need('이력 수정 폼 저장값이 그 기록의 채우기 전이다',
  /const origOf = \(id: string\) => entry\.locationBreakdown\.find\(lb => lb\.locationId === id\)/.test(editForm) &&
  /const savedBeforeOf = \(id: string\) => \{ const lb = origOf\(id\); return lb \? Math\.max\(0, lb\.qty - \(lb\.restockedQty \?\? 0\)\) : null \}/.test(editForm),
  '잔량(채운 후)을 저장값으로 쓰면 채움이 있던 행에서 [저장값에서 채움] 이 옮김 0 이 되고, null 이면 그 폼에서는 묻지 않는다')
need('세 화면의 행 계산이 모두 그 한 자리(moveOf/computeRow)를 지난다',
  !/calcLocMove\(/.test(itemForm.replace(/const moveOf = [^\n]*\n/, '').replace(/const hubMove = [^\n]*\n/, '')) &&
  (locPanel.match(/calcLocMove\(/g) ?? []).length === 1 &&
  (editForm.match(/calcLocMove\(/g) ?? []).length === 1,
  '행마다 손으로 다시 부르면 언젠가 한 자리만 저장값을 빠뜨린다')
// 묻는 행은 저장으로 새지 않는다. 세는 수에서 빠지고, 버튼이 막히고, 막힌 이유가 버튼 위에 선다.
need('아이템별 폼: 묻는 행은 패치에 안 실린다',
  /const \{ finalN, restocked, pending \} = moveOf\(l\)\s*\n\s*if \(pending\) continue/.test(buildPatches) &&
  /if \(pendingLocCount > 0\) return\s*\n\s*const locationPatches = buildLocationPatches\(\)/.test(itemSubmit),
  "빼지 않으면 '채우기 전'을 정하지 않은 칸이 빈칸 = 0 으로 저장된다(신고 그대로)")
need('위치 패널: 묻는 칸은 저장 단위에서 빠지고 저장 경로가 그 목록을 쓴다',
  /const saveUnits = \(\) => buildUnits\(\)\.filter\(u => !computeRow\(u\.r, u\.locId\)\.pending\)/.test(locPanel) &&
  /const dirtyUnitCount = saveUnits\(\)\.length/.test(locPanel) &&
  /let units = saveUnits\(\)/.test(doSave) && /if \(pendingPairCount > 0\) \{ setConfirmItems\(\[\]\); setDupUnits\(\[\]\); return \}/.test(doSave) &&
  !/let units = buildUnits\(\)/.test(doSave),
  '패널만 게이트가 빠지면 같은 물음이 이 화면에서만 빈칸 = 0 으로 저장된다')
need('이력 수정 폼: 묻는 행이 있으면 저장하지 않는다',
  /if \(pendingLocCount > 0\) return/.test(editForm) &&
  /const \{ restocked, finalN \} = moveOf\(l\)/.test(editForm) && /qty: finalN \?\? 0,/.test(editForm) &&
  !/qty: Number\(afterQtys\[l\.id\] \|\| '0'\)/.test(editForm),
  "'채운 후'만 읽으면 그 칸을 비울 때 채우기 전 값을 버리고 0 을 저장한다(점검 폼과 갈린 자리)")
need('세 화면의 저장 버튼이 묻는 행이 있으면 막히고 이유 한 줄이 선다',
  /disabled=\{pending \|\| restockSaveCount === 0 \|\| pendingLocCount > 0\}/.test(itemForm) &&
  /\{pendingLocCount > 0 && <p className="break-keep text-xs text-\[var\(--warm-muted\)\]">\{pendingReasonItemForm\(pendingLocCount\)\}<\/p>\}/.test(itemForm) &&
  /disabled=\{pending \|\| !locId \|\| scopeItemCount === 0 \|\| dirtyUnitCount === 0 \|\| pendingPairCount > 0\}/.test(locPanel) &&
  /\{pendingPairCount > 0 && <p className="break-keep text-xs text-\[var\(--warm-muted\)\]">\{pendingReasonPanel\(pendingPairCount\)\}<\/p>\}/.test(locPanel) &&
  /\|\| pendingLocCount > 0\}\s*\n\s*onClick=\{handleSave\}/.test(editForm) &&
  /\{pendingLocCount > 0 && <p className="break-keep text-xs text-\[var\(--warm-muted\)\]">\{pendingReasonItemForm\(pendingLocCount\)\}<\/p>\}/.test(editForm) &&
  client.includes("const pendingReasonItemForm = (n: number) => `'채우기 전'을 고를 위치가 ${n}곳 남았습니다.`") &&
  client.includes("const pendingReasonPanel = (n: number) => `'채우기 전'을 고를 품목이 ${n}건 남았습니다.`"),
  '§22 ② 하단 이유 한 줄 + 버튼 비활성. 막기만 하면 왜 안 눌리는지 모르고, 말만 하면 그 행을 빼고 저장된다')
need('이유 줄은 키보드가 서도 접지 않는다',
  !/kbd-collapse[^\n]*pendingReason/.test(client))
// 발끝 합계. 묻는 행은 안 센 위치처럼(이월) 센다. 채운 후 값을 넣으면 창고 차감 없이 합계만 부푼다.
need('아이템별 폼 점검 후 잔량이 묻는 행을 이월로 센다',
  /if \(\(beforeStr === '' && afterStr === ''\) \|\| pending\) return s \+ \(prevMap\[l\.id\] \?\? 0\)/.test(itemForm),
  '채운 후를 그대로 더하면 창고에서 안 빠진 양이 합계에 더해져 유령 재고가 화면에 선다')
// 묻는 행 아래 고르는 줄. 세 화면 모두, 그 화면의 저장값으로.
need('고르는 줄이 한 벌이고 버튼 글자가 규칙과 같다',
  /function PendingFillChoice\(\{ saved, unit, onPick \}/.test(client) &&
  /<RowActionBtn onClick=\{\(\) => onPick\(String\(saved\)\)\}>\{fmtQty\(saved, unit\)\}에서 채움<\/RowActionBtn>/.test(client) &&
  /<RowActionBtn onClick=\{\(\) => onPick\('0'\)\}>\{fmtQty\(0, unit\)\}에서 채움<\/RowActionBtn>/.test(client) &&
  client.includes(`{"'채우기 전'이 비어 있습니다. 얼마에서 채웠는지 고르세요."}`) &&
  /function PendingFillChoice[\s\S]{0,800}?<div className="space-y-2">/.test(client) &&
  !/에서 옮김/.test(client),
  "낱말은 '채움'이다. '옮김'은 위치 이동이라 이 자리에 쓰지 않는다")
need('세 화면이 묻는 행 아래에 고르는 줄을 세운다',
  /\{movePending && prevQty !== undefined && \(\s*\n\s*<PendingFillChoice saved=\{prevQty\}/.test(itemForm) &&
  /\{movePending && prev != null && \(\s*\n\s*<PendingFillChoice saved=\{prev\.qty\}/.test(locPanel) &&
  /\{movePending && savedBefore != null && \(\s*\n\s*<PendingFillChoice saved=\{savedBefore\}/.test(editForm),
  '물음이 한 화면에서만 빠지면 그 화면에서는 버튼이 막힌 채 고를 길이 없다')
// 자리표시 '0'. 빈칸이 실제로 0 으로 저장되는 자리에만. 묻는 행에 세우면 아직 정하지 않은 칸이 '0 에서 채웠다' 로 읽힌다.
const beforePh = /placeholder=\{afterStr !== '' && beforeStr === '' && !movePending \? '0' : undefined\}/
need("묻는 행의 '채우기 전' 칸에 자리표시 '0' 이 없다(세 화면)",
  beforePh.test(itemForm) && beforePh.test(locPanel) && beforePh.test(editForm) &&
  !/placeholder=\{afterStr !== '' && beforeStr === '' \? '0' : undefined\}/.test(client),
  '0 을 띄우면 신고 화면 그대로다. 비워 둔 칸이 0 으로 보이는데 저장값은 2.5kg 이었다')
need("이력 수정 폼에 늘 서던 자리표시 '0' 이 없다",
  !/placeholder="0"/.test(editForm),
  "'채운 후' 칸은 비우면 채우기 전이 그대로 잔량이고, '채우기 전' 칸은 묻는 행일 수 있다. 늘 0 을 띄우면 둘 다 거짓이다")
// 안내문. 규칙과 같은 말이고 이월의 단위는 칸이 아니라 위치(패널은 품목)다.
need('안내문이 승인된 문장이고 규칙과 맞다',
  client.includes("const CHECK_GUIDE_RESTOCK = '센 위치만 적으세요. 손대지 않은 위치는 지난 점검 값을 이어받습니다. 창고에서 채웠다면 채우기 전과 채운 후를 함께 적으세요. 늘어난 만큼 창고에서 자동 차감됩니다.'") &&
  !/비워 둔 칸은 지난 점검 값을 이어받습니다/.test(client) &&
  invConstants.includes("export const CHECK_GUIDE_PANEL = '센 품목만 적으세요. 손대지 않은 품목은 지난 점검 값을 이어받습니다. 창고에서 채웠다면 채우기 전과 채운 후를 함께 적으세요. 늘어난 만큼 그 품목의 창고에서 자동 차감됩니다.'") &&
  !/const CHECK_GUIDE_PANEL/.test(client) &&
  /<p className="break-keep text-\[0\.6875rem\] text-\[var\(--warm-muted\)\] mt-0\.5">\{CHECK_GUIDE_PANEL\}<\/p>/.test(locPanel),
  "'비워 둔 칸은 이어받는다' 는 '채운 후'만 적은 행에서 비운 '채우기 전'까지 이어받는다고 읽힌다. 그 칸은 묻는 자리다")
need('안내문과 골격이 같은 상수를 break-keep 으로 그린다',
  /<p className="break-keep text-xs text-\[var\(--warm-muted\)\]">\s*\n\s*\{restockMode\s*\n\s*\? CHECK_GUIDE_RESTOCK/.test(itemForm) &&
  /<p className="break-keep text-xs" aria-hidden="true"><span className=\{`\$\{bar\}[^`]*`\}>\{CHECK_GUIDE_RESTOCK\}<\/span><\/p>/.test(client),
  '한쪽만 break-keep 이면 폭마다 줄 수가 갈려 골격이 로디드 순간 튄다')
// 서버. 화면이 보낸 값을 그대로 믿지 않는다. 세 갈래가 접기 전에 같은 검증을 지난다.
const updateBody = (() => {
  const st = actions.indexOf('export async function updateStockCheck(id: string, data: {')
  if (st < 0) return ''
  const e = actions.indexOf('\nexport ', st + 40)
  return e < 0 ? actions.slice(st) : actions.slice(st, e)
})()
need('서버 값 검증 정본이 있다',
  /export function locValuesError\(rows: \{ qty: unknown; restockedQty\?: unknown \}\[\]\): string \| null \{/.test(merge) &&
  /r\.restockedQty > r\.qty \+ HUB_SHORT_EPS/.test(merge))
need('createStockCheck 가 접기 전에 값 검증을 지난다(세 갈래)',
  /const valueError = locValuesError\(\[\s*\n\s*\.\.\.\(data\.locationPatches \?\? \[\]\)\.map\(p => \(\{ qty: p\.afterQty, restockedQty: p\.restockedQty \}\)\),\s*\n\s*\.\.\.\(data\.locationPatch \? \[\{ qty: data\.locationPatch\.afterQty, restockedQty: data\.locationPatch\.restockedQty \}\] : \[\]\),\s*\n\s*\.\.\.\(data\.locationQtys \?\? \[\]\),\s*\n\s*\]\)\s*\n\s*if \(valueError\) return \{ ok: false, error: valueError \}/.test(serverPatches) &&
  before(serverPatches, 'locValuesError(', 'applyLocationChecks('),
  '빼면 채움 > 채운 후 잔량(채우기 전이 음수인 장부)이나 음수가 그대로 저장된다')
need('updateStockCheck 가 접기 전에 값 검증을 지난다(두 갈래)',
  /const valueError = locValuesError\(\[\s*\n\s*\.\.\.\(data\.locationPatch \? \[\{ qty: data\.locationPatch\.afterQty, restockedQty: data\.locationPatch\.restockedQty \}\] : \[\]\),\s*\n\s*\.\.\.\(data\.locationQtys \?\? \[\]\),\s*\n\s*\]\)\s*\n\s*if \(valueError\) return \{ ok: false, error: valueError \}/.test(updateBody) &&
  before(updateBody, 'locValuesError(', 'applyLocationCheck(base'),
  '위치 패널의 머지 저장과 이력 수정 폼이 이 길로 온다. 한쪽만 막으면 다른 쪽으로 샌다')
// 재고 첫 로딩 골격의 패널 머리는 실제와 같은 상수를 투명 글자로 그린다(검수 권장 1). 고정 막대 두 줄이면 문장이 네
// 문장이 된 뒤 360px 에서 헤더가 로디드 순간 자랐다. 서버 컴포넌트라 'use client' 모듈이 아닌 constants 에서 읽는다.
need('로딩 골격 패널 머리가 같은 안내문 상수를 그린다',
  /import \{ CHECK_GUIDE_PANEL, LOC_PANEL_EMPTY_HINT \} from '\.\/constants'/.test(invLoading) &&
  /<p className="text-xs text-center py-6" aria-hidden="true"><span className="[^"]*text-transparent[^"]*">\{LOC_PANEL_EMPTY_HINT\}<\/span><\/p>/.test(invLoading) &&
  /text-center py-6">\{LOC_PANEL_EMPTY_HINT\}<\/p>/.test(locPanel) &&
  /<p className="break-keep text-\[0\.6875rem\] mt-0\.5" aria-hidden="true"><span className="[^"]*text-transparent[^"]*">\{CHECK_GUIDE_PANEL\}<\/span><\/p>/.test(invLoading) &&
  /<div className="flex h-5 items-center"><div className="h-4 w-24 /.test(invLoading),
  '막대 줄 수를 손으로 맞추면 폭마다 어긋난다. 같은 문장을 같은 클래스로 그려야 줄 수가 같다')
// 묻는 동안 숨기는 행 버튼 둘(웹디자이너 2026-10-19). 패널 '다른 곳으로' 는 고르기 전에 옮기면 완료 핸들러가 그 칸의
// 미저장 입력을 비우고, 이력 수정 폼 '채움 없음' 은 빈 '채우기 전'을 '채운 후'에 복사해 두 칸을 비워 잔량 0 을 저장한다.
need("위치 패널 묻는 행에는 '다른 곳으로' 가 없다",
  /\{prev != null && prev\.qty !== 0 && !movePending && \(\s*\n\s*<div className="flex">\s*\n\s*<RowActionBtn onClick=\{\(\) => setRowTransfer/.test(locPanel),
  '고르기 전에 옮기면 방금 적은 채운 후가 사라지고, 버튼 셋이 한 줄씩 서면 물음의 답처럼 읽힌다')
need("이력 수정 폼 묻는 행에는 '채움 없음' 이 없다",
  /\{!movePending && \(\s*\n\s*<RowActionBtn className="shrink-0" onClick=\{\(\) => setAfterQtys\(p => \(\{ \.\.\.p, \[l\.id\]: beforeQtys\[l\.id\] \?\? '' \}\)\)\}>\s*\n\s*채움 없음/.test(editForm),
  '누르면 두 칸이 비면서 그 행이 잔량 0 으로 저장된다')
// 임시저장 칩 기준값은 적은 글자만이다(검수 12). 해석 결과를 담으면 저장값만 바뀌어도 '임시저장 후 수정됨' 이 거짓으로 선다.
need('패널 임시저장 칩 기준값이 적은 글자만 담는다',
  /const snapshotOfInputs = \(\) => JSON\.stringify\(\{\s*\n\s*locId, date,\s*\n\s*rows: groups\.flatMap\(g => g\.items\.map\(r => \{ const k = locPairKey\(r\.id, g\.node\.id\); return \{ k, b: beforeQtys\[k\] \?\? '', a: afterQtys\[k\] \?\? '' \} \}\)\),/.test(locPanel) &&
  !/\.\.\.computeRow\(r, g\.node\.id\)/.test(locPanel),
  '저장값에 따라 갈리는 미결·최종값이 기준에 들어가면 다른 저장 뒤 칩이 거짓말을 한다')

console.log(`\n[점검 임시저장 수명주기 배선] 위반 ${fails.length}건`)
for (const f of fails) console.log('  - ' + f)
if (fails.length > 0) process.exit(1)
