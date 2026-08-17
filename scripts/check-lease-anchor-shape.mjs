// 1인 다호실 1단계 소스 형태 감시 — 읽기 전용, 위반 시 exit 1.
//
// 왜 데이터가 아니라 소스를 보는가. 오늘 실데이터에서 진행 중 계약이 2건인 고객은 김상혁 하나뿐이라
// 어떤 DB 대조도 거의 다 통과한다. 잘못은 데이터가 아니라 코드의 모양에 있고, 발현은 601호 창고
// 계약이 정식으로 서는 날이다. check-tenant-lease-take 와 같은 종류의 그물이다.
//
//   축 ⓐ 프리즘 앵커 — 앵커가 primaryTenantLease 아닌 계약을 가리키는 형태.
//   축 ⓑ 발급 경로 — 계약서 발급·서명 요청이 leaseTermId 를 안 싣는 형태, 그리고 서류 계약 선택
//        손사본이 lib/documentLease 밖에서 되살아나는 형태.
import { readFileSync, readdirSync, statSync } from 'fs'
import { join } from 'path'

const violations = []
const fail = (axis, msg, fix) => violations.push({ axis, msg, fix })

const read = path => {
  try { return readFileSync(path, 'utf8') } catch { return null }
}
/** 주석을 공백으로 지운다 — 주석에 적힌 예시 코드가 그물에 걸리면 안 된다. */
const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '))
  .replace(/(^|[^:])\/\/[^\n]*/g, (_, p) => p)

/** `export ... function <name>` 부터 다음 최상위 `export` 직전까지 — 함수 본문 근사치. */
function fnBody(src, name) {
  const at = src.indexOf(`function ${name}`)
  if (at === -1) return null
  const next = src.indexOf('\nexport ', at)
  return src.slice(at, next === -1 ? src.length : next)
}

