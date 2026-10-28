// 사람을 부르는 말 세 층(고객·입주자·입실자)이 자리를 바꾸는 것을 잡는 감지망 — 읽기 전용, 위반 시 exit 1.
//
// 왜 필요한가(신고 515fe37c, 운영자 결정 2026-10-26 선택지 ①). 고객 관리 화면에는 문의·투어·예약부터
// 퇴실까지 등록된 사람 전부가 선다. 그런데 메뉴·등록 버튼·빈 상태가 '입주자'라 '입주자 등록'을 누르면
// 문의 상태로 등록됐다. 글자가 거짓이었다. 그래서 세 층을 둔다.
//   · 고객   = 퍼널 전체(사이드바·하단 탭·홈 탭·검색 묶음·고객 관리 페이지·등록 버튼과 모달·토스트)
//   · 입주자 = 지금 사는 사람(호실 카드·수납·단체 공지의 '입주자' 그룹·'현 입주자')
//   · 입실자 = 서류(계약서 서명란 '임차인 (입실자)')
// 8-13 에 '고객'을 소거했다가(48b7390a) 이번에 범위를 다시 나눴다. 한 번 맞춘 낱말이 화면이 늘 때마다
// 다시 갈리는 것은 클래스라 그물로 지킨다(knowledge/glossary.md '사람을 부르는 말').
//
// 축 다섯.
//   ⓐ 화면 이름 — 메뉴·버튼·목록의 이름은 '고객 관리'·'고객 등록'·'고객 목록'이다. 노출 문구에
//      '입주자 관리'·'입주자 등록'·'입주자 목록'이 다시 서면 없는 화면을 가리키는 말이 된다.
//   ⓑ 퍼널 문맥 — 한 문자열 안에서 문의·투어 뒤에 '입주자'가 오면 아직 안 사는 사람을 입주자라 부른다.
//   ⓒ 고객 자리 고정 — 퍼널 전체를 담는 정본 자리가 '고객'인지.
//   ⓓ 입주자 자리 고정 — 지금 사는 사람만 담는 자리는 '고객'으로 같이 쓸려 가면 안 된다.
//   ⓔ 서류 자리 — 발급 서류 조판에 '고객'·'입주자'가 들어오지 않고 서명란은 '임차인 (입실자)'.
//
// 주석은 보지 않는다 — 경위를 적을 때 옛 낱말을 인용해야 한다.
// 실행: node scripts/check-person-term-scope.mjs
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const violations = []

/**
 * 주석을 걷어 낸 줄 배열(줄 번호 유지). 블록 주석은 같은 길이의 빈칸, // 는 URL(:// )이 아닐 때만 뗀다.
 * 블록 주석의 시작은 줄 머리·공백·괄호 뒤의 '/*' 만 본다. accept="image/*" 같은 문자열을 주석 시작으로
 * 읽으면 다음 '*' + '/' 까지 수백 줄을 통째로 건너뛰어 그 사이의 위반이 침묵한다(작성 중 실제로 놓쳤다).
 */
