// §16 적용취소 동사 감지망 — 버튼은 '적용취소'인데 토스트만 '되돌렸습니다'로 갈리는 것을 잡는다.
//
// 왜 필요한가. §16 이 라벨을 '적용취소' 하나로 못박은 뒤에도 결과 토스트는 옛 동사로 남아 있었다.
// 같은 동작을 누를 때와 끝났을 때 두 단어로 부르면 운영자는 다른 일이 일어난 줄 안다.
// 정리한 자리는 형식이 하나다 — "{목적어}를 적용취소했습니다 · {복귀}".
//
// 두 층으로 본다. GUARDED 는 이미 고친 자리라 옛 동사가 되살아나면 붉게 선다(exit 1).
// 그 밖의 파일은 목록(info)으로만 찍는다 — 같은 짝이 보이는 자리를 다음 정비가 알아보게 두되,
// 문장 판정까지 이 그물이 대신하지는 않는다.
//
// 실행: node scripts/check-undo-verb.mjs
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

// 고친 자리와, 그 자리에서 되살아나면 안 되는 옛 문장.
const GUARDED = {
  // 확인창 둘 다 본다 — '자동값으로'(표시값 오버라이드)와 '공통 템플릿으로'(본문 오버라이드).
  // 둘 다 입주자별로 얹은 것을 무르는 동작이라 §16 이 같은 라벨을 요구한다.
  'app/contract/[tenantId]/ContractView.tsx': ['자동값으로 되돌렸습니다', '보관용으로 바뀐 것을 되돌렸습니다', "confirmLabel: '되돌리기'"],
  'components/doc/FieldOverrideListModal.tsx': ['자동값으로 되돌렸습니다'],
  'app/(app)/settings/DocVariablesPanel.tsx': ['을(를) 되돌렸습니다'],
  'app/(app)/dashboard/DashboardClient.tsx': ['이사를 되돌렸습니다'],
  'components/tenant/MoveRoomNowButton.tsx': ['이사를 되돌렸습니다'],
  'app/(app)/inventory/InventoryClient.tsx': ['입수 기록을 되돌렸습니다'],
  // 수납 내역·입주자 수납 모달의 적용취소 실패 토스트(2026-10-13 422호 2단계, R5). 버튼은 '적용취소'인데
  // 통신 실패만 '되돌리기 중'이라 불렀다. 결과 토스트 문장은 lib/cashReceiptCopy 정본(scripts/test-cash-receipt 가 글자 고정).
  'components/entity-modal/widgets/PaymentRecordList.tsx': ['되돌리기 중 통신 오류가 발생했습니다'],
  'app/(app)/tenants/TenantClient.tsx': ['되돌리기 중 통신 오류가 발생했습니다'],
  // 수납 등록 폼의 등록 적용취소 결과·실패 토스트(2026-10-14 독립 검수 R-4 와 함께 정리). '…를 취소했습니다'는 버튼
  // '적용취소'와 다른 동사였다. 결과 문장은 lib/cashReceiptCopy ENTRY_UNDONE 정본.
  'components/entity-modal/widgets/PaymentEntryForm.tsx': ['되돌리기 중 통신 오류가 발생했습니다', '수납 기록을 취소했습니다', '수납과 부가수익 기록을 취소했습니다'],
}

const violations = []
for (const [f, olds] of Object.entries(GUARDED)) {
  const lines = readFileSync(f, 'utf8').split('\n')
  lines.forEach((line, i) => {
    for (const old of olds) {
      if (line.includes(old)) violations.push(`${f}:${i + 1} — 옛 동사 '${old}'. §16 형식은 "…를 적용취소했습니다 · …".`)
    }
  })
}

