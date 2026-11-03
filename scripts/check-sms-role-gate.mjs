// 고객 문자 권한 감지망. 열람 전용 직원(STAFF·제한 스태프)이 고객에게 문자를 보낼 길이 다시 열리면 붉게 선다. 읽기 전용, 위반 시 exit 1.
//
// 왜 필요한가(2026-11-03 운영자 지시). 원문 "열람만 할 수 있는 직원은 고객에게 문자를 보낼 수 없고 그 위 권한부터 가능하도록해줘".
// 문자는 서버가 보내지 않는다. sms: 링크로 누른 사람 폰의 문자앱을 여는 구조라 **화면에서 막는 것이 실제 차단**이고,
// 서버는 문자를 짜는 조회(번호·템플릿·수신자)와 발송 시도 기록을 거부한다. 한쪽만 남으면 다른 쪽이 새 길이 된다.
//
// 축 다섯.
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
  'app/(app)/tenants/docBundle.ts': ['logDocSmsAttempt'],
  'app/(app)/tenants/noticeSms.ts': ['getNoticeSmsTargets', 'logNoticeSmsAttempt', 'polishNoticeText', 'saveNoticeTemplateAuto'],
  'app/(app)/tenants/contractShare.ts': ['issueContractShareLink', 'renewContractShareLink'],
}
for (const [f, fns] of Object.entries(SERVER)) {
  const s = read(f)
  need(/import \{[^}]*\brequireEdit\b[^}]*\} from '@\/lib\/role'/.test(s), `${f}: requireEdit 를 '@/lib/role' 에서 가져오지 않는다.`)
  for (const fn of fns) {
    const start = s.indexOf(`export async function ${fn}(`)
    if (start < 0) { violations.push(`${f}: ${fn} 가 없다(이름이 바뀌었으면 이 표도 고친다).`); continue }
    const next = s.indexOf('\nexport ', start + 1)
    const body = s.slice(start, next < 0 ? s.length : next)
    // 무조건 실행되는 자리만 센다 — try 바로 안 첫머리 들여쓰기(4칸)의 단독 문장.
    const gate = body.search(/\n {4}await requireEdit\(\)\n/)
    need(gate >= 0, `${f}: ${fn} 가 무조건 실행되는 'await requireEdit()' 를 갖지 않는다(열람 역할이 문자를 짜거나 남긴다).`)
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
  need(/const stage = canEditUi \? stageByState : \{ \.\.\.stageByState, primary: null \}/.test(s),
    `ContractFilesPanel: 열람 역할에게 주 버튼(작성·발급·다시 보내기)을 올린다.`)
  need(/const reloadShare = async \(\) => \{\s*if \(!canEditUi\) \{[^\n]*return \}\s*const res = await getContractShareState\(/.test(s),
    `ContractFilesPanel: 열람 역할에게도 링크 상태를 조회한다(서버 거절 토스트가 모달마다 뜬다).`)
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
    && /<ContractView data=\{data\} translationLangs=\{translationLangs\} canSendSms=\{canEdit\(role\)\} \/>/.test(page),
    `app/contract/[tenantId]/page.tsx: 계약서 화면에 canSendSms={canEdit(role)} 를 넘기지 않는다(열람 직원에게 '서명 요청' 이 선다).`)
  const v = read('app/contract/[tenantId]/ContractView.tsx')
  need(/canSendSms = true \}/.test(v) && /\) : canSendSms \? \(\s*<button onClick=\{handleSignRequest\}/.test(v) && (v.match(/onClick=\{handleSignRequest\}/g) ?? []).length === 1,
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

if (violations.length) {
  console.error(`[check-sms-role-gate] 위반 ${violations.length}건`)
  for (const v of violations) console.error(`  - ${v}`)
  process.exit(1)
}
console.log(`[check-sms-role-gate] 통과 (서버 문 ${Object.values(SERVER).flat().length} · 입구 ${Object.keys(SINKS).length} · 버튼 ${BUTTONS.length})`)
