// '직접 입력 N칸' 목록의 진리표 + 배선 그물 — 어느 칸이 행으로 서고, 두 화면이 같은 것을 쓰는가.
//
// 이 기능의 급소는 **N 과 행 수가 갈리는 것**이다. "직접 입력 3칸" 을 눌렀는데 두 줄이 뜨면
// 운영자는 셋 중 하나를 못 찾은 채 종이를 내보낸다. 그리고 그 세는 규칙에는 예외가 하나 있다
// (nameStyle 은 자동값과 같아도 저장에서 안 걷힌다) — 예외가 있는 규칙은 늘 한쪽에서만 지켜진다.
//
// 그물은 주석을 안 본다. 아래 wiring 검사는 소스에서 주석을 먼저 걷어내고 사실만 찾는다 —
// "같은 모달을 쓴다" 고 적힌 주석이 배선을 대신 통과시키면 그물이 아니라 장식이다.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  CONTRACT_FIELD_ERROR, CONTRACT_FIELD_KEYS, CONTRACT_FIELD_LABEL,
  deriveContractLeaseFields, normalizeContractFieldOverrides, overriddenContractFieldKeys,
  parseContractFieldOverrides,
  type ContractLeaseRow,
} from '../lib/contractFieldOverrides'
import {
  RESIDENCE_CERT_FIELD_LABEL, RESIDENCE_CERT_KEYS,
  deriveResidenceCertFields, normalizeResidenceCertOverrides, parseResidenceCertOverrides,
} from '../lib/documentFieldOverrides'
import { fieldUndoneMessage } from '../components/doc/FieldOverrideListModal'