// 완료 직후 토스트의 적용취소(§16 진입점 1) — 청소·작업 두 행이 같은 한 벌이라야 한다.
//
// 왜 문장만 안 보고 배선까지 보는가. 여기서 재는 것은 '동사'가 아니라 '길이 있는가'다.
// 액션 블록을 통째로 지워도 옛 동사가 안 생기므로 위 GUARDED 로는 안 걸리고, 형제 그물
// check-work-link-wiring 은 import 줄의 이름에 걸려 초록으로 통과했다(2026-09-11 역주입 실측).
const ROW_UNDO = {
  'components/cleaning/CleaningRowBody.tsx': ['reopenCleaning', '청소'],
  'components/work/RoomWorkRowBody.tsx': ['reopenRoomWork', '작업'],
}
const DONE_SENTENCE = '완료를 적용취소했습니다 · 예정으로 복귀'
for (const [f, [action, what]] of Object.entries(ROW_UNDO)) {
  // 주석은 안 본다 — "적용취소가 있다"고 적힌 설명이 검사를 통과시키면 그물이 아니라 장식이다.
  const s = readFileSync(f, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ')
  if (!/label: '적용취소'/.test(s)) {
    violations.push(`${f} — ${what} 완료 직후 토스트에 적용취소 액션이 없다(§16 진입점 1).`)
  }
  if (!new RegExp(`label: '적용취소'[\\s\\S]{0,200}${action}\\(`).test(s)) {
    violations.push(`${f} — 그 적용취소 액션이 ${action}() 를 부르지 않는다. 되돌릴 길이 이름만 남는다.`)
  }
  if (!s.includes(DONE_SENTENCE)) {
    violations.push(`${f} — 되돌린 뒤 결과 토스트 '${DONE_SENTENCE}' 가 없다(§16 "적용취소 후에도 결과 토스트").`)
  }
}

// 분류 관리 카드의 행 삭제 동사(2026-10-13, 신고 78bb0141 독립 검수 · 같은 날 운영자 승인으로 한 낱말).
//
// 같은 동작을 두 단어로 부른 셋째 모양이다. 13장 중 10장은 행 버튼·확인창이 '삭제'인데 토스트만
// "'원룸' 항목을 뺐습니다" 였고, 단위 카드는 확인창이 '빼기' 인데 행 버튼이 '삭제' 였다. 카드마다 동사를
// 쥐게 했다가(removeVerb) 13장 모두 동작이 같다는 것(목록에서만 빠지고 기록은 그대로)으로 '삭제' 한 낱말로
// 모았다. 그래서 카드별 동사 갈래가 되살아나는 것을 본다. 다섯을 본다.
//   · 카드 13장의 삭제 확인창이 같은 꼴이다. 제목 "'{이름}' {대상}을(를) 목록에서 삭제할까요?", 본문
//     "목록에서만 빠집니다. 이미 저장된 {그 카드의 기록}은(는) 그대로 있습니다.", 확인 단추 '삭제'.
//   · OptionSection 의 행 버튼 글자가 '삭제' 다.
//   · 토스트·적용취소 토스트는 문장 표(REMOVE_TOAST) 한 벌에서 읽고, 표는 '삭제' 로 말한다.
//   · 카드별 동사 갈래(removeVerb)가 없다.
//   · 분류 관리 카드·확인창·토스트 어디에도 '빼기' 계열 동사(빼기·뺄까요·뺐습니다·빼도)가 화면 글자로 남지 않는다.
const SETTINGS_FORM = 'app/(app)/settings/SettingsForm.tsx'
{
  const src = readFileSync(SETTINGS_FORM, 'utf8')
  const code = src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1 ')
  const confirmOf = new Map()
  for (const m of code.matchAll(/const (handleDelete\w+) = async \(name: string\) => \{\n\s*if \(!\(await confirmDialog\(\{([^\n]*)\}\)\)\) return false/g)) {
    confirmOf.set(m[1], m[2])
  }
  const cards = [...code.matchAll(/<OptionSection\b[\s\S]*?\/>/g)].map(m => m[0])
  if (cards.length < 13) violations.push(`${SETTINGS_FORM} · OptionSection 카드를 ${cards.length}장만 찾았다(13 기대).`)
  const TITLE = /^\s*title: `'\$\{[^}]+\}' [^`'$]+[을를] 목록에서 삭제할까요\?`, /
  const MESSAGE = /message: '목록에서만 빠집니다\. 이미 저장된 [^']+[은는] 그대로 있습니다\.'/
  for (const card of cards) {
    const title = card.match(/title="([^"]+)"/)?.[1] ?? '(제목 없음)'
    if (/\bremoveVerb\b/.test(card)) violations.push(`${SETTINGS_FORM} · '${title}' 카드가 removeVerb 를 넘긴다. 13장 모두 '삭제' 한 낱말이다.`)
    const handler = card.match(/onDelete=\{(\w+)\}/)?.[1]
    const dlg = handler ? confirmOf.get(handler) : undefined
    if (!dlg) { violations.push(`${SETTINGS_FORM} · '${title}' 카드의 삭제 확인창을 못 읽었다(onDelete 핸들러의 confirmDialog).`); continue }
    if (!TITLE.test(dlg)) violations.push(`${SETTINGS_FORM} · '${title}' 카드 삭제 확인창 제목이 "'{이름}' {대상}을 목록에서 삭제할까요?" 꼴이 아니다.`)
    if (!MESSAGE.test(dlg)) violations.push(`${SETTINGS_FORM} · '${title}' 카드 삭제 확인창 본문이 "목록에서만 빠집니다. 이미 저장된 …은 그대로 있습니다." 꼴이 아니다.`)
    if (!/confirmLabel: '삭제'/.test(dlg)) violations.push(`${SETTINGS_FORM} · '${title}' 카드 삭제 확인창의 확인 단추가 '삭제' 가 아니다.`)
  }
  // OptionSection 본문만 자른다(다음 최상위 function 앞까지). 뒤 컴포넌트의 '삭제' 버튼이 대신 통과시키지 않게.
  const at = code.indexOf('function OptionSection(')
  const rest = at < 0 ? '' : code.slice(at)
  const body = rest.indexOf('\nfunction ', 1) < 0 ? rest : rest.slice(0, rest.indexOf('\nfunction ', 1))
  if (!body) violations.push(`${SETTINGS_FORM} · OptionSection 을 못 찾았다.`)
  else {
    if (/\bremoveVerb\b/.test(body)) violations.push(`${SETTINGS_FORM} · OptionSection 에 카드별 동사 갈래(removeVerb)가 되살아났다.`)
    if (!/onClick=\{\(\) => handleDelete\(item\)\}\s*className="[^"]*">삭제<\/button>/.test(body)) violations.push(`${SETTINGS_FORM} · OptionSection 행 삭제 버튼 글자가 '삭제' 가 아니다.`)
    if (!/REMOVE_TOAST\.done\(/.test(body) || !/REMOVE_TOAST\.undone\(/.test(body)) violations.push(`${SETTINGS_FORM} · OptionSection 토스트가 문장 표(REMOVE_TOAST)를 안 읽는다.`)
  }
  const table = code.match(/const REMOVE_TOAST = \{([\s\S]*?)\} as const/)?.[1] ?? ''
  if (!/done: \(label: string\) => `'\$\{label\}' 항목을 삭제했습니다`/.test(table) || !/undone: \(label: string\) => `'\$\{label\}' 삭제를 적용취소했습니다 · 원래 자리로 복귀`/.test(table)) {
    violations.push(`${SETTINGS_FORM} · REMOVE_TOAST 가 '삭제' 로 말하지 않는다('항목을 삭제했습니다' · '삭제를 적용취소했습니다 · 원래 자리로 복귀' 기대).`)
  }
  // 화면 글자에 '빼기' 계열 동사가 남았는가. 분류 관리 탭(카드 묶음)·확인창 핸들러·OptionSection·문장 표를 본다.
  const tab = code.match(/\{tab === 'options' && \([\s\S]*?<ItemSpecOptionsPanel \/>/)?.[0] ?? ''
  if (!tab) violations.push(`${SETTINGS_FORM} · 분류 관리 탭 묶음을 못 찾았다.`)
  const handlers = [...confirmOf.values()].join('\n')
  for (const [where, text] of [['분류 관리 탭', tab], ['삭제 확인창', handlers], ['OptionSection', body], ['REMOVE_TOAST', table]]) {
    const hit = text.match(/빼기|뺄까요|뺐습니다|빼도|빼면/)
    if (hit) violations.push(`${SETTINGS_FORM} · ${where} 화면 글자에 '${hit[0]}' 가 있다. 분류 관리 13장은 '삭제' 한 낱말이다.`)
  }
}

// 별건 목록 — 라벨 '적용취소' 와 토스트 '되돌렸습니다' 가 한 파일에 같이 있는 자리.
const others = []
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue
    const full = join(dir, name)
    if (statSync(full).isDirectory()) { walk(full); continue }
    if (!/\.tsx?$/.test(name) || GUARDED[full]) continue
    const src = readFileSync(full, 'utf8')
    if (src.includes("label: '적용취소'") && src.includes('되돌렸습니다')) others.push(full)
  }
}
for (const r of ['components', 'app']) walk(r)

console.log(`[적용취소 동사] 동사 ${Object.keys(GUARDED).length}곳 · 완료 직후 진입점 ${Object.keys(ROW_UNDO).length}곳 · 분류 관리 카드 삭제 동사 검사 / 위반 ${violations.length}건`)
if (others.length > 0) {
  console.log('  (별건) 라벨 적용취소 + 토스트 되돌렸습니다 가 같이 있는 파일:')
  for (const f of others) console.log(`    · ${f}`)
}
if (violations.length > 0) {
  console.error('')
  for (const v of violations) console.error(`  - ${v}`)
  console.error('')
  console.error('  누를 때와 끝났을 때를 두 단어로 부르면 운영자는 다른 일이 일어난 줄 안다(§16).')
  process.exit(1)
}
