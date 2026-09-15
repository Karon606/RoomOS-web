// 점검 임시저장(드래프트) 수명주기 배선 감지 — 실행: node scripts/check-draft-lifecycle.mjs
//
// 왜 필요한가. 2026-09-14 운영자 신고 — "임시저장 후 실저장을 눌렀는데 임시저장이 남아 있었고,
// 그 뒤 어느 숫자가 임시저장본이고 어느 것이 저장본인지 헷갈렸다". 근원은 기능이 아니라 **침묵**
// 이었다. 위치별 점검 패널의 doSave 가 실패를 setError 로만 적고 그대로 onClose 를 불렀는데,
// 인라인 모드의 onClose 는 화면 전환(changeView)이라 에러가 한 프레임도 안 그려졌다. 실패한
// 품목의 드래프트만 남아 '임시저장 남음' 으로 보였다.
//
// 잡는 것 일곱.
//   ① doSave 의 onClose 는 실패 0 조건 아래에만 선다.
//   ② 드래프트 삭제·저장의 반환값을 읽는다(양 화면 모두).
//   ③ 두 화면(아이템별 폼 · 위치 패널)의 임시저장 분기가 대칭이다.
//   ④ currentLocationBreakdown 이 restockedQty 를 싣는다(죽은 '지난 옮김' 표시의 근원).
//   ⑤ 이중 차감 확인창이 저장 경로에 꽂혀 있다.
//   ⑥ (2026-09-14 6단계) 서브트리 체인 저장의 세 축 — 순차·허브 마지막·이어 붙이기.
//   ⑦ (2026-09-15 '전체') 드래프트 읽기가 위치 수만큼 왕복하지 않는다.
//   ⑧ (2026-09-15 패널 안 옮기기) 완료 핸들러가 두 쌍의 입력·임시저장을 비우고, 적용취소가
//      이동 점검을 지우고 비운 값을 되쓴다.
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
  /const runChain = async \(units: LocSaveUnit\[\], forceMerge: boolean, doneBefore: number, total: number\):/.test(client))
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
need("참고줄이 '저장된 잔량' 이라고 말한다",
  (client.match(/>저장된 잔량 <strong/g) ?? []).length === 2 && !/>직전 잔량 <strong/.test(client),
  "'직전'은 임시저장본과 구별이 안 된다 — 두 화면 모두 바꿔야 한다")

// ── ④ 죽은 '지난 옮김' 표시를 살린다 ───────────────────────────────
need('currentLocationBreakdown 이 restockedQty 를 싣는다',
  /const restockedOf = new Map<string, number>\(\)/.test(overview) &&
  /\.\.\.\(rq != null \? \{ restockedQty: rq \} : \{\}\)/.test(overview),
  '안 실으면 소비처 두 곳이 항상 undefined 라 이중 차감 신호가 구조적으로 안 뜬다')
need('마커는 표시 전용이다 — 잔량 맵(cur)에 안 들어간다',
  !/cur\.set\([^\n]*restocked/.test(overview))
// 한 줄에 같은 +N 이 두 번 뜨지 않게 축을 가른다 — 저장본 대 이번 입력.
need('소비처 두 곳이 같은 문구다',
  (client.match(/· 저장된 옮김 <strong/g) ?? []).length === 2 &&
  !/· 지난 옮김/.test(client) && !/이 점검에 반영된 옮김/.test(client))
need('이번 입력 축이 두 곳 다 갈렸다',
  (client.match(/>이번 입력 <strong/g) ?? []).length === 2 && !/>창고에서 <strong/.test(client))

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
need('제목이 물음형이고 라벨 뒤 조사가 없다',
  /이미 옮긴 기록이 있습니다\. 더 옮길까요\?/.test(client))
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
  !/doubleRestockOf|더 옮길까요/.test(actions))

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
const saveUnit = fnBody(client, '  const saveUnit = (u: LocSaveUnit, forceMerge: boolean, opts?: { allowHubClamp?: boolean; forceNew?: boolean }) => {')
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
// 행 버튼 — 좌 '다른 곳으로' / 우 '옮김 없음' 한 줄. 허브 행에는 두지 않는다(§27.1).
need('비허브 행에 다른 곳으로가 있다',
  (client.match(/>\s*다른 곳으로\s*</g) ?? []).length === 1)
const rowBtnRow = (() => {
  const a = client.indexOf('<div className="flex items-center justify-between mt-1">')
  if (a < 0) return ''
  const b = client.indexOf('옮김 없음', a)
  return b < 0 ? '' : client.slice(a, b)
})()
need('두 버튼이 한 줄에 마주 선다',
  rowBtnRow.length > 0 && /다른 곳으로/.test(rowBtnRow),
  '좌 다른 곳으로 · 우 옮김 없음 — justify-between 한 줄이 목업이다')
// 장부가 0(또는 기록 없음)인 칸에서는 옮길 것이 없다 — 열어도 출발지 칩이 하나도 없는 막다른 모달이다.
need('잔량 0 행에는 다른 곳으로가 없다',
  /\{prev != null && prev\.qty !== 0 && \(/.test(client),
  '눌러도 고를 출발지가 없는 모달이 뜬다')
need('히트영역 문법이 옮김 없음과 같다',
  (client.match(/before:absolute before:content-\[''\] before:-inset-x-2 before:-top-1 before:h-11/g) ?? []).length === 2,
  '글자만이면 19px 이다 — §25 유사요소 확장으로 44px 를 낸다')
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

console.log(`\n[점검 임시저장 수명주기 배선] 위반 ${fails.length}건`)
for (const f of fails) console.log('  - ' + f)
if (fails.length > 0) process.exit(1)