// ── 축 ⓐ 프리즘 앵커 ─────────────────────────────────────────────────────
const ACTIONS = 'app/(app)/rooms/actions.ts'
const SHELL = 'components/entity-modal/EntityModal.tsx'
{
  const raw = read(ACTIONS)
  if (!raw) fail('ⓐ', `${ACTIONS} 를 읽을 수 없다`, '경로가 바뀌었으면 이 스크립트의 상수를 함께 옮긴다.')
  else {
    const src = strip(raw)
    const body = fnBody(src, 'getEntityLinks')
    if (!body) fail('ⓐ', `${ACTIONS} 에서 getEntityLinks 를 못 찾았다`, '함수 이름이 바뀌었으면 이 스크립트도 함께 고친다.')
    else if (!/primaryTenantLease\s*\(/.test(body)) {
      fail('ⓐ', `${ACTIONS} getEntityLinks 가 primaryTenantLease 를 안 부른다`,
        '앵커는 사람 축 정본으로 고른다. 방의 주 계약이나 createdAt desc 로 되돌리면 같은 사람이 문마다 다른 계약으로 보인다.')
    }
    // 앵커 계약의 방·계약 묶음을 안 내려보내면 제목도 세그먼트도 앵커를 말할 수 없다.
    // 타입 선언 안만 본다 — 파일 어딘가에 같은 낱말이 남아 있다고 계약이 유지되는 것은 아니다.
    const typeAt = src.indexOf('export type EntityLinks')
    const typeBlock = typeAt === -1 ? null : src.slice(typeAt, src.indexOf('\n}', typeAt))
    if (!typeBlock) fail('ⓐ', `${ACTIONS} 에서 EntityLinks 타입 선언을 못 찾았다`, '타입 이름이 바뀌었으면 이 스크립트도 함께 고친다.')
    else for (const field of ['anchorRoomNo', 'entryLeaseTermId', 'leases']) {
      if (!new RegExp(`\\n\\s*${field}\\s*[?:]`).test(typeBlock)) {
        fail('ⓐ', `${ACTIONS} 의 EntityLinks 에 ${field} 가 없다`,
          '프리즘이 앵커와 계약 묶음을 구분하려면 세 칸이 다 필요하다(제목·방 선택기·수납 세그먼트).')
      }
    }
  }
  const shell = read(SHELL)
  if (!shell) fail('ⓐ', `${SHELL} 를 읽을 수 없다`, '경로가 바뀌었으면 이 스크립트의 상수를 함께 옮긴다.')
  else {
    const src = strip(shell)
    const title = src.split('\n').find(l => /const\s+title\s*=/.test(l))
    if (!title) fail('ⓐ', `${SHELL} 에서 제목 조립(const title =)을 못 찾았다`, '제목 조립 자리가 바뀌었으면 이 스크립트도 함께 고친다.')
    else if (!/anchorRoomNo/.test(title)) {
      fail('ⓐ', `${SHELL} 의 제목이 anchorRoomNo 를 안 읽는다`,
        '제목은 앵커(메인 계약의 방)를 말해야 한다. 진입 방을 적으면 같은 사람이 어느 문으로 들어왔느냐에 따라 다른 이름으로 불린다.')
    }
  }
}

// ── 축 ⓑ 발급 경로 ───────────────────────────────────────────────────────
const GEN = 'app/api/contract/generate/route.ts'
const VIEW = 'app/contract/[tenantId]/ContractView.tsx'
{
  const raw = read(GEN)
  if (!raw) fail('ⓑ', `${GEN} 를 읽을 수 없다`, '경로가 바뀌었으면 이 스크립트의 상수를 함께 옮긴다.')
  else {
    const src = strip(raw)
    if (!/pickDocumentLease\s*\(\s*tenant\.leaseTerms\s*,\s*body\.leaseTermId\s*\)/.test(src)) {
      fail('ⓑ', `${GEN} 가 body.leaseTermId 를 계약 선택에 안 쓴다`,
        '발급 API 가 제 추론으로 계약을 다시 고르면 화면과 다른 내용의 PDF 가 보관된다(계약번호·파일명·박제까지 그 계약으로 남는다).')
    }
  }
  const raw2 = read(VIEW)
  if (!raw2) fail('ⓑ', `${VIEW} 를 읽을 수 없다`, '경로가 바뀌었으면 이 스크립트의 상수를 함께 옮긴다.')
  else {
    const src = strip(raw2)
    // 발급·미리보기 두 경로 모두 계약을 실어야 한다. fetch 호출 수와 leaseTermId 수를 맞춘다.
    const fetches = (src.match(/'\/api\/contract\/generate'/g) || []).length
    const carried = (src.match(/leaseTermId:\s*data\.lease\?\.id/g) || []).length
    if (fetches === 0) fail('ⓑ', `${VIEW} 에서 발급 API 호출을 못 찾았다`, '호출 자리가 바뀌었으면 이 스크립트도 함께 고친다.')
    else if (carried < fetches) {
      fail('ⓑ', `${VIEW} 의 발급 API 호출 ${fetches}곳 중 계약을 싣는 곳이 ${carried}곳뿐이다`,
        '발급본과 미리보기가 다른 계약을 그리면 종이와 기록이 갈린다 — 두 경로 다 지목해야 한다.')
    }
    // 서명 요청·드리프트 비교도 같은 계약을 봐야 한다(비교는 발급 직전이다).
    for (const fn of ['issueContractShareLink', 'checkContractShareDrift']) {
      const m = src.match(new RegExp(`${fn}\\s*\\(([^)]*)\\)`))
      if (!m) fail('ⓑ', `${VIEW} 에서 ${fn} 호출을 못 찾았다`, '호출 자리가 바뀌었으면 이 스크립트도 함께 고친다.')
      else if (!m[1].includes(',')) {
        fail('ⓑ', `${VIEW} 의 ${fn} 이 계약을 지목하지 않는다`,
          '지목이 없으면 서버 추론이 다른 계약을 골라, 입주자가 보고 있다고 믿는 것과 다른 계약서에 서명하게 된다.')
      }
    }
  }
}

// 축 ⓑ 이어붙임 — 계약서 파일 칸의 서명 요청도 계약을 지목하는가 (2026-08-13 다호실 마무리).
// 계약서 화면만 지목하고 이 칸이 무지목이면, 같은 사람의 서명 링크가 문마다 다른 계약을 그린다.
{
  const PANEL = 'components/entity-modal/widgets/ContractFilesPanel.tsx'
  const raw = read(PANEL)
  if (!raw) fail('ⓑ', `${PANEL} 를 읽을 수 없다`, '경로가 바뀌었으면 이 스크립트의 상수를 함께 옮긴다.')
  else {
    const m = strip(raw).match(/issueContractShareLink\s*\(([^)]*)\)/)
    if (!m) fail('ⓑ', `${PANEL} 에서 issueContractShareLink 호출을 못 찾았다`, '호출 자리가 바뀌었으면 이 스크립트도 함께 고친다.')
    else if (!m[1].includes(',')) {
      fail('ⓑ', `${PANEL} 의 서명 요청이 계약을 지목하지 않는다`,
        '이 칸이 그리는 계약을 실어야 한다. 무지목이면 서버 추론이 다른 계약을 골라, 방을 둘 쓰는 입주자에게 화면과 다른 계약서의 서명 링크가 나간다.')
    }
  }
}

