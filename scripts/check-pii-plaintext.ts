// 신원번호(외국인등록번호) 평문이 어딘가로 새는지 검사 — 읽기 전용, 위반 시 exit 1 (2026-08-11).
//
// 왜 있나
//   암호화는 한 번 뚫리는 것이 아니라 조용히 우회된다. 컬럼은 암호문인데 발급 기록 JSON 에 평문이
//   같이 박히거나, 엑셀 내보내기 열 하나가 늘거나, 디버깅하려고 넣은 console.log 한 줄이 남는다.
//   그 셋 다 에러를 내지 않고 아무도 모른다. 그래서 저장소와 소스를 함께 본다.
//
//   축 A — tenants.foreignRegNoEnc 전 행이 `v1:` 접두어인가.
//          평문이 그대로 들어갔거나 형식이 갈린 행을 잡는다.
//   축 B — 발급본 박제(issuedSnapshot)·링크 스냅샷(templateSnapshot) JSON 에 13자리 등록번호가 있는가.
//          박제는 마스킹 + 지문만, 스냅샷은 등록 여부 플래그만 담아야 한다.
//   축 C — 내보내기·가져오기 경로와 로그 문장이 이 컬럼을 다루는가(소스 검사).
//   축 D — 복호 문이 늘었는가. decryptPii 는 lib/pii 안에서만, 평문 게터는 명단 안에서만 불린다.
//   축 E — 위 B 탐지기가 실제로 발화하는가(합성 표본 역주입). 정규식이 죽으면 축 B 는 영원히 통과한다.
import { readFileSync, readdirSync, statSync } from 'fs'
import { join } from 'path'
import { PrismaClient, Prisma } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'

const violations: string[] = []

// ── 등록번호 패턴 ─────────────────────────────────────────────
// 앞 6자리(생년월일) + 하이픈 선택 + 뒤 7자리. 뒤 7자리 첫 숫자는 외국인등록번호의 5~8 만 본다.
// 1~4(주민등록번호)까지 넓히면 금액·날짜 조합에 걸려 거짓 양성이 늘고, 거짓말하는 감지망은 곧 무시된다.
const REG_NO_RE = /(?<!\d)\d{6}-?[5-8]\d{6}(?!\d)/

// 서명 이미지·로고·도장은 base64 라 13자리 숫자가 우연히 이어질 수 있다. 값을 지우고 본다
// (키 이름만 남긴다) — 안 지우면 거짓 양성으로 감지망이 죽는다.
const BLOB_KEYS = new Set([
  'contractImage', 'disposalImage', 'signatureImageUrl', 'disposalSignatureImageUrl',
  'signatureImageDataUrl', 'disposalSignatureImageDataUrl', 'stampImageUrl', 'logoImageUrl',
])
function scrubbed(json: unknown): string {
  return JSON.stringify(json, (k, v) => (BLOB_KEYS.has(k) ? '[blob]' : v)) ?? ''
}
/** 평문 등록번호가 보이면 그 자리를 돌려준다. 마스킹(별표 포함)은 걸리지 않는다. */
function findPlainRegNo(json: unknown): string | null {
  const m = REG_NO_RE.exec(scrubbed(json))
  if (!m) return null
  // 앞 6자리만 남기고 뒤는 가린다 — 감지망 출력이 곧 유출이면 안 된다.
  return `${m[0].slice(0, 6)}-*******`
}

// ── 소스 스캔 유틸 ────────────────────────────────────────────
const read = (f: string) => { try { return readFileSync(f, 'utf8') } catch { return null } }
const stripComments = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1')

function walk(dir: string, out: string[] = []): string[] {
  let entries: string[]
  try { entries = readdirSync(dir) } catch { return out }
  for (const e of entries) {
    if (e === 'node_modules' || e === '.next' || e.startsWith('.')) continue
    const p = join(dir, e)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.tsx?$/.test(p)) out.push(p)
  }
  return out
}

