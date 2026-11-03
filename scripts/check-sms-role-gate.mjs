// 고객 문자·메일 권한 감지망. 열람 전용 직원(STAFF·제한 스태프)이 고객에게 문자·메일을 보낼 길이 다시 열리면 붉게 선다. 읽기 전용, 위반 시 exit 1.
//
// 왜 필요한가(2026-11-03 운영자 지시). 원문 "열람만 할 수 있는 직원은 고객에게 문자를 보낼 수 없고 그 위 권한부터 가능하도록해줘".
// 문자는 서버가 보내지 않는다. sms: 링크로 누른 사람 폰의 문자앱을 여는 구조라 **화면에서 막는 것이 실제 차단**이고,
// 서버는 문자를 짜는 조회(번호·템플릿·수신자)와 발송 시도 기록을 거부한다. 한쪽만 남으면 다른 쪽이 새 길이 된다.
//
// 메일(2026-11-03 운영자 승인 '추천대로')은 서버가 보내므로 서버 문이 실제 차단이고, 화면은 입구를 숨긴다.
//
// 축은 ⓐ~ⓜ 열둘이다(ⓚ·ⓛ 은 계약서·확인서 화면).
//   ⓐ 서버 문. 문자를 짜거나 기록하거나 서명 요청 링크(문자로 나간다)를 만드는 액션은 첫 DB 호출 전에 무조건 `await requireEdit()` 를 부른다.
//   ⓑ 입구 전수. app·components·lib 에서 문자앱을 여는 자리(sms: 리터럴, singleSmsHref, sendWithText)와 문자 창 렌더를 모두 찾아
//      SINKS 표와 대조한다. 표에 없는 새 자리는 붉다(등록하고 canEditUi 로 막을 것).
//   ⓒ 문자 창 렌더. 문자 창(입주자·미납·단체·서류 문자) 을 그리는 자리는 그 줄이나 바로 윗줄에 `canEditUi &&`(또는 canEdit &&) 가 있고,
//      그 값은 useCanEdit()(OWNER·MANAGER) 에서 온다. useCanEditScope 는 제한 스태프를 통과시키므로 안 된다.
//   ⓓ 입구 버튼. 연락처 '문자'·'독촉 문자', 홈 알림 '독촉 문자 보내기', 미납 목록 '안내문자', 서류 시트 '문자' 갈래,
//      계약서 칸 '서명 요청 보내기', 고객 관리 '단체 문자', 계약서 화면 '서명 요청' 이 열람 역할에게 서지 않는다.
//   ⓔ 역할 컨텍스트가 닿는 트리(2026-11-03 독립 검수 차단). RoleContext 기본값이 OWNER 라 Provider 밖에서 그린 역할 훅은
//      말없이 '편집 가능'을 답한다. Prism 모달(EntityModalProvider 가 그린다)·전역 검색·신고 버튼이 그 밖에 있어
//      열람 직원에게 문자·메모 편집이 섰다. (app) 레이아웃에서 RoleProvider 가 AppShell 을 통째로 감싸는지,
//      (app) 밖 라우트(app/contract·app/sign 등)가 역할 훅을 직접 쓰거나 역할 훅을 쓰는 컴포넌트를 직접 import 하지 않는지 본다.
//   ⓕ 메일. 서류 메일의 초안·미리보기·발송은 ⓐ 의 서버 문을 지나고, 메일 입구(mailto: 링크·서류 시트 '메일' 갈래·메일 쓰기 시트·
//      메일 액션 호출)는 MAIL_SINKS 표 안에서만 서며 열람 역할에게 canEditUi 로 숨는다.
//   ⓖ 내보내기의 '문자로 보내기'(2026-11-03 운영자 승인). SendDocButton 은 canSendSms 를 필수로 받아 그 값이 거짓이면 그 갈래를 세우지 않는다.
//      모든 사용처가 값을 넘기고, (app) 안은 useCanEdit(), 밖 화면은 page 가 lib/role canEdit 로 넘긴 prop 이다. 공유 창(일반 '공유')은 그대로다.
//   ⓗ 고객·호실 상세(Prism)와 계약서 화면의 쓰기 입구(2026-11-03 운영자 승인). 서버가 requireEdit 로 거절하는 동작은 열람 역할에게
//      화면도 세우지 않는다(캡션 없이 숨김, 가이드 §27.8 ②). EDIT_GATES 표의 각 입구가 canEditUi(useCanEdit) 또는 page 가 넘긴 prop 아래에 있고,
//      같은 손(핸들러)이 가드 밖에 또 생기지 않게 개수를 고정한다.
//   ⓘ 쓰기 행을 세우는 조회(getRoomScheduleState·getRoomBusyNotice, 서버 requireEdit)는 열람 역할에게 부르지 않는다(모달마다 500).
//      서버 문은 낮추지 않는다. 부르는 자리가 입주자 상세(가드)와 수정 폼(편집자만 연다) 밖으로 늘면 붉다.
//   ⓚ 계약서 화면 읽기 전용(2026-11-04 운영자 승인 '추천대로'). page 가 역할을 데이터보다 먼저 읽어 제한 스태프는 404, 서명본(?share=)은
//      열람 역할을 일반 화면으로 보낸다. ContractView 는 viewOnly 하나로 쓰기 입구(납부일 창·칸 입력·흡연·비상연락처·성명 표기·서명 받기·
//      서명 지우기·재서명·내보내기·발급·직접 입력 되돌리기)를 세우지 않고, 칸은 원격과 같은 글자 갈래를 잠김 갈래보다 먼저 탄다.
//   ⓜ 계약서 칸의 계약서 화면 입구(2026-11-04 운영자 승인 '추천대로'). STAFF 에게는 '계약서 보기'(읽기 전용 화면), 제한 스태프는 money 를 못 읽어
//      서버가 거절하므로 문이 없다. 판정은 useCanEdit() 와 useCanReadScope('money') 이고, 서명본 문(signedViewLinkId)은 편집 갈래의 shareLink 에서만 나온다.
//   ⓙ 열람 역할용 서명 상태 조회(2026-11-04 운영자 승인 '추천대로'). getContractSignBadge 는 requireEdit 없이 영업장 문(requirePropertyAccess)을
//      첫 DB 호출보다 먼저 지나고, 토큰·URL·연락처·신원 칸을 읽지도 싣지도 않으며(select 만, include 금지), 진행은 계약 축 판정 badgeOf 를 부른다.
//      응답 타입 ContractSignBadgeInfo 의 칸은 배지 여섯(expiresAt·closedAt·lockedAt·submittedAt·signStage·signSummary)뿐이다.
//
// 실행: node scripts/check-sms-role-gate.mjs
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = process.cwd()
const strip = s => s
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, m => m.replace(/[^\n]/g, ''))
  .replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ''))
  .replace(/^[^\S\n]*\/\/.*$/gm, '')
const read = f => strip(readFileSync(join(ROOT, f), 'utf8'))

const violations = []
const need = (ok, msg) => { if (!ok) violations.push(msg) }

// ⓐ 서버 문
const SERVER = {
  'app/(app)/dashboard/actions.ts': ['getUnpaidSmsContext', 'getPersonalSmsContext', 'logPersonalSmsAttempt', 'logSmsAttempt'],
  'app/(app)/tenants/docBundle.ts': ['logDocSmsAttempt', 'getTenantDocMailDraft', 'previewTenantDocMail', 'sendTenantDocBundleMail'],
  'app/(app)/tenants/noticeSms.ts': ['getNoticeSmsTargets', 'logNoticeSmsAttempt', 'polishNoticeText', 'saveNoticeTemplateAuto'],
  // getContractShareState 는 토큰(URL)·링크 id·주 연락처를 준다. 열람 역할의 배지는 ⓙ 의 getContractSignBadge 가 맡는다.
  'app/(app)/tenants/contractShare.ts': ['issueContractShareLink', 'renewContractShareLink', 'getContractShareState'],
}
for (const [f, fns] of Object.entries(SERVER)) {
  const s = read(f)
  need(/import \{[^}]*\brequireEdit\b[^}]*\} from '@\/lib\/role'/.test(s), `${f}: requireEdit 를 '@/lib/role' 에서 가져오지 않는다.`)
  for (const fn of fns) {
    const start = s.indexOf(`export async function ${fn}(`)
    if (start < 0) { violations.push(`${f}: ${fn} 가 없다(이름이 바뀌었으면 이 표도 고친다).`); continue }
    const next = s.indexOf('\nexport ', start + 1)
    const body = s.slice(start, next < 0 ? s.length : next)
    // 무조건 실행되는 자리만 센다 — 함수 맨 위(2칸) 또는 try 바로 안 첫머리(4칸)의 단독 문장이고, 다른 await 보다 먼저다.
    const gate = body.search(/\n( {2}| {4})await requireEdit\(\)\n/)
    const firstAwait = body.search(/\bawait (?!requireEdit\(\))/)
    need(gate >= 0 && (firstAwait < 0 || gate < firstAwait), `${f}: ${fn} 의 requireEdit 가 다른 await(조회·발송 준비)보다 뒤에 있다.`)
    // 무엇이 새는지 함수 축으로 갈라 말한다 — 메일 액션은 고객에게 메일이 나가고, 나머지는 문자를 짜거나 남긴다.
    const leak = /Mail/.test(fn) ? '열람 역할이 고객에게 메일을 보낸다' : '열람 역할이 문자를 짜거나 남긴다'
    need(gate >= 0, `${f}: ${fn} 가 무조건 실행되는 'await requireEdit()' 를 갖지 않는다(${leak}).`)
    const firstDb = body.search(/\bprisma\.|\btx\./)
    need(gate >= 0 && (firstDb < 0 || gate < firstDb), `${f}: ${fn} 의 requireEdit 가 첫 DB 호출보다 뒤에 있다.`)
  }
}