// 축 ⓑ 뒷단 — 서류 계약 선택 손사본이 정본 밖에서 되살아났는가.
// 우선순위 표(ACTIVE 0 · CHECKOUT_PENDING 1 · …)와 절반짜리 규칙('비거주만 뒤로') 두 지문을 본다.
{
  const CANON = 'lib/documentLease.ts'
  const ROOTS = ['app', 'components', 'lib']
  // 지문: 상태에 숫자를 매기는 객체 리터럴인데 **발급 대상 네 상태만** 들어 있는 것.
  // 투어·퇴실·취소까지 매기는 표는 다른 질문이다(검색 결과 랭킹 STATUS_WEIGHT) — 그래서 제외한다.
  const NUMERIC_STATUS_MAP = /\{[^{}]*\bACTIVE:\s*\d[^{}]*\}/g
  const OTHER_AXIS_KEYS = /\b(WAITING_TOUR|TOUR_DONE|CHECKED_OUT|CANCELLED)\s*:/
  const HALF_RULE = /status\s*===\s*'NON_RESIDENT'\s*\?\s*1\s*:\s*0/
  const walk = (dir, out = []) => {
    let entries
    try { entries = readdirSync(dir) } catch { return out }
    for (const e of entries) {
      if (e === 'node_modules' || e.startsWith('.')) continue
      const p = join(dir, e)
      if (statSync(p).isDirectory()) walk(p, out)
      else if (/\.tsx?$/.test(p)) out.push(p)
    }
    return out
  }
  for (const file of ROOTS.flatMap(r => walk(r))) {
    if (file === CANON) continue
    const src = strip(readFileSync(file, 'utf8'))
    for (const literal of src.match(NUMERIC_STATUS_MAP) ?? []) {
      if (OTHER_AXIS_KEYS.test(literal)) continue
      fail('ⓑ', `${file} 에 서류 계약 우선순위 표 손사본이 있다`,
        `선택 규칙은 ${CANON} 하나다. 표를 베끼면 계약서와 확인서가 서로 다른 계약을 그린다.`)
    }
    if (HALF_RULE.test(src)) {
      fail('ⓑ', `${file} 에 '비거주만 뒤로' 절반짜리 선택 규칙이 있다`,
        `${CANON} 의 documentLeaseRank 를 쓴다. 절반짜리는 예약과 거주가 섞이는 순간 정본과 갈린다.`)
    }
  }
}

if (violations.length > 0) {
  console.error(`[1인 다호실 형태] 위반 ${violations.length}건`)
  for (const v of violations) {
    console.error(`  축 ${v.axis} · ${v.msg}`)
    console.error(`      조치: ${v.fix}`)
  }
  process.exit(1)
}
console.log('[1인 다호실 형태] 축 ⓐ 프리즘 앵커 · 축 ⓑ 발급 경로 지목·손사본 / 위반 0건')