function codeLines(f) {
  const src = readFileSync(f, 'utf8')
    .replace(/(^|[\s{;(),])\/\*[\s\S]*?\*\//gm, m => m.replace(/[^\n]/g, ' '))
  return src.split('\n').map(l => l.replace(/(^|[^:'"`])\/\/.*$/, '$1'))
}

function walk(dir, out = []) {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n)
    if (n === 'node_modules' || n.startsWith('.')) continue
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.tsx?$/.test(n)) out.push(p)
  }
  return out
}

const FILES = ['app', 'components', 'lib'].flatMap(d => walk(d))

// ⓐ·ⓑ 전수
const SCREEN_NAMES = /입주자 ?(관리|등록|목록)/
// 시트 이름 '입주자관리'는 내보낸 파일을 다시 읽는 열쇠라 바꾸지 않는다(옛 백업이 안 읽힌다).
const SHEET_KEY = /'입주자관리'|"입주자관리"/
const FUNNEL_CTX = /(문의|투어)[^'"`<>{}]{0,20}입주자/
for (const f of FILES) {
  codeLines(f).forEach((line, i) => {
    const probe = line.replace(new RegExp(SHEET_KEY, 'g'), '')
    if (SCREEN_NAMES.test(probe)) violations.push(`ⓐ ${f}:${i + 1} — 화면 이름은 '고객 관리·고객 등록·고객 목록'이다: ${line.trim().slice(0, 100)}`)
    if (FUNNEL_CTX.test(probe)) violations.push(`ⓑ ${f}:${i + 1} — 문의·투어 단계의 사람을 '입주자'라 부른다(퍼널은 '고객'): ${line.trim().slice(0, 100)}`)
  })
}

// ⓒ·ⓓ·ⓔ 자리 고정 — [축, 파일, 있어야 하는 패턴, 설명]
const MUST = [
  ['ⓒ', 'components/layout/Sidebar.tsx', /href: '\/tenants',\s+label: '고객 관리'/g, 2, '사이드바 메뉴(일반·제한 스태프)'],
  ['ⓒ', 'components/layout/BottomNav.tsx', /href: '\/tenants',\s+label: '고객',/, 1, '하단 탭'],
  ['ⓒ', 'components/ui/PeekSheet.tsx', /\{ href: '\/tenants', label: '고객' \}/, 1, '훑어보기 시트'],
  ['ⓒ', 'app/(app)/search/actions.ts', /type: 'tenant',\s+label: '고객'/, 1, '검색 묶음'],
  ['ⓒ', 'app/(app)/dashboard/DashboardClient.tsx', /\{ key: 'tenants',\s+label: '고객' \}/, 1, '홈 탭'],
  ['ⓒ', 'app/(app)/dashboard/DashboardClient.tsx', /label: '고객 등록', desc: '고객을 등록하고/, 1, '시작 체크리스트'],
  // 홈 고객 탭의 계약 합계 둘 — 숫자는 계약(거주·예약·퇴실 예정·비거주)만 센다. 옆에 '문의·투어'가 따로 서므로
  // '전체'라 부르면 숫자보다 넓은 말이 된다(운영자 결정 2026-10-28, 숫자 뜻 그대로 '계약 중 고객').
  ['ⓒ', 'app/(app)/dashboard/DashboardClient.tsx', /label="계약 중 고객"/, 1, "홈 고객 탭 계약 합계 카드"],
  ['ⓒ', 'app/(app)/dashboard/DashboardClient.tsx', /centerSub="계약 중 고객"/, 1, '홈 고객 탭 상태 도넛 가운데'],
  ['ⓒ', 'app/(app)/tenants/TenantClient.tsx', />고객 관리<\/h1>/, 1, '페이지 제목'],
  ['ⓒ', 'app/(app)/tenants/TenantClient.tsx', /\+ 고객 등록/, 1, '등록 버튼'],
  ['ⓒ', 'app/(app)/tenants/TenantClient.tsx', /title="고객 등록"/, 1, '등록 모달 제목'],
  ['ⓒ', 'app/(app)/tenants/TenantClient.tsx', /success: '고객 등록됨'/, 1, '등록 토스트'],
  ['ⓒ', 'app/(app)/tenants/TenantClient.tsx', /'등록된 고객이 없습니다'/g, 2, '빈 상태(모바일·PC)'],
  ['ⓓ', 'lib/noticeTargets.ts', /resident: '입주자'/, 1, "단체 공지 '입주자' 그룹(지금 사는 사람)"],
  ['ⓓ', 'components/entity-modal/widgets/RoomBasicInfo.tsx', /'비거주자' : '입주자'/, 1, '호실 카드의 사람 칸'],
  ['ⓓ', 'app/(app)/dashboard/DashboardClient.tsx', /누적 미납 \(현 입주자\)/, 1, "홈 '현 입주자' 지표"],
  ['ⓔ', 'app/contract/[tenantId]/ContractView.tsx', /임차인 \(입실자\)/, 1, '계약서 화면 서명란'],
  ['ⓔ', 'lib/contractPrintHtml.ts', /임차인 \(입실자\)/, 1, '계약서 인쇄 서명란'],
]
for (const [axis, f, re, min, what] of MUST) {
  const code = codeLines(f).join('\n')
  const n = (code.match(re.global ? re : new RegExp(re.source, 'g')) || []).length
  if (n < min) violations.push(`${axis} ${f} — ${what}: 기대 ${min}곳 이상, 실제 ${n}곳 (${re})`)
}

// ⓔ 서류 조판 — 종이에 찍히는 말에 관리 화면의 낱말이 들어오면 안 된다.
const PAPER = ['lib/contractPrintHtml.ts', 'lib/contractTranslationPrintHtml.ts']
for (const f of PAPER) {
  codeLines(f).forEach((line, i) => {
    if (/고객|입주자/.test(line)) violations.push(`ⓔ ${f}:${i + 1} — 서류의 사람은 '입실자'다: ${line.trim().slice(0, 100)}`)
  })
}

console.log(`[사람 낱말 세 층] 검사 파일 ${FILES.length}개 · 자리 고정 ${MUST.length}곳 · 서류 ${PAPER.length}개 / 위반 ${violations.length}건`)
if (violations.length > 0) {
  console.error('')
  for (const v of violations) console.error(`  - ${v}`)
  console.error('')
  console.error("  퍼널 전체는 '고객', 지금 사는 사람은 '입주자', 서류는 '입실자'다(신고 515fe37c, knowledge/glossary.md).")
  process.exit(1)
}