async function main() {
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) })

  // ── 축 E — 탐지기 자체 검사(역주입) ─────────────────────────
  // 실데이터가 깨끗할 때(지금 103행 전부 null) 축 B 는 아무것도 안 본다. 그 상태로 정규식이 죽으면
  // 영원히 초록불이다. 그래서 매 실행마다 합성 표본으로 발화를 확인하고 시작한다.
  {
    const bait = { facts: { 'tenant.foreignRegNo': '9001015123456' } }
    const baitHyphen = { tenant: { foreignRegNo: '900101-5123456' } }
    const safe = { facts: { 'tenant.foreignRegNo': '900101-*******#a1b2c3d4' }, tenant: { hasForeignRegNo: true, foreignRegNo: null } }
    const blob = { signature: { contractImage: `data:image/png;base64,${'9001015123456'}` } }
    if (!findPlainRegNo(bait)) violations.push('[자체검사] 하이픈 없는 평문 등록번호를 탐지기가 못 잡는다 — 축 B 가 죽어 있다')
    if (!findPlainRegNo(baitHyphen)) violations.push('[자체검사] 하이픈 있는 평문 등록번호를 탐지기가 못 잡는다 — 축 B 가 죽어 있다')
    if (findPlainRegNo(safe)) violations.push('[자체검사] 마스킹 + 지문 값을 평문으로 오인한다 — 거짓 양성이라 곧 무시된다')
    if (findPlainRegNo(blob)) violations.push('[자체검사] 서명 이미지 base64 를 평문으로 오인한다 — 거짓 양성이라 곧 무시된다')
  }

  // ── 축 A — 저장 형식 ────────────────────────────────────────
  const tenants = await prisma.tenant.findMany({
    where: { foreignRegNoEnc: { not: null } },
    select: { id: true, name: true, foreignRegNoEnc: true },
  })
  for (const t of tenants) {
    if (t.foreignRegNoEnc?.startsWith('v1:')) continue
    violations.push(`[저장] ${t.name} 의 외국인등록번호가 v1: 암호문이 아니다 — 평문이 그대로 들어갔을 수 있다(tenant ${t.id})`)
  }

  // ── 축 B — 박제·스냅샷 JSON ─────────────────────────────────
  const files = await prisma.contractFile.findMany({
    where: { issuedSnapshot: { not: Prisma.DbNull } },
    select: { id: true, contractNo: true, issuedSnapshot: true, tenant: { select: { name: true } } },
  })
  for (const f of files) {
    const hit = findPlainRegNo(f.issuedSnapshot)
    if (hit) violations.push(`[박제] ${f.tenant?.name ?? '?'} 의 발급본(${f.contractNo ?? '번호 없음'})에 평문 등록번호가 있다(${hit}) — 박제는 마스킹 + 지문만 담아야 한다`)
  }
  const links = await prisma.contractShareLink.findMany({
    select: { id: true, createdAt: true, templateSnapshot: true, tenant: { select: { name: true } } },
  })
  for (const l of links) {
    const hit = findPlainRegNo(l.templateSnapshot)
    if (hit) violations.push(`[링크] ${l.tenant?.name ?? '?'} 의 서명 링크 스냅샷에 평문 등록번호가 있다(${hit}) — 토큰 하나가 곧 유출이 된다(link ${l.id})`)
  }

  await prisma.$disconnect()

  // ── 축 C — 내보내기·가져오기·로그 경로 ──────────────────────
  const SRC = [...walk('app'), ...walk('lib'), ...walk('components')]
  const LEAK_ROUTES = SRC.filter(f => f.startsWith(join('app', 'api', 'export')) || f.startsWith(join('app', 'api', 'import')))
  if (LEAK_ROUTES.length === 0) {
    violations.push('[경로] 내보내기·가져오기 라우트를 한 개도 못 찾았다 — 스캔 경로가 어긋났다. 감지망을 고쳐야 한다')
  }
  for (const f of LEAK_ROUTES) {
    const s = stripComments(read(f) ?? '')
    if (/foreignRegNo/.test(s)) {
      violations.push(`[경로] ${f} 가 외국인등록번호 컬럼을 다룬다 — 내보내기·가져오기는 이 값을 취급하지 않기로 했다(평문 유출·유입 차단)`)
    }
  }
  for (const f of SRC) {
    const s = stripComments(read(f) ?? '')
    if (!/foreignRegNo/.test(s)) continue
    for (const line of s.split('\n')) {
      if (/console\.(log|error|warn|info|debug)\s*\(/.test(line) && /foreignRegNo/.test(line)) {
        violations.push(`[로그] ${f} 의 로그 문장이 외국인등록번호를 싣는다 — 로그는 지워지지 않고 검색된다`)
      }
    }
  }

  // ── 축 D — 복호 문 명단 ─────────────────────────────────────
  // 평문을 꺼내는 자리가 늘면 그만큼 새는 문이 는다. 늘려야 할 이유가 있으면 이 명단에 사유와 함께 올린다.
  const PII_CANON = join('lib', 'pii.ts')
  const PLAINTEXT_READERS = new Map<string, string>([
    [join('lib', 'contractData.ts'), '계약서 렌더 데이터 조립 — 종이의 생년월일 칸을 이 번호가 대체한다'],
    [join('app', 'api', 'contract', 'generate', 'route.ts'), '발급 PDF 인쇄 + 박제용 지문 생성'],
    [join('app', '(app)', 'tenants', 'actions.ts'), '입주자 화면 [보기](revealForeignRegNo) — 유일하게 열람 기록을 남기는 문'],
    [join('app', '(app)', 'tenants', 'contractShare.ts'), '서명본 스냅샷을 읽는 순간 복호해 끼움(저장값 무변경)'],
    [join('app', 'sign', '[token]', 'page.tsx'), '생년월일 게이트 통과 후 원격 화면 렌더 시 주입'],
  ])
  // 마스킹만 쓰는 자리(입주자 목록·상세 카드)는 여기 없다. 그쪽은 maskStoredForeignRegNo 라
  // 평문이 함수 밖으로 나오지 않는다. 명단은 '평문이 실제로 손에 잡히는 자리' 만 담는다.

  for (const f of SRC) {
    const s = stripComments(read(f) ?? '')
    if (f !== PII_CANON && /\bdecryptPii\s*\(/.test(s)) {
      violations.push(`[복호] ${f} 가 decryptPii 를 직접 부른다 — 복호는 lib/pii 안에서만 한다. 밖에서 부르면 실패 처리·마스킹 규칙이 복제된다`)
    }
    if (/\breadStoredForeignRegNo\s*\(/.test(s) && f !== PII_CANON && !PLAINTEXT_READERS.has(f)) {
      violations.push(`[복호] ${f} 가 평문 게터(readStoredForeignRegNo)를 부른다 — 명단에 없는 자리다. 필요하면 감지망 명단에 사유와 함께 올린다`)
    }
  }
  const piiSrc = read(PII_CANON)
  if (!piiSrc) {
    violations.push('[복호] lib/pii.ts 를 읽지 못했다 — 복호 명단 대조가 건너뛰어졌다. 감지망을 고쳐야 한다')
  } else {
    if (!/^import 'server-only'/m.test(piiSrc)) {
      violations.push("[복호] lib/pii 가 'server-only' 를 잃었다 — 클라이언트 번들에 키 읽는 코드가 딸려 들어갈 수 있다")
    }
    if (!/createHmac/.test(piiSrc) || /createHash\s*\(\s*'sha256'\s*\)[\s\S]{0,80}fingerprint/i.test(piiSrc)) {
      violations.push('[박제] 지문이 HMAC 이 아니다 — 순수 해시는 13자리 전수조사로 원본이 복원된다')
    }
  }

  if (violations.length) {
    console.error(`\n[신원번호 평문] 위반 ${violations.length}건`)
    for (const v of violations) console.error('  - ' + v)
    process.exit(1)
  }
  console.log(`[신원번호 평문] 암호문 ${tenants.length}행 · 박제 ${files.length}건 · 링크 ${links.length}건 / 위반 0건`)
}

main().catch(e => { console.error(e); process.exit(1) })