const ROOT = join(__dirname, '..')
let failed = 0
const ok = (name: string, cond: boolean, detail = '') => {
  if (cond) { console.log(`  PASS  ${name}`) } else { failed++; console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`) }
}

const src = (p: string) => readFileSync(join(ROOT, p), 'utf8')
/** 주석을 걷은 소스 — 설명 글자가 배선 검사를 통과시키지 못하게 한다. */
const code = (p: string) => src(p)
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ')

// 계약 행 한 벌 — 자동값의 원천. 오버라이드는 이 위에 얹힌다.
const LEASE: ContractLeaseRow = {
  moveInDate: new Date('2026-03-01T00:00:00Z'),
  expectedMoveOut: null,
  rentAmount: 450_000,
  depositAmount: 300_000,
  cleaningFee: 50_000,
  dueDay: '14',
  registrationStatus: 'REGISTERED',
  room: { roomNo: '413' },
}
const AUTO = deriveContractLeaseFields(LEASE)

console.log('\n① 진리표 — 어느 칸이 행으로 서는가 (계약서)')
{
  // 값 오버라이드는 저장돼 있으면 곧 행이다.
  const one = parseContractFieldOverrides({ rentAmount: 500_000 })
  ok('임대료만 고치면 1행', overriddenContractFieldKeys(one, 'ko', 'ko').length === 1)

  const three = parseContractFieldOverrides({ rentAmount: 500_000, roomNo: '506', dueDay: '말' })
  const threeKeys = overriddenContractFieldKeys(three, 'ko', 'ko')
  ok('세 칸을 고치면 3행', threeKeys.length === 3)
  ok('행 순서는 CONTRACT_FIELD_KEYS 순서', (() => {
    const idx = threeKeys.map(k => CONTRACT_FIELD_KEYS.indexOf(k))
    return idx.every((v, i) => i === 0 || v > idx[i - 1])
  })())

  ok('오버라이드가 없으면 0행', overriddenContractFieldKeys({}, 'ko', 'ko').length === 0)

  // ── nameStyle 예외 ──────────────────────────────────────────────
  // 이 키는 자동값과 같아도 저장에서 안 걷힌다. 그대로 세면 지금 값과 자동값이 같은 행이 선다.
  const koSaved = parseContractFieldOverrides({ nameStyle: 'ko' })
  ok('nameStyle: 저장값이 자동 해석과 같으면 행이 아니다',
    overriddenContractFieldKeys(koSaved, 'ko', 'ko').length === 0)
  ok('nameStyle: 저장값이 자동 해석과 다르면 행이다 (외국인 자동 영문에 한글 지정)',
    overriddenContractFieldKeys(koSaved, 'ko', 'en').length === 1)
  ok('nameStyle: 저장이 없으면 해석이 갈려도 행이 아니다',
    overriddenContractFieldKeys({}, 'en', 'ko').length === 0)

  // 이 예외가 필요한 이유를 규칙 자체로 증명한다 — 정규화가 이 키를 정말 안 걷어내는가.
  const kept = normalizeContractFieldOverrides({}, { nameStyle: 'ko' }, AUTO)
  ok('정규화는 nameStyle 을 자동값과 같아도 남긴다(예외의 근거)',
    kept.value?.nameStyle === 'ko')
  const pruned = normalizeContractFieldOverrides({}, { rentAmount: AUTO.rentAmount }, AUTO)
  ok('정규화는 값 칸이 자동값과 같아지면 걷어낸다', pruned.value === null)
}

console.log('\n② 진리표 — N 과 행 수가 항상 같은가')
{
  // 화면은 같은 배열의 length 를 배지와 목록에 함께 쓴다. 그 배열이 곧 계약이다.
  const cases: Array<[string, Record<string, unknown>, string, string, number]> = [
    ['값 2 + 무의미한 nameStyle', { rentAmount: 500_000, roomNo: '506', nameStyle: 'ko' }, 'ko', 'ko', 2],
    ['값 2 + 실효 nameStyle', { rentAmount: 500_000, roomNo: '506', nameStyle: 'ko' }, 'ko', 'en', 3],
    ['전부', { rentAmount: 1, depositAmount: 2, cleaningFee: 3, moveInDate: '2026-01-02', expectedMoveOut: '2026-02-03', dueDay: '말', roomNo: 'A1', registrationStatus: '미신고', nameStyle: 'en' }, 'en', 'ko', 9],
  ]
  for (const [name, raw, now, auto, want] of cases) {
    const keys = overriddenContractFieldKeys(
      parseContractFieldOverrides(raw), now as 'ko' | 'en', auto as 'ko' | 'en')
    ok(`${name}: N=${want}`, keys.length === want, `실제 ${keys.length} (${keys.join(',')})`)
  }
  ok('최대 행 수는 표시 필드 수를 넘지 않는다', CONTRACT_FIELD_KEYS.length === 9)
}

console.log('\n③ 진리표 — 되돌린 뒤 그 행이 사라지는가 / 마지막 행이면 목록이 빈다')
{
  const stored = { rentAmount: 500_000, roomNo: '506' }
  const after = normalizeContractFieldOverrides(stored, { rentAmount: null }, AUTO)
  const keys = overriddenContractFieldKeys(parseContractFieldOverrides(after.value), 'ko', 'ko')
  ok('되돌린 칸이 목록에서 빠진다', !keys.includes('rentAmount'))
  ok('나머지 행은 남는다', keys.length === 1 && keys[0] === 'roomNo')

  const last = normalizeContractFieldOverrides({ roomNo: '506' }, { roomNo: null }, AUTO)
  ok('마지막 행을 되돌리면 저장이 통째로 빈다(배지가 내려간다)', last.value === null)
  ok('그때 목록도 0행', overriddenContractFieldKeys(parseContractFieldOverrides(last.value), 'ko', 'ko').length === 0)

  // 되돌리기는 저장 경로에 null 을 실어 보내는 것 하나다 — 빈 문자열도 같은 뜻이어야 한다.
  const byEmpty = normalizeContractFieldOverrides({ roomNo: '506' }, { roomNo: '' }, AUTO)
  ok('빈 문자열도 같은 필드 단위 적용취소', byEmpty.value === null)
}

console.log('\n④ 진리표 — 실거주 확인서도 같은 규칙')
{
  const auto = deriveResidenceCertFields({
    propertyAddress: '서울시 동대문구 제기동 1-1', roomNo: '413',
    moveInDate: new Date('2026-03-01T00:00:00Z'), expectedMoveOut: null,
    rentAmount: 450_000, depositAmount: 300_000,
  })
  const rows = (raw: unknown) =>
    RESIDENCE_CERT_KEYS.filter(k => (parseResidenceCertOverrides(raw) as Record<string, unknown>)[k] !== undefined)

  ok('두 칸을 고치면 2행', rows({ rentAmount: 500_000, periodText: '2026. 3. 1  ~' }).length === 2)
  // 이쪽은 nameStyle 도 가지치기 대상이라 계약서 같은 예외가 필요 없다 — 그 사실을 규칙으로 못박는다.
  const rcKo = normalizeResidenceCertOverrides({}, { nameStyle: auto.nameStyle }, auto)
  ok('확인서 정규화는 nameStyle 도 자동값과 같으면 걷어낸다(예외 불필요의 근거)', rcKo.value === null)

  const undone = normalizeResidenceCertOverrides({ rentAmount: 500_000, siteAddress: '서울시 A' }, { rentAmount: null }, auto)
  ok('되돌린 칸이 빠진다', !rows(undone.value).includes('rentAmount'))
  ok('마지막 행을 되돌리면 행이 통째로 사라진다',
    normalizeResidenceCertOverrides({ siteAddress: '서울시 A' }, { siteAddress: null }, auto).value === null)
}

console.log('\n⑤ 칸 이름 — 두 맵이 검증 문구와 갈리지 않는가')
{
  for (const k of CONTRACT_FIELD_KEYS) {
    ok(`CONTRACT_FIELD_LABEL.${k} 는 검증 문구의 머리다`,
      CONTRACT_FIELD_ERROR[k].startsWith(CONTRACT_FIELD_LABEL[k]),
      `'${CONTRACT_FIELD_LABEL[k]}' vs '${CONTRACT_FIELD_ERROR[k]}'`)
  }
  // 토스트 문장 — 받침에 따라 을/를 이 갈린다. 라벨이 늘어도 이 함수 하나만 지나면 된다.
  ok('받침 있는 이름은 을', fieldUndoneMessage('보증금') === '보증금을 자동값으로 되돌렸습니다')
  ok('받침 없는 이름은 를', fieldUndoneMessage('입실료') === '입실료를 자동값으로 되돌렸습니다')
  for (const k of CONTRACT_FIELD_KEYS) {
    ok(`토스트가 '${CONTRACT_FIELD_LABEL[k]}' 를 온전히 담는다`,
      fieldUndoneMessage(CONTRACT_FIELD_LABEL[k]).startsWith(CONTRACT_FIELD_LABEL[k]))
  }
  for (const k of RESIDENCE_CERT_KEYS) {
    ok(`확인서 토스트가 '${RESIDENCE_CERT_FIELD_LABEL[k]}' 를 온전히 담는다`,
      fieldUndoneMessage(RESIDENCE_CERT_FIELD_LABEL[k]).startsWith(RESIDENCE_CERT_FIELD_LABEL[k]))
  }
}

console.log('\n⑥ 배선 그물 — 두 화면이 같은 모달·같은 문구를 쓰는가')
{
  const CONTRACT = 'app/contract/[tenantId]/ContractView.tsx'
  const RC = 'app/residence-cert/[tenantId]/ResidenceCertView.tsx'
  const cv = code(CONTRACT)
  const rc = code(RC)
  const modal = code('components/doc/FieldOverrideListModal.tsx')

  for (const [name, s] of [['계약서', cv], ['확인서', rc]] as const) {
    ok(`${name}: 공용 모달을 import 한다`,
      /from '@\/components\/doc\/FieldOverrideListModal'/.test(s))
    ok(`${name}: 공용 모달을 실제로 그린다`, /<FieldOverrideListModal\b/.test(s))
    ok(`${name}: 토스트 문장도 공용이다`, /fieldUndoneMessage\(/.test(s))
    ok(`${name}: 배지가 아니라 버튼으로 연다`, /직접 입력 \{[^}]*\}칸 ›/.test(s))
    ok(`${name}: 툴바 되돌리기 라벨이 '전체 적용취소'`, s.includes('전체 적용취소'))
    ok(`${name}: 옛 라벨이 안 남아 있다`,
      !s.includes('표시값 수정') && !s.includes('자동값 복원') && !/>자동값으로</.test(s))
  }
  ok('모달 제목은 한 곳에만 있다', modal.includes('직접 입력한 표시값'))
  ok('행 라벨은 §16 단일 라벨', modal.includes('적용취소'))
  ok('되돌리기 아이콘은 rotate-ccw 14px', /width="14"[^>]*height="14"[\s\S]{0,200}M3 3v5h5/.test(modal))
  ok("모달은 정본 Modal 을 size xs 로 쓴다", /<Modal[\s\S]{0,200}width="xs"/.test(modal))
  ok('본문 배지 라벨이 조항 쪽으로 갈렸다', cv.includes('본문 수정본') && !cv.includes('개별 수정본'))
}

console.log('\n⑦ 배선 그물 — 되돌리기가 새 서버 액션을 안 탄다')
{
  const cv = code('app/contract/[tenantId]/ContractView.tsx')
  const rc = code('app/residence-cert/[tenantId]/ResidenceCertView.tsx')
  const ca = code('app/contract/[tenantId]/actions.ts')
  const ra = code('app/residence-cert/[tenantId]/actions.ts')

  ok('계약서 되돌리기는 기존 저장 액션을 부른다',
    /undoField[\s\S]{0,900}saveContractFieldOverride\(/.test(cv))
  ok('확인서 되돌리기는 기존 저장 액션을 부른다',
    /undoField[\s\S]{0,900}saveResidenceCertFieldOverride\(/.test(rc))
  ok('되돌리기 패치는 그 키에 null 을 싣는다',
    /\[key\]:\s*null/.test(cv) && /\[key\]:\s*null/.test(rc))
  // 새 서버 액션이 생기면 잠금·링크 닫힘 규칙이 한 벌 더 생긴다. 그 자리를 아예 막는다.
  const newAction = /export async function \w*(undo|revert|reset\w*Field\w*One)\w*/i
  ok('계약 액션 파일에 되돌리기 전용 새 액션이 없다', !newAction.test(ca))
  ok('확인서 액션 파일에 되돌리기 전용 새 액션이 없다', !newAction.test(ra))
}

console.log('\n⑧ 배선 그물 — 잠금·조판·스냅샷')
{
  const cv = code('app/contract/[tenantId]/ContractView.tsx')
  const rc = code('app/residence-cert/[tenantId]/ResidenceCertView.tsx')
  const share = code('app/(app)/tenants/contractShare.ts')

  ok('잠기면 되돌리기 자리를 안 넘긴다', /onUndo=\{bodyLocked \? undefined :/.test(cv))
  ok('잠금 문장은 칸 토스트와 같은 정본이다',
    /lockMessage=\{bodyLocked \? fieldLockMessage\([^)]*'here'\)/.test(cv))
  ok('확인서에는 잠금이 없어 문장을 안 넘긴다', !rc.includes('lockMessage'))

  // §07 r-pill 금지 · §11 ring 없음 — 되살아나면 여기서 붉게 선다.
  const cssRule = (s: string, sel: string) => {
    const m = s.match(new RegExp(`\\${sel}\\s*\\{([^}]*)\\}`))
    return m ? m[1] : null
  }
  const badge = cssRule(src('app/contract/[tenantId]/ContractView.tsx'), '.toolbar-badge')
  ok('.toolbar-badge 규칙이 있다', badge !== null)
  ok('.toolbar-badge 에 r-pill 이 없다', !!badge && !/border-radius:\s*999px/.test(badge))
  ok('.toolbar-badge 에 ring 이 없다', !!badge && !/border:\s*1px/.test(badge))
  ok('.toolbar-badge 는 info 틴트다',
    !!badge && badge.includes('--info-bg') && badge.includes('--info-fg'))
  ok('.rc-badge 는 되살아나지 않았다', cssRule(src('app/residence-cert/[tenantId]/ResidenceCertView.tsx'), '.rc-badge') === null)

  // 계약서 툴바는 손수 만든 28px 버튼들의 줄이라 형제(.toolbar-btn-warn)와 같은 치수를 스스로 진다.
  {
    const rule = cssRule(src('app/contract/[tenantId]/ContractView.tsx'), '.toolbar-btn-info')
    ok('계약서 .toolbar-btn-info 규칙이 있다', rule !== null)
    ok('계약서 .toolbar-btn-info 는 info 토큰을 쓴다',
      !!rule && rule.includes('--info-fg') && rule.includes('--info-ring'))
    ok('계약서 .toolbar-btn-info 는 형제(.toolbar-btn-secondary)와 같은 치수다', (() => {
      const sib = cssRule(src('app/contract/[tenantId]/ContractView.tsx'), '.toolbar-btn-secondary')
      const dim = (s: string | null) => s?.match(/padding:[^;]*;|border-radius:[^;]*;|font-size:[^;]*;/g)?.sort().join('') ?? ''
      return !!rule && !!sib && dim(rule) === dim(sib)
    })())
  }
  // 확인서 툴바의 형제는 전부 Btn md(44px)다. 치수를 손으로 적으면 그 줄에서 혼자 작아진다.
  {
    const rule = cssRule(src('app/residence-cert/[tenantId]/ResidenceCertView.tsx'), '.rc-btn-info')
    ok('확인서 .rc-btn-info 규칙이 있다', rule !== null)
    ok('확인서 .rc-btn-info 는 info 토큰을 쓴다',
      !!rule && rule.includes('--info-fg') && rule.includes('--info-ring'))
    ok('확인서 버튼은 형제와 같은 정본(btnClass md)을 탄다',
      /btnClass\('secondary',\s*'md',\s*'rc-btn-info'\)/.test(rc))
    ok('확인서 .rc-btn-info 는 치수를 스스로 안 정한다',
      !!rule && !/padding|font-size|border-radius|min-height/.test(rule),
      rule ?? '')
  }

  // 상태·문은 뒤로가기 옆이고 끝자리는 주 CTA 의 것이다. 두 화면이 반대편이면 안 된다.
  {
    // 운영자 툴바에서 잰다 — 같은 클래스의 첫 등장은 원격(입주자) 툴바라 그쪽을 재면 늘 어긋난다.
    const bar = cv.slice(cv.indexOf('‹ 입실자 정보'))
    const spacer = bar.indexOf('toolbar-spacer')
    const badge = bar.indexOf('본문 수정본')
    const opener = bar.indexOf('직접 입력 ')
    ok('계약서: 본문 수정본 배지가 spacer 앞에 선다', badge > 0 && badge < spacer)
    ok('계약서: 직접 입력 버튼이 spacer 앞에 선다', opener > 0 && opener < spacer)
    ok('계약서: 주 CTA 는 여전히 끝자리다',
      bar.indexOf('toolbar-print') > spacer && bar.indexOf('toolbar-print') > opener)
    const rcBar = rc.slice(rc.indexOf('className="no-print rc-toolbar"'))
    ok('확인서: 직접 입력 버튼도 spacer 앞에 선다',
      rcBar.indexOf('직접 입력 ') > 0 && rcBar.indexOf('직접 입력 ') < rcBar.indexOf('rc-spacer'))
  }

  // §06 — 인라인 toLocaleString()+'원' 금지, 포맷 유틸 단일 경유.
  // 이 함수만 본다. 같은 파일의 종이 마크업에도 인라인 표기가 있지만 이번 작업의 접점이 아니다.
  {
    const at = cv.indexOf('const fieldValueText')
    const fvt = at < 0 ? '' : cv.slice(at, cv.indexOf('\n}', at))
    ok('목록 금액은 fmtWon 정본을 지난다', /case 'rentAmount'[\s\S]{0,120}fmtWon\(/.test(fvt))
    ok('목록 금액에 인라인 원 접미가 없다', !!fvt && !/toLocaleString/.test(fvt))
  }

  // §27.2 — 진행 중에 다른 행을 눌러도 조용히 삼켜지지 않는다. §10 — 라벨이 길어져 폭이 뛰지 않는다.
  {
    const m = code('components/doc/FieldOverrideListModal.tsx')
    ok('되돌리는 동안 전 행이 잠긴다', /disabled=\{undoingKey !== null\}/.test(m))
    ok('진행은 aria-busy 로 알린다', /aria-busy=\{undoingKey === row\.key\}/.test(m))
    ok('라벨이 진행 중에 안 바뀐다', !/되돌리는 중/.test(m))
    // 긴 값이 줄바꿈돼도 어느 쪽이 어느 쪽인지 남아야 한다.
    ok('두 값에 다 이름이 붙는다',
      /지금 <\/span>\{row\.current\}/.test(m) && /자동값 \{row\.auto\}/.test(m))
  }

  // 성명 표기의 '지금 값'과 '자동값'은 오직 saved 하나로만 갈려야 한다. 두 해석의 축이 어긋나면
  // 목록이 "안 고쳤다면 영문" 이라고 말하는데 되돌리면 한글이 서는, 거짓말하는 행이 생긴다.
  // 축을 공통 변수로 묶으면 check-doc-name-axis 가 못 보므로(그 그물은 리터럴을 눈으로 찾는다)
  // 손으로 두 벌 적고, 두 벌이 같은지는 여기서 지킨다.
  {
    const cd = code('lib/contractData.ts')
    // 이 짝만 본다 — 같은 파일의 contractNameStyle(발급 API 공용)은 다른 질문에 답하는 호출이다.
    const pair = cd.slice(cd.indexOf('const nameStyle = signedAlready'), cd.indexOf('const overriddenFieldKeys'))
    const calls = [...pair.matchAll(/resolveDocNameStyle\(\{[\s\S]*?\n\s*\}\)/g)].map(m => m[0])
    ok('지금 값·자동값 해석이 정확히 두 벌 있다', calls.length === 2, `실제 ${calls.length}벌`)
    const axesOf = (s: string) => [...s.matchAll(/^\s*(\w+):/gm)].map(m => m[1]).filter(a => a !== 'saved').sort()
    ok('두 해석의 축이 같다 (saved 만 다르다)',
      calls.length === 2 && JSON.stringify(axesOf(calls[0])) === JSON.stringify(axesOf(calls[1])),
      calls.length === 2 ? `${axesOf(calls[0]).join(',')} vs ${axesOf(calls[1]).join(',')}` : '')
    ok('자동값 해석에는 saved 가 없다', calls.length === 2 && !/\bsaved:/.test(calls[1]))
  }

  // 화면 전용 칸이 24시간 공개 링크 JSON 으로 새면, 운영자가 덮어 감춘 자동값이 그대로 나간다.
  ok('링크 스냅샷은 화면 전용 칸을 벗기고 저장한다',
    /templateSnapshot:\s*\{[\s\S]{0,200}withoutScreenOnly\(withoutPlainPii\(/.test(share))
  ok('벗기는 함수가 두 칸을 모두 지운다',
    /function withoutScreenOnly[\s\S]{0,300}fieldAuto[\s\S]{0,120}overriddenFieldKeys/.test(share))
}

console.log(failed === 0 ? '\n전부 통과\n' : `\n실패 ${failed}건\n`)
process.exit(failed === 0 ? 0 : 1)