// ⓑ 입구 전수
// kind: 'helper' = 링크 조립 정본, 'ctx' = 문자 창 안(번호·수신자가 ⓐ 의 조회에서만 온다), 'parent' = 부모가 canEditUi 로 렌더를 막는 창,
//       'entry' = 문자 창을 그리는 입구(ⓒ·ⓓ), 'server' = 서명 요청 링크 발급(ⓐ requireEdit) 성공 뒤에만 문자앱을 연다.
const SINKS = {
  'lib/smsHref.ts': 'helper',
  'components/TenantSmsModal.tsx': 'ctx',
  'components/UnpaidSmsModal.tsx': 'ctx',
  'components/NoticeSmsModal.tsx': 'ctx',
  'components/doc/TenantDocSmsComposeSheet.tsx': 'parent',
  'components/entity-modal/widgets/TenantContactInfo.tsx': 'entry',
  'app/(app)/dashboard/DashboardClient.tsx': 'entry',
  'app/(app)/tenants/TenantClient.tsx': 'entry',
  'components/doc/TenantDocBundleSheet.tsx': 'entry',
  'components/entity-modal/widgets/ContractFilesPanel.tsx': 'server',
  'app/contract/[tenantId]/ContractView.tsx': 'server',
}
// 날 sms: 리터럴 개수(파일별). 링크 조립 정본·문자 창 안·서명 요청 발급 뒤만 있다.
const RAW_SMS = {
  'lib/smsHref.ts': 1,
  'components/NoticeSmsModal.tsx': 2,
  'components/UnpaidSmsModal.tsx': 1,
  'components/entity-modal/widgets/ContractFilesPanel.tsx': 2,
  'app/contract/[tenantId]/ContractView.tsx': 2,
}
const CTX_SOURCE = {
  'components/TenantSmsModal.tsx': /\bgetPersonalSmsContext\(/,
  'components/UnpaidSmsModal.tsx': /\bgetUnpaidSmsContext\(/,
  'components/NoticeSmsModal.tsx': /\bgetNoticeSmsTargets\(/,
}
const MODAL_TAG = /<(TenantSmsModal|UnpaidSmsModal|NoticeSmsModal|TenantDocSmsComposeSheet)\b/
const SINK_RE = [
  [/[`'"]sms:/, 'sms: 링크'],
  [/\bsingleSmsHref\(/, 'singleSmsHref'],
  [/\.sendWithText\(/, '공유 창 문자 보내기(sendWithText)'],
  [MODAL_TAG, '문자 창 렌더'],
]
const walk = dir => readdirSync(join(ROOT, dir)).flatMap(n => {
  const p = join(dir, n)
  if (n === 'node_modules' || n === 'generated' || n.startsWith('.')) return []
  return statSync(join(ROOT, p)).isDirectory() ? walk(p) : /\.(ts|tsx)$/.test(n) ? [p] : []
})
const found = new Set()
for (const f of ['app', 'components', 'lib'].flatMap(walk)) {
  const s = read(f)
  for (const [re, what] of SINK_RE) {
    if (!re.test(s)) continue
    found.add(f)
    need(f in SINKS, `${f}: 문자 입구(${what})가 새로 생겼다. 열람 역할(STAFF·제한 스태프)에게 막고 SINKS 표에 등록할 것.`)
  }
  // 날 sms: 링크는 자리 단위로 센다. 등록된 입구 파일 안이라도 새 링크가 생기면 붉다(연락처 줄에 sms: 를 바로 거는 식).
  const raw = (s.match(/[`'"]sms:/g) ?? []).length
  need(raw === (RAW_SMS[f] ?? 0), `${f}: sms: 링크가 ${raw}곳이다(기대 ${RAW_SMS[f] ?? 0}). 새 자리면 열람 역할에게 막고 RAW_SMS 표를 고친다.`)
}
for (const f of Object.keys(SINKS)) need(found.has(f), `${f}: SINKS 표에 있는데 문자 입구가 안 보인다(정규식이 낡았거나 자리가 옮겨 갔다).`)
for (const [f, re] of Object.entries(CTX_SOURCE)) need(re.test(read(f)), `${f}: 번호·수신자를 requireEdit 조회(ⓐ)에서 받지 않는다.`)

// ⓒ 문자 창 렌더 — 입구 파일마다
for (const [f, kind] of Object.entries(SINKS)) {
  const s = read(f)
  const lines = s.split('\n')
  lines.forEach((ln, i) => {
    if (!MODAL_TAG.test(ln)) return
    const near = `${lines[i - 1] ?? ''}\n${ln}`
    need(/\bcanEdit(Ui)? &&/.test(near), `${f}:${i + 1}: 문자 창을 canEditUi && 없이 그린다.`)
  })
  if (/\bcanEditUi\b/.test(s)) {
    need(/const canEditUi = useCanEdit\(\)/.test(s), `${f}: canEditUi 가 useCanEdit() 에서 오지 않는다(useCanEditScope 는 제한 스태프를 통과시킨다).`)
    need(!/const canEditUi = useCanEditScope\(/.test(s), `${f}: 문자 입구에 useCanEditScope 를 쓴다.`)
  }
  if (kind === 'entry' || kind === 'server') {
    if (f.endsWith('ContractView.tsx')) continue
    need(/\bcanEdit(Ui)?\b/.test(s), `${f}: 문자 입구인데 역할 가드가 없다.`)
  }
}
{
  const s = read('app/(app)/tenants/TenantClient.tsx')
  need(/const canEdit = myRole === 'OWNER' \|\| myRole === 'MANAGER'/.test(s), `TenantClient: canEdit 이 OWNER·MANAGER 판정이 아니다.`)
}

// ⓓ 입구 버튼
const BUTTONS = [
  ['components/entity-modal/widgets/TenantContactInfo.tsx', /\{canEditUi && \(\s*<button type="button" onClick=\{\(\) => setSmsOpen\(true\)\}/, "연락처 '문자'"],
  ['components/entity-modal/widgets/TenantContactInfo.tsx', /\{canEditUi && unpaidTarget && phone && \(\s*<button type="button" onClick=\{\(\) => setUnpaidOpen\(true\)\}/, "연락처 '독촉 문자'"],
  ['app/(app)/dashboard/DashboardClient.tsx', /\{canEditUi && alert\.category === 'unpaid'[\s\S]{0,300}?onClick=\{\(\) => setUnpaidSmsOpen\(true\)\}/, "홈 알림 '독촉 문자 보내기'"],
  ['app/(app)/dashboard/DashboardClient.tsx', /\{canEditUi && isUnpaidSmsTarget\(l\) && \(\s*<RowActionBtn[^>]*\n?[^>]*onClick=\{\(\) => setSmsTarget\(/, "미납 목록 '안내문자'"],
  ['components/doc/TenantDocBundleSheet.tsx', /\.\.\.\(shareSupported && canEditUi \? \[\{ value: 'sms' as const/, "서류 시트 '문자' 갈래"],
  ['components/entity-modal/widgets/ContractFilesPanel.tsx', /const hideSignRequest = hideSignRequestProp \|\| !canEditUi/, "계약서 칸 '서명 요청 보내기' 숨김 판정"],
  ['components/entity-modal/widgets/ContractFilesPanel.tsx', /\{!hideSignRequest && \(\s*<Btn[^>]*\n?[^>]*onClick=\{handleShareSend\}/, "계약서 칸 '서명 요청 보내기' 버튼"],
  ['app/(app)/tenants/TenantClient.tsx', /\{canEdit && \(\s*<div[^>]*>\s*<Btn[^>]*onClick=\{\(\) => setShowNoticeSms\(true\)\}/, "고객 관리 '단체 문자'"],
]
for (const [f, re, what] of BUTTONS) need(re.test(read(f)), `${f}: ${what} 가 열람 역할에게 선다(canEditUi 가드가 없다).`)
// 열람 역할에게는 할 수 없는 문(작성·발급·다시 보내기)을 주 버튼으로 올리지 않고, 거절될 링크 상태 조회도 부르지 않는다(독립 검수 R2).
{
  const s = read('components/entity-modal/widgets/ContractFilesPanel.tsx')
  need(/const stage = canEditUi \? stageByState : \{ primary: null, hint: null \}/.test(s),
    `ContractFilesPanel: 열람 역할에게 주 버튼(작성·발급·다시 보내기)이나 안내(폐기·발급을 시키는 문장)를 올린다.`)
  // 열람 갈래는 토큰 없는 서명 상태 조회(ⓙ)만 부르고 return 한다. 토큰을 주는 링크 상태 조회는 그 뒤 편집 갈래에만 있다.
  need(/const reloadShare = async \(\) => \{\s*if \(!canEditUi\) \{\s*setShare\([^\n]*\)\s*const r = await getContractSignBadge\(tenantId\)\s*setBadgeLink\(r\.ok \? r\.link : null\)\s*if \(!r\.ok\) pushToast\('error', r\.error\)\s*return\s*\}\s*const res = await getContractShareState\(/.test(s),
    `ContractFilesPanel: 열람 갈래가 서명 상태 조회(getContractSignBadge)만 부르고 끝나지 않는다(토큰을 주는 링크 상태 조회가 열람 역할에게 불리거나 배지가 사라진다).`)
  need((s.match(/\bgetContractShareState\(/g) ?? []).length === 1 && (s.match(/\bgetContractSignBadge\(/g) ?? []).length === 1,
    `ContractFilesPanel: 링크 상태 조회·서명 상태 조회를 부르는 자리가 하나씩이 아니다.`)
  const callers = ['app', 'components'].flatMap(walk).filter(f => /\bgetContractShareState\(/.test(read(f)) && f !== 'app/(app)/tenants/contractShare.ts')
  need(callers.join(',') === 'components/entity-modal/widgets/ContractFilesPanel.tsx', `링크 상태 조회(토큰)를 부르는 자리가 계약서 칸 밖으로 늘었다: ${callers.join(', ')}`)
}
// 같은 여는 손이 가드 밖에 또 생기지 않게 — 여는 호출 개수를 고정한다.
const OPENERS = [
  ['components/entity-modal/widgets/TenantContactInfo.tsx', /setSmsOpen\(true\)/g, 1],
  ['components/entity-modal/widgets/TenantContactInfo.tsx', /setUnpaidOpen\(true\)/g, 1],
  ['app/(app)/dashboard/DashboardClient.tsx', /setUnpaidSmsOpen\(true\)/g, 1],
  ['app/(app)/dashboard/DashboardClient.tsx', /setSmsTarget\(\{/g, 1],
  ['components/doc/TenantDocBundleSheet.tsx', /setSmsOpen\(true\)/g, 1],
  ['components/entity-modal/widgets/ContractFilesPanel.tsx', /onClick=\{handleShareSend\}/g, 1],
  ['app/(app)/tenants/TenantClient.tsx', /setShowNoticeSms\(true\)/g, 1],
]
for (const [f, re, n] of OPENERS) {
  const c = (read(f).match(re) ?? []).length
  need(c === n, `${f}: 문자를 여는 손 ${re.source} 이 ${c}곳이다(기대 ${n}). 새 자리면 canEditUi 로 막고 이 표를 고친다.`)
}
// 서명 요청 화면(ContractView)은 RoleProvider 밖이다. 버튼은 page 가 넘기는 canSendSms(lib/role canEdit)로 숨기고,
// 문자앱은 발급(requireEdit) 성공 뒤에만 열린다는 것도 본다.
{
  const page = read('app/contract/[tenantId]/page.tsx')
  need(/import \{[^}]*\bgetMyRole\b[^}]*\bcanEdit\b[^}]*\} from '@\/lib\/role'|import \{[^}]*\bcanEdit\b[^}]*\bgetMyRole\b[^}]*\} from '@\/lib\/role'/.test(page)
    && /<ContractView data=\{data\} translationLangs=\{translationLangs\} canSendSms=\{canEdit\(role\)\}[^/]*\/>/.test(page),
    `app/contract/[tenantId]/page.tsx: 계약서 화면에 canSendSms={canEdit(role)} 를 넘기지 않는다(열람 직원에게 '서명 요청' 이 선다).`)
  const v = read('app/contract/[tenantId]/ContractView.tsx')
  need(/canSendSms, canEdit \}: \{/.test(v) && /\n {2}canSendSms: boolean\n/.test(v) && /\n {2}canEdit: boolean\n/.test(v) && !/canSendSms = |canEdit = /.test(v) && /\) : canSendSms \? \(\s*<button onClick=\{handleSignRequest\}/.test(v) && (v.match(/onClick=\{handleSignRequest\}/g) ?? []).length === 1,
    `ContractView: '서명 요청' 버튼이 canSendSms 가드 밖에 있다.`)
}
{
  const s = read('app/contract/[tenantId]/ContractView.tsx')
  const issue = s.indexOf('await issueContractShareLink(')
  const sms = s.search(/[`'"]sms:/)
  need(issue >= 0 && sms > issue && /if \(!res\.ok\) \{ pushToast\('error', res\.error\); return \}/.test(s.slice(issue, sms)),
    `ContractView: 문자앱이 서명 요청 링크 발급(requireEdit) 성공 뒤에만 열리지 않는다.`)
}

// ⓔ 역할 컨텍스트가 닿는 트리
{
  const L = 'app/(app)/layout.tsx'
  const s = read(L)
  const ret = s.slice(s.lastIndexOf('\n  return ('))
  const open = ret.indexOf('<RoleProvider'), shell = ret.indexOf('<AppShell')
  const shellEnd = ret.indexOf('</AppShell>'), close = ret.indexOf('</RoleProvider>')
  need((s.match(/<RoleProvider\b/g) ?? []).length === 1, `${L}: RoleProvider 가 한 번이 아니다.`)
  need(open >= 0 && shell > open && shellEnd > shell && close > shellEnd,
    `${L}: RoleProvider 가 AppShell 을 통째로 감싸지 않는다(Prism 모달·전역 검색·신고 버튼의 역할 훅이 기본값 OWNER 를 읽는다).`)
  const HOOK = /\buse(CanEdit|CanEditScope|CanReadScope|MyRole)\(/
  const hookFiles = new Set(['app', 'components', 'lib'].flatMap(walk).filter(f => f !== 'components/RoleContext.tsx' && HOOK.test(read(f))))
  for (const f of walk('app')) {
    if (f.startsWith('app/(app)/')) continue
    const s2 = read(f)
    need(!HOOK.test(s2), `${f}: (app) 레이아웃 밖 라우트가 역할 훅을 쓴다(RoleProvider 가 없어 늘 OWNER). 역할은 서버에서 prop 으로 넘긴다.`)
    for (const m of s2.matchAll(/from '@\/([^']+)'/g)) {
      const base = m[1]
      const hit = [...hookFiles].find(h => h === `${base}.tsx` || h === `${base}.ts`)
      if (hit) violations.push(`${f}: (app) 레이아웃 밖에서 역할 훅을 쓰는 ${hit} 를 그린다(RoleProvider 가 없어 늘 OWNER).`)
    }
  }
}

// ⓕ 메일 입구
{
  // kind: 'entry' = 열람 역할에게 canEditUi 로 숨는 입구, 'parent' = 부모가 canEditUi 로 렌더를 막는 창, 'public' = 고객이 아니라 회사 문의 주소.
  const MAIL_SINKS = {
    'components/entity-modal/widgets/TenantContactInfo.tsx': 'entry',
    'components/doc/TenantDocBundleSheet.tsx': 'entry',
    'components/doc/TenantDocMailComposeSheet.tsx': 'parent',
    'app/(portal)/page.tsx': 'public',
    'lib/pushSend.ts': 'public',   // 웹 푸시 VAPID subject(발신자 표기), 고객에게 가는 메일이 아니다
  }
  const MAIL_RE = [
    [/[`'"]mailto:/, 'mailto: 링크'],
    [/<TenantDocMailComposeSheet\b/, '메일 쓰기 시트 렌더'],
    [/\b(getTenantDocMailDraft|previewTenantDocMail|sendTenantDocBundleMail)\(/, '메일 액션 호출'],
  ]
  const seen = new Set()
  for (const f of ['app', 'components', 'lib'].flatMap(walk)) {
    if (f === 'app/(app)/tenants/docBundle.ts') continue
    const s = read(f)
    for (const [re, what] of MAIL_RE) {
      if (!re.test(s)) continue
      seen.add(f)
      need(f in MAIL_SINKS, `${f}: 메일 입구(${what})가 새로 생겼다. 열람 역할(STAFF·제한 스태프)에게 막고 MAIL_SINKS 표에 등록할 것.`)
    }
  }
  for (const f of Object.keys(MAIL_SINKS)) need(seen.has(f), `${f}: MAIL_SINKS 표에 있는데 메일 입구가 안 보인다(정규식이 낡았거나 자리가 옮겨 갔다).`)
  const contact = read('components/entity-modal/widgets/TenantContactInfo.tsx')
  need(/\{canEditUi && \(\s*<a href=\{email \? `mailto:/.test(contact) && (contact.match(/[`'"]mailto:/g) ?? []).length === 1,
    `TenantContactInfo: 연락처 '메일'(mailto:) 이 열람 역할에게 선다.`)
  const sheet = read('components/doc/TenantDocBundleSheet.tsx')
  need(/\.\.\.\(mailOn && canEditUi \? \[\{ value: 'mail' as const/.test(sheet), `TenantDocBundleSheet: '메일' 갈래가 열람 역할에게 선다.`)
  need(/\{canEditUi && composeOpen && \(\s*<TenantDocMailComposeSheet/.test(sheet) && (sheet.match(/<TenantDocMailComposeSheet\b/g) ?? []).length === 1,
    `TenantDocBundleSheet: 메일 쓰기 시트를 canEditUi 없이 그린다.`)
  need(!/mailOn \? 'mail'/.test(sheet), `TenantDocBundleSheet: 갈래 대체 규칙이 열람 역할을 '메일' 로 보낸다.`)
  need(/^\s*process\.env\.VAPID_SUBJECT \|\| 'mailto:no-reply@stayeum\.com',$/m.test(read('lib/pushSend.ts')) && (read('lib/pushSend.ts').match(/mailto:/g) ?? []).length === 1,
    `lib/pushSend.ts: VAPID subject 말고 mailto: 가 생겼다.`)
  const portal = read('app/(portal)/page.tsx')
  need(!/mailto:\$\{(?!CONTACT_EMAIL\})/.test(portal), `app/(portal)/page.tsx: 회사 문의 주소가 아닌 mailto: 가 생겼다.`)
}

// ⓖ 내보내기 '문자로 보내기'
{
  const B = 'components/ui/SendDocButton.tsx'
  const b = read(B)
  need(/className, canSendSms \}: \{/.test(b) && /\n {2}canSendSms: boolean\n/.test(b) && !/canSendSms = true/.test(b),
    `${B}: canSendSms 가 필수 prop 이 아니다(넘기지 않은 자리가 '문자로 보내기' 를 연다).`)
  // 열람 역할 분기 — 목적지 창 없이 형식만 고르고 바로 저장한다. 답이 하나뿐인 질문 창을 두지 않는다(2026-11-03 운영자 지적).
  const askStart = b.indexOf('const ask = async (isImage: boolean)')
  const viewer = askStart < 0 ? '' : b.slice(b.indexOf('if (!canSendSms) {', askStart), b.indexOf('for (;;) {', askStart))
  need(viewer.length > 0 && b.indexOf('if (!canSendSms) {', askStart) < b.indexOf('for (;;) {', askStart),
    `${B}: 열람 역할 분기(if (!canSendSms))가 목적지 창 고리보다 먼저 끝나지 않는다.`)
  need((viewer.match(/choiceDialog\(/g) ?? []).length === 1 && /title: '어떤 형식으로 저장할까요\?'/.test(viewer) && !/backLabel/.test(viewer),
    `${B}: 열람 역할 분기가 형식 창 하나만 띄우지 않는다(목적지 창·되짚기 길이 남았다).`)
  need(/if \(isImage\) \{[\s\S]*?return \{ asPng: false, toPhone: false \}\s*\}/.test(viewer) && (viewer.match(/toPhone: false/g) ?? []).length === 2 && !/toPhone: (true|dest|format)/.test(viewer),
    `${B}: 열람 역할 분기가 바로 기기 저장으로 가지 않는다.`)
  need(!/문자/.test(viewer), `${B}: 열람 역할 분기에 문자 이야기가 남았다.`)
  need(/viaSheet\s*\?\s*'[^']*\[이미지 저장\][^']*\[파일에 저장\][^']*'/.test(viewer), `${B}: 열람 역할 형식 창이 아이폰 공유 창 안내를 잃었다.`)
  // 이미지(형식 질문 없음) + 아이폰 + 열람 역할은 안내형 확인 창(사실 제목 + '공유 창 열기')으로 말한다. 토스트는 공유 창에 가린다.
  need(/if \(viaSheet && !\(await confirmDialog\(\{\s*title: '공유 창에서 저장합니다',\s*message: '공유 창에서 \[이미지 저장\]을 누르면 사진첩에 저장됩니다\.',\s*confirmLabel: '공유 창 열기',/.test(viewer)
    && (viewer.match(/confirmDialog\(/g) ?? []).length === 1 && !/pushToast/.test(viewer) && !/공유 창에서 \[이미지 저장\]을 누르면 사진첩에 저장됩니다\.'\)/.test(b.slice(b.indexOf('const handleSend'))),
    `${B}: 열람 역할 + 이미지 + 아이폰 경로가 안내형 확인 창으로 공유 창 안내를 하지 않는다(토스트는 공유 창에 가린다).`)
  need((b.slice(askStart, b.indexOf('const handleSend', askStart)).match(/choiceDialog\(/g) ?? []).length === 3 && (b.slice(askStart, b.indexOf('const handleSend', askStart)).match(/confirmDialog\(/g) ?? []).length === 1,
    `${B}: 묻는 창 개수가 바뀌었다(열람 형식 1 · 편집 형식 1 · 편집 목적지 1).`)
  const oneAnswer = ['app', 'components', 'lib'].flatMap(walk).filter(f => /기기에 저장할까요/.test(read(f)))
  need(oneAnswer.length === 0, `답이 하나뿐인 '기기에 저장할까요' 창이 남았다: ${oneAnswer.join(', ')}`)
  const literal = ['app', 'components', 'lib'].flatMap(walk).filter(f => /'문자로 보내기'/.test(read(f)))
  need(literal.length === 1 && literal[0] === B, `'문자로 보내기' 갈래가 SendDocButton 밖에 생겼다: ${literal.join(', ')}`)
  // 사용처 표 — (app) 안은 useCanEdit() 값, 밖은 page 가 넘긴 prop. 개수를 고정한다.
  const USES = {
    'app/(app)/settings/SettingsForm.tsx': ['canSendSms', 2],
    'app/(app)/contracts/ContractsClient.tsx': ['canEditUi', 1],
    'app/(app)/rent-receipts/RentReceiptsClient.tsx': ['canEditUi', 1],
    'app/(app)/residence-certs/ResidenceCertClient.tsx': ['canEditUi', 1],
    'components/entity-modal/widgets/ContractFilesPanel.tsx': ['canEditUi', 1],
    'app/contract/[tenantId]/ContractView.tsx': ['prop', 1],
    'app/rent-receipt/[tenantId]/RentReceiptView.tsx': ['prop', 2],
    'app/residence-cert/[tenantId]/ResidenceCertView.tsx': ['prop', 1],
    'app/doc/[fileId]/DocViewer.tsx': ['prop', 1],
  }
  const users = ['app', 'components'].flatMap(walk).filter(f => /<SendDocButton\b/.test(read(f)))
  for (const f of users) need(f in USES, `${f}: SendDocButton 사용처가 새로 생겼다. canSendSms 를 역할로 넘기고 USES 표에 등록할 것.`)
  for (const [f, [v, n]] of Object.entries(USES)) {
    const s = read(f)
    const tags = [...s.matchAll(/<SendDocButton\b[^>]*?\/>/g)].map(m => m[0])
    need(tags.length === n, `${f}: SendDocButton 이 ${tags.length}곳이다(기대 ${n}).`)
    const name = v === 'prop' ? 'canSendSms' : v
    for (const t of tags) need(new RegExp(`canSendSms=\\{${name}\\}`).test(t), `${f}: SendDocButton 에 canSendSms={${name}} 가 없다.`)
    if (v !== 'prop') need(new RegExp(`const ${name} = useCanEdit\\(\\)`).test(s), `${f}: ${name} 가 useCanEdit() 에서 오지 않는다.`)
  }
  const PAGES = {
    'app/contract/[tenantId]/page.tsx': /canSendSms=\{canEdit\(role\)\}/,
    'app/rent-receipt/[tenantId]/page.tsx': /canSendSms=\{canEdit\(role\)\}/,
    'app/residence-cert/[tenantId]/page.tsx': /canSendSms=\{canEdit\(role\)\}/,
    'app/doc/[fileId]/page.tsx': /canSendSms=\{canEdit\(access\.role\)\}/,
  }
  for (const [f, re] of Object.entries(PAGES)) need(re.test(read(f)), `${f}: (app) 밖 화면에 역할로 정한 canSendSms 를 넘기지 않는다.`)
}

// ⓗ 상세·계약서 화면 쓰기 입구
{
  const EDIT_GATES = [
    ['components/entity-modal/EntityModal.tsx', /\{kind === 'room' && hasRoom && !opening && canEditUi && \(/, "호실 면 '삭제'·'수정'"],
    ['components/entity-modal/EntityModal.tsx', /\{canEditUi && \(\s*<Btn variant="ghost" size="md" onClick=\{handleDeleteTenant\}/, "입주자 면 '삭제'"],
    ['components/entity-modal/EntityModal.tsx', /\{canEditUi && \(\s*<Btn variant="primary" size="md" onClick=\{handleEditTenant\}/, "입주자 면 '수정'"],
    ['components/entity-modal/EntityModal.tsx', /onApplyScheduledNow=\{canEditUi \? handleApplyScheduledNow : undefined\}/, "호실 '예정 가격 즉시 적용'"],
    ['components/entity-modal/EntityModal.tsx', /<PaymentBody [^>]*canEdit=\{canEditUi\}/, '수납 면 canEdit(종전 true 고정)'],
    ['components/entity-modal/widgets/TenantStatusTransitions.tsx', /\{canEditUi && \(\s*<div className="flex flex-wrap gap-2 py-2">\s*\{transitions\.map/, "상태 전환 버튼 줄(퇴실 예정 처리·비거주 전환·입실 적용취소 등)"],
    ['components/entity-modal/widgets/TenantStatusTransitions.tsx', /\{canEditUi && \(\s*<button type="button" disabled=\{pending\}[\s\S]{0,700}?거주중으로 되돌리기/, "'거주중으로 되돌리기'"],
    ['components/entity-modal/widgets/ShortStayInfoWidget.tsx', /\{canEditUi && e === lastActive && \(/, "단기 연장 '적용취소'"],
    ['components/entity-modal/widgets/ShortStayInfoWidget.tsx', /\{canEditUi && canExtend && \(/, "'단기 연장'·'월 계약 전환'"],
    ['components/entity-modal/widgets/TenantRequestsTab.tsx', /\{canEditUi && \(\s*<div className="rounded-xl p-4 space-y-3"[^>]*>\s*<button type="button" onClick=\{\(\) => setShowNewForm/, "'새 요청 등록'"],
    ['components/entity-modal/widgets/TenantRequestsTab.tsx', /\) : canEditUi && \(\s*<button onClick=\{\(\) => \{ setDoneAskId\(r\.id\)/, "'완료로 처리하기'"],
    ['components/entity-modal/widgets/TenantRequestsTab.tsx', /\{canEditUi && <div className="shrink-0 flex items-center gap-1">\s*<Btn [^>]*onClick=\{\(\) => handleUnresolve/, "'완료 적용취소'·처리 이력 삭제"],
    ['components/entity-modal/widgets/ContractFilesPanel.tsx', /\{canEditUi && \(\s*<label className=\{btnClass\('ghost', 'sm'[^\n]*\n\s*\{uploading \? '올리는 중…' : '스캔본 올리기'\}/, "'스캔본 올리기'"],
    ['components/entity-modal/widgets/ContractFilesPanel.tsx', /\{canEditUi && multiVersion && \(/, "'용도'"],
    ['components/entity-modal/widgets/ContractFilesPanel.tsx', /\{canEditUi && <Btn [^>]*onClick=\{\(\) => void handleRestoreFile\(f\.id\)\}>삭제 적용취소/, "'삭제 적용취소'"],
    ['components/entity-modal/widgets/ContractFilesPanel.tsx', /\{canEditUi && voidedLeaseIds\.map\(/, "'폐기 적용취소'"],
    ['components/entity-modal/widgets/ContractFilesPanel.tsx', /\{canEditUi && badge\.closable && \(/, "'링크 닫기'·'알림 해제'"],
    ['components/doc/TenantDocBundleSheet.tsx', /\{canEditUi && \(\(row\.canWriteNew === true/, "서류 행 '새로 작성'·'여러 달 작성'"],
    ['components/doc/TenantDocBundleSheet.tsx', /: canEditUi && <BtnLink href=\{writeHref\(row, tenantId, past\)\}[^>]*>작성<\/BtnLink>/, "서류 행 '작성'"],
    ['components/entity-modal/bodies/PaymentBody.tsx', /<DiscountWidget [^>]*canEdit=\{canEdit\}/, '할인 위젯 canEdit'],
    ['components/entity-modal/bodies/PaymentBody.tsx', /\{canEdit && <DueDayPermanentChangeWidget\b/, "'납입일 영구 변경'"],
    ['components/entity-modal/widgets/DiscountWidget.tsx', /\{canEdit && !showForm && \(\s*<button onClick=\{\(\) => \{ setStart/, "'+ 할인 추가'"],
    ['components/entity-modal/widgets/DiscountWidget.tsx', /\{canEdit && <button onClick=\{\(\) => handleDelete\(d\)\}/, "할인 '삭제'"],
    ['app/contract/[tenantId]/ContractView.tsx', /\{canEdit && \(\s*<button onClick=\{handleResetAuto\}/, "계약서 화면 '전체 적용취소'"],
    ['app/contract/[tenantId]/ContractView.tsx', /\{canEdit && \(\s*<button onClick=\{bodyLocked \? notifyBodyLocked : \(\) => setEditing\(true\)\}/, "계약서 화면 '본문 편집'"],
    ['app/contract/[tenantId]/ContractView.tsx', /\{canEdit && data\.hasOverride && \(/, "계약서 화면 '공통 템플릿으로'"],
    ['app/contract/[tenantId]/ContractView.tsx', /\{canEdit && bodyLocked && \(\s*<button onClick=\{handleVoidVersion\}/, "계약서 화면 '이 계약서 폐기'"],
    ['app/contract/[tenantId]/ContractView.tsx', /\{canEdit && bodyLocked && versionCtx\?\.multiVersion/, "계약서 화면 '새 버전 작성'"],
    ['components/entity-modal/widgets/ContractFilesPanel.tsx', /\{stage\.hint \|\| !canEditUi \? '등록된 계약서가 없습니다\.' :/, "계약서 칸 빈 상태 안내가 열람 역할에게 작성·스캔본을 시킨다"],
    ['app/contract/[tenantId]/page.tsx', /canEdit=\{canEdit\(role\)\}/, '계약서 page 가 canEdit 을 넘긴다'],
    ['app/(app)/contracts/ContractsClient.tsx', /\{canEditUi && \(\s*<BtnLink href=\{p\.signatureLive/, "계약서 목록 발급 대기 '발급'"],
    ['app/(app)/contracts/ContractsClient.tsx', /\) : selectMode \|\| !canEditUi \? \(/, '계약서 목록 계약번호(발급 기록) 글자 대체'],
    ['app/(app)/contracts/ContractsClient.tsx', /c\.contractNo && canEditUi \? \(\s*<button type="button" onClick=\{\(\) => setDetailId/, '계약서 목록 폐기본 계약번호 글자 대체'],
    ['app/(app)/rent-receipts/RentReceiptsClient.tsx', /\{canEditUi && \(\s*<section className="space-y-2">\s*<h2[^>]*>새 \{docLabel\} 발급<\/h2>/, "납부 확인서 목록 '새 발급'"],
    ['app/(app)/rent-receipts/RentReceiptsClient.tsx', /\{canEditUi && \(\s*<a href=\{`\/rent-receipt\/\$\{c\.tenantId\}\$\{reissueQuery/, "납부 확인서 목록 '다시 작성'"],
    ['app/(app)/residence-certs/ResidenceCertClient.tsx', /\{canEditUi && \(\s*<section className="space-y-2">\s*<h2[^>]*>새 확인서 작성<\/h2>/, "실거주 확인서 목록 '새 확인서 작성'"],
    ['app/(app)/residence-certs/ResidenceCertClient.tsx', /\{canEditUi && \(\s*<a href=\{`\/residence-cert\/\$\{c\.tenantId\}/, "실거주 확인서 목록 '다시 작성'"],
    ['components/doc/TenantDocBundleSheet.tsx', /\{DOC_STALE_NOTE\}\.\{canEditUi && ' 납부가 확인되면 새로 작성할 수 있습니다\.'\}/, '서류 행 지난 납부 안내가 열람 역할에게 작성을 시킨다'],
    ['app/(app)/contracts/ContractsClient.tsx', /서명은 받았고 계약서 파일이 아직 없습니다\.\{canEditUi && ' 발급을 누르면/, '발급 대기 안내가 열람 역할에게 발급·폐기를 시킨다'],
    ['app/(app)/rent-receipts/RentReceiptsClient.tsx', /\(canEditUi \? '위에서 입실자를 선택해 발급하면 여기에 모입니다\.' : undefined\)/, '빈 목록 설명이 열람 역할에게 없는 새 발급 칸을 가리킨다'],
    ['app/(app)/residence-certs/ResidenceCertClient.tsx', /\(canEditUi \? '위에서 입실자를 선택해 발급하면 여기에 모입니다\.' : undefined\)/, '빈 목록 설명이 열람 역할에게 없는 새 확인서 칸을 가리킨다'],
  ]
  for (const [f, re, what] of EDIT_GATES) need(re.test(read(f)), `${f}: ${what} 가 열람 역할에게 선다(가드가 없거나 모양이 바뀌었다).`)
  // 손 개수 — 가드 밖에 같은 동작이 하나 더 생기면 붉다.
  const HANDS = [
    ['components/entity-modal/EntityModal.tsx', /onClick=\{handleDeleteTenant\}/g, 1],
    ['components/entity-modal/EntityModal.tsx', /onClick=\{handleEditTenant\}/g, 1],
    ['components/entity-modal/EntityModal.tsx', /onClick=\{handleDeleteRoom\}/g, 1],
    ['components/entity-modal/EntityModal.tsx', /onClick=\{handleEditRoom\}/g, 1],
    ['components/entity-modal/EntityModal.tsx', /<PaymentBody\b/g, 1],
    ['components/entity-modal/widgets/TenantRequestsTab.tsx', /handleDelete\(r\.id\)/g, 2],
    ['components/entity-modal/widgets/ContractFilesPanel.tsx', /onClick=\{\(\) => handleDelete\(f\.id\)\}/g, 2],
    ['components/entity-modal/widgets/ContractFilesPanel.tsx', /onClick=\{\(\) => setDetailId\(f\.id\)\}/g, 2],
    ['components/entity-modal/widgets/ContractFilesPanel.tsx', /onChange=\{handleUpload\}/g, 1],
    ['app/contract/[tenantId]/ContractView.tsx', /onClick=\{handleResetAuto\}/g, 1],
    ['app/contract/[tenantId]/ContractView.tsx', /onClick=\{handleVoidVersion\}/g, 1],
    ['app/(app)/contracts/ContractsClient.tsx', /onClick=\{\(\) => handleDelete\(c\.id, c\.tenantName\)\}/g, 2],
    ['app/(app)/contracts/ContractsClient.tsx', /onClick=\{\(\) => setDetailId\(c\.id\)\}/g, 2],
    ['app/(app)/rent-receipts/RentReceiptsClient.tsx', /onClick=\{\(\) => handleDelete\(c\.id, c\.tenantName\)\}/g, 1],
    ['app/(app)/residence-certs/ResidenceCertClient.tsx', /onClick=\{\(\) => handleDelete\(c\.id, c\.tenantName\)\}/g, 1],
    ['app/contract/[tenantId]/ContractView.tsx', /onClick=\{handleSupersede\}/g, 1],
  ]
  for (const [f, re, n] of HANDS) {
    const c = (read(f).match(re) ?? []).length
    need(c === n, `${f}: ${re.source} 이 ${c}곳이다(기대 ${n}). 새 자리면 열람 역할에게 막고 이 표를 고친다.`)
  }
  // 서류 목록 세 곳의 삭제는 모두 canEditUi 아래다(서버 deleteContractFile·deleteRentReceiptFile·deleteResidenceCertFile requireEdit).
  for (const [f, n] of [['app/(app)/contracts/ContractsClient.tsx', 2], ['app/(app)/rent-receipts/RentReceiptsClient.tsx', 1], ['app/(app)/residence-certs/ResidenceCertClient.tsx', 1]]) {
    const s2 = read(f)
    need((s2.match(/\{canEditUi && \(\s*<Btn variant="ghost" size="sm" onClick=\{\(\) => handleDelete\(c\.id, c\.tenantName\)\}/g) ?? []).length === n, `${f}: 서류 '삭제' 가 열람 역할에게 선다.`)
    need(/const canEditUi = useCanEdit\(\)/.test(s2), `${f}: canEditUi 가 useCanEdit() 에서 오지 않는다.`)
  }
  // (app) 밖 서류 화면(계약서·납부 확인서·실거주 확인서)으로 가는 문 표 — 열람 역할에게는 0 이다(2026-11-04 운영자 결정).
  // 문 글자가 새 자리에 생기거나 가드 꼴이 바뀌면 붉다. 서류 시트의 문은 writeHref·writeManyHref 를 거치고 그 호출은 위 표가 본다.
  const DOOR = /[`'"]\/(contract|rent-receipt|residence-cert)\//
  const DOORS = {
    'app/(app)/contracts/ContractsClient.tsx': [1, [/\{canEditUi && \(\s*<BtnLink href=\{p\.signatureLive \? `\/contract\//]],
    'app/(app)/rent-receipts/RentReceiptsClient.tsx': [2, [/\{canEditUi && \(\s*<section className="space-y-2">[\s\S]*?<a href=\{`\/rent-receipt\/\$\{t\.tenantId\}\$\{monthQuery\}`\}[\s\S]*?<\/section>\s*\)\}/, /\{canEditUi && \(\s*<a href=\{`\/rent-receipt\/\$\{c\.tenantId\}/]],
    'app/(app)/residence-certs/ResidenceCertClient.tsx': [2, [/\{canEditUi && \(\s*<section className="space-y-2">[\s\S]*?href=\{`\/residence-cert\/\$\{t\.tenantId\}`\}[\s\S]*?<\/section>\s*\)\}/, /\{canEditUi && \(\s*<a href=\{`\/residence-cert\/\$\{c\.tenantId\}/]],
    // 계약서 화면은 2026-11-04 부터 STAFF 에게 읽기 전용으로 열린다(ⓜ). 서명본(?share=)은 편집 역할 전용 그대로다.
    'components/entity-modal/widgets/ContractFilesPanel.tsx': [3, [/\{canOpenContract && \(\s*<BtnLink href=\{`\/contract\/\$\{tenantId\}`\}/, /\{canEditUi && signedViewLinkId && \(\s*<BtnLink href=\{`\/contract\/\$\{tenantId\}\?share=/, /\{canOpenContract && extraLeases\?\.map\(l => \(\s*<BtnLink key=\{l\.id\} href=\{`\/contract\/\$\{tenantId\}\?leaseTermId=/]],
    'components/doc/TenantDocBundleSheet.tsx': [4, []],
  }
  const doorFiles = ['app', 'components', 'lib'].flatMap(walk).filter(f => !/^app\/(api|contract|rent-receipt|residence-cert|sign)\//.test(f) && f !== 'app/robots.ts')
    .filter(f => read(f).split('\n').some(l => DOOR.test(l)))
  for (const f of doorFiles) need(f in DOORS, `${f}: (app) 밖 서류 화면으로 가는 문이 새로 생겼다. 열람 역할에게 막고 DOORS 표에 등록할 것.`)
  for (const [f, [n, guards]] of Object.entries(DOORS)) {
    const s2 = read(f)
    const c = s2.split('\n').filter(l => DOOR.test(l)).length
    need(c === n, `${f}: 서류 화면으로 가는 문이 ${c}줄이다(기대 ${n}). 새 자리면 열람 역할에게 막고 이 표를 고친다.`)
    for (const g of guards) need(g.test(s2), `${f}: 서류 화면으로 가는 문이 열람 역할에게 선다(가드 ${g.source.slice(0, 40)}…).`)
  }
  {
    const s2 = read('components/doc/TenantDocBundleSheet.tsx')
    need((s2.match(/\bwriteHref\(/g) ?? []).length === 3 && (s2.match(/\bwriteManyHref\(/g) ?? []).length === 2, `TenantDocBundleSheet: 서류 화면으로 가는 문(writeHref·writeManyHref) 호출이 늘었다.`)
  }

  // ContractView 를 그리는 자리는 전부 두 prop 을 넘긴다(기본값 없음). 운영자 화면은 역할로, 입주자 원격 서명은 false 로.
  const CV_RENDERS = {
    'app/contract/[tenantId]/page.tsx': [/canSendSms=\{canEdit\(role\)\} canEdit=\{canEdit\(role\)\}/, 2],
    'app/sign/[token]/page.tsx': [/canSendSms=\{false\} canEdit=\{false\}/, 1],
  }
  const cvUsers = ['app', 'components'].flatMap(walk).filter(f => /<ContractView\b/.test(read(f)))
  for (const f of cvUsers) need(f in CV_RENDERS, `${f}: ContractView 를 그리는 자리가 새로 생겼다. canSendSms·canEdit 을 역할로 넘기고 CV_RENDERS 표에 등록할 것.`)
  for (const [f, [re, n]] of Object.entries(CV_RENDERS)) {
    const tags = [...read(f).matchAll(/<ContractView\b[^>]*\/>/g)].map(m => m[0])
    need(tags.length === n && tags.every(t => re.test(t)), `${f}: ContractView 렌더 ${tags.length}곳 중 두 prop 을 정해 넘기지 않는 자리가 있다(기대 ${n}곳).`)
  }
  // 처리 이력 삭제·계약번호(발급 기록, 서버 requireEdit) 는 줄 단위로 가드를 본다.
  const req = read('components/entity-modal/widgets/TenantRequestsTab.tsx')
  need(/\{canEditUi && <button onClick=\{\(\) => handleDelete\(r\.id\)\}/.test(req), `TenantRequestsTab: 미처리 요청 '삭제' 가 열람 역할에게 선다.`)
  const cfp = read('components/entity-modal/widgets/ContractFilesPanel.tsx')
  need((cfp.match(/f\.contractNo && canEditUi \? \(\s*<button type="button" onClick=\{\(\) => setDetailId/g) ?? []).length === 2,
    `ContractFilesPanel: 계약번호(발급 기록 열기, 서버 requireEdit) 가 열람 역할에게 눌린다.`)
  need((cfp.match(/\{canEditUi && \(\s*<Btn variant="ghost" size="sm" onClick=\{\(\) => handleDelete\(f\.id\)\}/g) ?? []).length === 2,
    `ContractFilesPanel: 계약서 '삭제' 가 열람 역할에게 선다.`)
  for (const f of ['components/entity-modal/EntityModal.tsx', 'components/entity-modal/widgets/TenantStatusTransitions.tsx', 'components/entity-modal/widgets/ShortStayInfoWidget.tsx',
    'components/entity-modal/widgets/TenantRequestsTab.tsx', 'components/doc/TenantDocBundleSheet.tsx']) {
    need(/const canEditUi = useCanEdit\(\)/.test(read(f)), `${f}: canEditUi 가 useCanEdit() 에서 오지 않는다.`)
  }
}

// ⓘ 열람 역할에게 부르지 않는 쓰기용 조회
{
  const A = 'app/(app)/tenants/actions.ts'
  const a = read(A)
  for (const fn of ['getRoomScheduleState', 'getRoomBusyNotice']) {
    const i = a.indexOf(`export async function ${fn}(`)
    const body = a.slice(i, a.indexOf('\nexport ', i + 1))
    need(i >= 0 && /\n {2}await requireEdit\(\)\n/.test(body), `${A}: ${fn} 의 requireEdit 가 없다(서버 문을 낮췄다면 이 축과 보고를 함께 고친다).`)
  }
  const B = 'components/entity-modal/bodies/TenantBody.tsx'
  const b = read(B)
  need(/const canEditUi = useCanEdit\(\)\s*useEffect\(\(\) => \{\s*if \(!leaseIdForRefund \|\| !canEditUi\) return\s*let active = true\s*getRoomScheduleState\(leaseIdForRefund\)[^\n]*\n\s*getRoomBusyNotice\(leaseIdForRefund\)/.test(b),
    `${B}: 열람 역할에게도 호실 일정·막힘 조회를 부른다(서버 requireEdit 거부가 모달마다 난다).`)
  const callers = ['app', 'components'].flatMap(walk).filter(f => /\bgetRoom(ScheduleState|BusyNotice)\(/.test(read(f)) && f !== A)
  need(callers.sort().join(',') === ['app/(app)/tenants/TenantClient.tsx', B].sort().join(','), `호실 일정·막힘 조회를 부르는 자리가 늘었다: ${callers.join(', ')}`)
}

// ⓚ 계약서 화면 읽기 전용
{
  const F = 'app/contract/[tenantId]/ContractView.tsx'
  const v = read(F)
  const has = (re, what) => need(re.test(v), `${F}: ${what}`)
  need((v.match(/const viewOnly = /g) ?? []).length === 1 && /const viewOnly = !remote && !canEdit\n/.test(v), `${F}: viewOnly 판정이 '!remote && !canEdit' 한 곳이 아니다.`)
  const ndf = v.slice(v.indexOf('const needsDueDayFill = () =>'), v.indexOf('const askDueDayFill'))
  need(/!viewOnly/.test(ndf), `${F}: 납부일 채움 창(needsDueDayFill)이 열람 역할에게도 선다(저장이 requireEdit 로 거절된다).`)
  // 창을 여는 호출은 전부 needsDueDayFill() 판정 뒤이거나, 서버가 납부일 없음으로 거절한 서명 요청 갈래(편집 역할 전용) 안이다.
  // 판정을 우회해 askDueDayFill() 을 바로 부르면 열람 역할에게 창이 다시 선다(독립 검수 2026-11-04).
  {
    const lines = v.split('\n')
    const calls = lines.map((l, i) => [l, i]).filter(([l]) => /\baskDueDayFill\(/.test(l) && !/const askDueDayFill =/.test(l))
    need(calls.length === 4, `${F}: 납부일 창을 여는 자리가 ${calls.length}곳이다(기대 4). 새 자리면 needsDueDayFill() 판정 뒤에 둔다.`)
    for (const [l, i] of calls) {
      const gated = /needsDueDayFill\(\)[^\n]*askDueDayFill\(/.test(l) || (/res\.code === 'DUE_DAY_REQUIRED'/.test(lines[i - 1] ?? '') && /askDueDayFill\(res\.leaseTermId, res\.defaultDay\)/.test(l))
      need(gated, `${F}:${i + 1}: 납부일 창을 needsDueDayFill() 판정 없이 연다(열람 역할에게 창이 선다).`)
    }
    need(/useEffect\(\(\) => \{\s*if \(needsDueDayFill\(\)\) void askDueDayFill\(\)\s*\}, \[\]\)/.test(v), `${F}: 진입 때 납부일 창이 needsDueDayFill() 판정을 지나지 않는다.`)
  }
  const fc = v.slice(v.indexOf('const fieldCell = ('), v.indexOf('const fieldInput = ('))
  const ro = fc.indexOf('if (remote || viewOnly) return <span>{printText}</span>'), lk = fc.indexOf('if (bodyLocked)')
  need(ro >= 0 && lk > ro, `${F}: fieldCell 이 열람 역할을 글자 갈래로 먼저 보내지 않는다(입력칸이 서거나 잠김 안내가 폐기·새 버전을 시킨다).`)
  has(/\{remote \|\| viewOnly \? \(\s*<span>\{smoking\}<\/span>/, `흡연 칸이 열람 역할에게 select 로 선다(setTenantSmoking requireEdit).`)
  has(/\{remote \|\| viewOnly \? \(\s*<span>\{emergencyContactText\}<\/span>/, `비상연락처가 열람 역할에게 입력칸으로 선다.`)
  need((v.match(/handleSmokingChange\(e\.target\.value\)/g) ?? []).length === 1, `${F}: 흡연 select 가 늘었다.`)
  has(/const nameStylePicker = !remote && !viewOnly && /, `성명 표기 select 가 열람 역할에게 선다.`)
  has(/if \(remote \|\| viewOnly \|\| !bodyLocked \|\| !leaseIdForCtx\) return/, `열람 역할에게도 판본 조회(getIssuePurposeContext)를 부른다.`)
  // 서명칸 셋(계약서·동의서·추가 서류)
  need((v.match(/className="sign-img"/g) ?? []).length === 3, `${F}: 서명 이미지 자리가 셋이 아니다.`)
  need((v.match(/className="sign-img"[^>]*onClick=\{viewOnly \? undefined : \(\) => openSign\('(contract|disposal)'\)\}/g) ?? []).length === 2
    && /className="sign-img"[^>]*onClick=\{readOnly \? undefined : onSign\}/.test(v),
    `${F}: 저장된 서명 이미지를 눌러 다시 서명하는 길이 열람 역할에게 열린다.`)
  need((v.match(/className="signature-clear no-print"/g) ?? []).length === 3
    && (v.match(/\{!remote && !viewOnly && \(\s*<button type="button" onClick=\{\(\) => handleClearSignature\('(contract|disposal)'\)\}/g) ?? []).length === 2
    && /\{!remote && !readOnly && \(\s*<button type="button" onClick=\{onClear\}/.test(v),
    `${F}: '서명 지우기'(clearContractSignature requireEdit)가 열람 역할에게 선다.`)
  need((v.match(/sign-cta\$\{/g) ?? []).length === 3
    && /\) : viewOnly \? \(\s*<span className="seal-mark">\(서명\)<\/span>\s*\) : \(\s*<>\s*<button type="button" ref=\{contractSignRef/.test(v.replace(/\n\s*\/\/[^\n]*/g, ''))
    && /\) : viewOnly \? \(\s*<span>\(서명 또는 인\)<\/span>\s*\) : \(\s*<>\s*<button type="button" ref=\{disposalSignRef/.test(v)
    && /\) : readOnly \? \(\s*<span>\(서명 또는 인\)<\/span>\s*\) : \(\s*<>\s*<button type="button" ref=\{setRef\}/.test(v)
    && /\n {12}readOnly=\{viewOnly\}\n/.test(v),
    `${F}: '여기를 눌러 서명'이 열람 역할에게 선다(대면 서명은 발급 때 저장돼, 받게 두면 발급 거절과 함께 서명이 사라진다).`)
  // 툴바 끝자리
  has(/\{!viewOnly && \(\s*<SendDocButton getPdfBytes=\{fetchPreviewPdfBytes\}/, `내보내기(서버 미리보기 requireEdit)가 열람 역할에게 선다.`)
  has(/\{viewOnly \? null : signatureDataUrl \? \(\s*<button onClick=\{handleContractSave\}/, `'발급' 이 열람 역할에게 선다.`)
  need((v.match(/onClick=\{handleContractSave\}/g) ?? []).length === 1 && (v.match(/<SendDocButton\b/g) ?? []).length === 1, `${F}: 발급·내보내기 자리가 늘었다.`)
  has(/\{viewOnly \? \(\s*<span className="toolbar-static">\s*<span>계약일<\/span>/, `계약일이 열람 역할에게 입력칸이나 잠김 버튼(폐기·새 버전 안내)으로 선다.`)
  has(/onUndo=\{viewOnly \|\| bodyLocked \? undefined : undoField\}/, `'직접 입력' 목록의 되돌리기(saveContractFieldOverride requireEdit)가 열람 역할에게 선다.`)
  has(/lockMessage=\{!viewOnly && bodyLocked \?/, `'직접 입력' 목록의 잠김 안내(폐기·새 버전)가 열람 역할에게 선다.`)
  // page: 역할이 데이터보다 먼저, 제한 스태프 404, 서명본은 편집 역할만
  const P = 'app/contract/[tenantId]/page.tsx'
  const pg = read(P)
  const iRole = pg.indexOf('const role = await getMyRole()'), iData = pg.indexOf('getContractData('), iSnap = pg.indexOf('getSignedSnapshot(tenantId')
  need((pg.match(/getMyRole\(\)/g) ?? []).length === 1 && iRole >= 0 && iData > iRole && iSnap > iRole, `${P}: 역할을 데이터(getContractData·getSignedSnapshot)보다 먼저 읽지 않는다.`)
  need(/const role = await getMyRole\(\)\n\s*if \(!canReadScope\(role, 'money'\)\) notFound\(\)\n/.test(pg), `${P}: 금액을 못 읽는 제한 스태프가 오류 화면을 만난다(404 분기가 없다).`)
  const iShareGate = pg.search(/if \(!canEdit\(role\)\) \{[\s\S]{0,400}?redirect\(`\/contract\/\$\{encodeURIComponent\(tenantId\)\}/)
  need(iShareGate > 0 && iShareGate < iSnap, `${P}: 서명본(?share=)이 열람 역할을 일반 화면으로 보내지 않는다(getSignedSnapshot requireEdit 가 던져 오류 화면).`)
  const gateBody = iShareGate > 0 ? pg.slice(iShareGate, pg.indexOf('redirect(', iShareGate) + 120) : ''
  need(/keep\.set\('leaseTermId', leaseTermId\)/.test(gateBody) && /keep\.set\('lang', lang\)/.test(gateBody) && !/share/.test(gateBody.replace(/\/\/[^\n]*/g, '')),
    `${P}: 열람 역할 서명본 이동이 계약 지목(leaseTermId)·번역본(lang)을 버리거나 share 를 다시 싣는다(부계약이 주계약 화면으로 가거나 이동이 돈다).`)
}

// ⓜ 계약서 칸의 계약서 화면 입구
{
  const f = 'components/entity-modal/widgets/ContractFilesPanel.tsx'
  const s = read(f)
  need(/const canReadMoney = useCanReadScope\('money'\)\s*const canOpenContract = canEditUi \|\| canReadMoney\n/.test(s),
    `${f}: 계약서 화면 입구 판정이 편집 역할 또는 금액 읽기(useCanReadScope('money'))가 아니다(제한 스태프에게 서버가 거절하는 문이 선다).`)
  need(/\{canOpenContract && \(\s*<BtnLink href=\{`\/contract\/\$\{tenantId\}`\}\s*variant=\{[^}]*\} size="sm">\s*\{canEditUi \? '계약서 작성·서명' : '계약서 보기'\}\s*<\/BtnLink>/.test(s),
    `${f}: 계약서 화면 입구 라벨이 역할로 갈리지 않는다(열람 역할에게 '계약서 작성·서명' 이 서거나 문이 사라졌다).`)
  need((s.match(/계약서 작성·서명'/g) ?? []).length === 1 && (s.match(/'계약서 보기'/g) ?? []).length === 1, `${f}: 계약서 화면 입구 라벨 글자가 다른 자리에 또 생겼다.`)
  need(/const signedViewLinkId = shareLink\?\.signedAt && shareLink\.signatureLive \? shareLink\.id : null/.test(s) && /const shareLink = share\?\.link \?\? null/.test(s),
    `${f}: 서명본 문(signedViewLinkId)이 편집 갈래의 shareLink 밖에서 나온다.`)
  need(/const badgeSource = canEditUi \? shareLink : badgeLink\s*const badge = badgeSource \? shareBadge\(badgeSource\) : null/.test(s) && /function shareBadge\(link: ContractSignBadgeInfo\)/.test(s),
    `${f}: 배지가 역할 갈래(편집 shareLink · 열람 badgeLink)를 한 판정 함수로 그리지 않는다.`)
}

// ⓙ 열람 역할용 서명 상태 조회
{
  const f = 'app/(app)/tenants/contractShare.ts'
  const s = read(f)
  const start = s.indexOf('export async function getContractSignBadge(')
  const body = start < 0 ? '' : s.slice(start, s.indexOf('\nexport ', start + 1))
  need(start >= 0, `${f}: getContractSignBadge 가 없다(열람 역할 배지가 사라졌거나 이름이 바뀌었다).`)
  if (start >= 0) {
    const gate = body.search(/\n {4}const \{ propertyId \} = await requirePropertyAccess\(\)\n/)
    const firstDb = body.search(/\bprisma\./)
    need(gate >= 0 && firstDb > gate, `${f}: getContractSignBadge 가 영업장 문(requirePropertyAccess)을 첫 DB 호출보다 먼저 무조건 지나지 않는다.`)
    need(!/\brequireEdit\(/.test(body), `${f}: getContractSignBadge 에 requireEdit 가 붙었다(열람 역할의 '서명 대기' 배지가 사라진다).`)
    for (const [re, what] of [[/\btoken\b/, 'token'], [/\bbuildShareUrl\b/, 'buildShareUrl'], [/\bheaders\(/, 'headers()'], [/\bserializeLink\(/, 'serializeLink(토큰·URL·id 를 싣는다)'],
      [/\bcontacts\b/, 'contacts'], [/\bphone\b/, 'phone'], [/\bforeignRegNo/, 'foreignRegNo'], [/\bnationality\b/, 'nationality'], [/\binclude:/, 'include(select 만 쓴다)'], [/\burl\b/, 'url']]) {
      need(!re.test(body), `${f}: getContractSignBadge 가 ${what} 를 읽거나 싣는다(열람 역할에게 토큰·연락처·신원이 샌다).`)
    }
    need(/\bbadgeOf\(/.test(body), `${f}: getContractSignBadge 가 계약 축 판정 badgeOf 를 안 부른다(손셈은 반쪽 서명을 잘못 부른다).`)
    const bo = s.indexOf('function badgeOf(')
    const boBody = bo < 0 ? '' : s.slice(bo, s.indexOf('\n}\n', bo))
    need(/\bleaseSignSlots\(/.test(boBody) && /\bsignStageSlots\(/.test(boBody) && /\bbadgeSignSummary\(/.test(boBody),
      `${f}: badgeOf 가 계약 축 정본(leaseSignSlots·signStageSlots·badgeSignSummary)을 부르지 않는다.`)
    const ser = s.indexOf('function serializeLink(')
    need(ser >= 0 && /\bbadgeOf\(/.test(s.slice(ser, s.indexOf('\n}\n', ser))), `${f}: serializeLink 가 badgeOf 를 안 부른다(두 조회의 판정이 두 벌로 갈린다).`)
    const t = s.match(/export type ContractSignBadgeInfo = Pick<ContractShareLinkInfo,\s*([^>]*)>/)
    const keys = t ? [...t[1].matchAll(/'(\w+)'/g)].map(m => m[1]).sort().join(',') : ''
    need(keys === 'closedAt,expiresAt,lockedAt,signStage,signSummary,submittedAt',
      `${f}: ContractSignBadgeInfo 의 칸이 배지 여섯이 아니다(${keys || '타입 없음'}).`)
  }
}

if (violations.length) {
  console.error(`[check-sms-role-gate] 위반 ${violations.length}건`)
  for (const v of violations) console.error(`  - ${v}`)
  process.exit(1)
}
console.log(`[check-sms-role-gate] 통과 (서버 문 ${Object.values(SERVER).flat().length} · 입구 ${Object.keys(SINKS).length} · 버튼 ${BUTTONS.length})`)
