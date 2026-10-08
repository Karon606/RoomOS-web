// 도어락 마스터키가 새는 길을 소스에서 잡는 감지망 — 읽기 전용, 위반 시 exit 1 (2026-10-08).
//
// 왜 있나. 마스터키는 소유자만 보는 값이고(읽기 스코프 'security'), 평문은 호실 프리즘의 [보기]
// 한 길로만 나오며 그 길은 열람 기록을 남긴다. 그런데 이런 약속은 에러 없이 조용히 깨진다.
// select 없는 조회 하나가 암호문을 엑셀에 싣고, 반환 객체에 칸 하나가 붙어 브라우저로 내려가고,
// 디버깅용 console 한 줄이 남는다. 그래서 구조를 일곱 축으로 본다.
//
//   ① lib/prisma 의 전역 omit 이 살아 있는가. 이 한 줄이 select 없는 조회 전부를 막는다.
//   ② 평문 게터(readStoredRoomMasterKey)를 부르는 파일이 masterKeyActions 하나인가.
//      그리고 그 파일에서 열람 기록 생성이 값 반환보다 앞서는가(뒤면 기록 실패가 곧 기록 없는 열람).
//   ③ decryptPii 를 lib/pii 밖에서 부르지 않는가. check-pii-plaintext 축 D 와 같은 검사지만
//      그쪽은 DB 를 붙는 verify:db 에만 있어, 빠른 그물에도 같은 줄을 둔다.
//   ④ 내보내기·가져오기 라우트가 이 칸을 다루지 않는가.
//   ⑤ 클라이언트 번들(components/·*Client.tsx)에 doorMasterKeyEnc 라는 글자가 없는가(주석 포함).
//   ⑥ 로그 문장이 마스터키를 싣지 않는가. 평문을 다루는 세 파일은 console 자체가 0 이어야 한다.
//   ⑦ getRoomDetail 반환 블록에 암호문 칸이 없는가 — 구조 분해로 떼어 낸 나머지만 펼치고,
//      등록 여부는 'security' 스코프로 가린다. 부수로 영업장 격리(findFirst + propertyId)도 본다.
//
// 실행: node scripts/check-master-key-axis.mjs
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const violations = []
const read = f => { try { return readFileSync(f, 'utf8') } catch { return null } }
// 주석을 걷는다. '://' 는 URL 이라 줄 주석으로 보지 않는다. 줄 수는 보존한다.
const strip = s => s
  .replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ''))
  .replace(/(^|[^:])\/\/[^\n]*/g, '$1')

function walk(dir, out = []) {
  let entries
  try { entries = readdirSync(dir) } catch { return out }
  for (const e of entries) {
    if (e === 'node_modules' || e === '.next' || e.startsWith('.')) continue
    const p = join(dir, e)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.(tsx?|mjs|js)$/.test(p)) out.push(p)
  }
  return out
}

const PRISMA = join('lib', 'prisma.ts')
const PII = join('lib', 'pii.ts')
const ACTIONS = join('app', '(app)', 'room-manage', 'masterKeyActions.ts')
const WIDGET = join('components', 'entity-modal', 'widgets', 'RoomMasterKeyInfo.tsx')
const DETAIL = join('app', '(app)', 'rooms', 'actions.ts')

const SRC = [...walk('app'), ...walk('lib'), ...walk('components')]
if (SRC.length === 0) violations.push('[스캔] 검사 대상 파일이 0개다 — 스캔 경로가 어긋났다. 감지망을 고쳐야 한다')

// ── ① 전역 omit ───────────────────────────────────────────────
{
  const s = strip(read(PRISMA) ?? '')
  if (!/omit\s*:\s*\{\s*room\s*:\s*\{\s*doorMasterKeyEnc\s*:\s*true\s*\}/.test(s)) {
    violations.push(`[① omit] ${PRISMA} 에 전역 omit(room.doorMasterKeyEnc)이 없다 — select 없는 조회(엑셀·백업·목록)에 암호문이 딸려 나간다`)
  }
}

// ── ② 평문 게터 호출처 · 기록 순서 ────────────────────────────
{
  const callers = SRC.filter(f => f !== PII && /\breadStoredRoomMasterKey\s*\(/.test(strip(read(f) ?? '')))
  for (const f of callers) {
    if (f !== ACTIONS) violations.push(`[② 평문 문] ${f} 가 readStoredRoomMasterKey 를 부른다 — 평문은 ${ACTIONS} 의 revealRoomMasterKey 한 길로만 나온다`)
  }
  const s = strip(read(ACTIONS) ?? '')
  if (!s) {
    violations.push(`[② 평문 문] ${ACTIONS} 를 읽지 못했다 — 기록 순서 대조가 건너뛰어졌다. 감지망을 고쳐야 한다`)
  } else {
    const view = s.search(/roomMasterKeyView\.create\s*\(/)
    const ret = s.search(/return\s*\{\s*ok\s*:\s*true\s*,\s*value\b/)
    if (view < 0) violations.push(`[② 기록] ${ACTIONS} 에 열람 기록(roomMasterKeyView.create)이 없다 — 누가 언제 봤는지가 사라진다`)
    else if (ret < 0) violations.push(`[② 기록] ${ACTIONS} 에서 값 반환(return { ok: true, value })을 못 찾았다 — 감지망 문법을 고쳐야 한다`)
    else if (view > ret) violations.push(`[② 기록] ${ACTIONS} 의 열람 기록이 값 반환보다 뒤에 있다 — 기록 실패가 곧 기록 없는 열람이 된다`)
  }
}

// ── ③ decryptPii 외부 호출 ────────────────────────────────────
for (const f of SRC) {
  if (f === PII) continue
  if (/\bdecryptPii\s*\(/.test(strip(read(f) ?? ''))) {
    violations.push(`[③ 복호] ${f} 가 decryptPii 를 직접 부른다 — 복호는 lib/pii 안에서만 한다`)
  }
}

// ── ④ 내보내기·가져오기 라우트 ────────────────────────────────
{
  const routes = SRC.filter(f => f.startsWith(join('app', 'api', 'export')) || f.startsWith(join('app', 'api', 'import')))
  if (routes.length === 0) violations.push('[④ 경로] 내보내기·가져오기 라우트를 한 개도 못 찾았다 — 스캔 경로가 어긋났다. 감지망을 고쳐야 한다')
  for (const f of routes) {
    if (/doorMasterKey|masterKey/i.test(strip(read(f) ?? ''))) {
      violations.push(`[④ 경로] ${f} 가 마스터키를 다룬다 — 내보내기·가져오기는 이 값을 취급하지 않는다(평문 유출·유입 차단)`)
    }
  }
}

// ── ⑤ 클라이언트 번들 ────────────────────────────────────────
{
  const clientFiles = SRC.filter(f => f.startsWith('components' + '/') || f.startsWith('components\\') || /Client\.tsx$/.test(f))
  if (!clientFiles.includes(WIDGET)) violations.push(`[⑤ 번들] ${WIDGET} 를 스캔하지 못했다 — 스캔 경로가 어긋났다. 감지망을 고쳐야 한다`)
  for (const f of clientFiles) {
    // 주석까지 본다. 암호문 칸 이름이 클라이언트 쪽에 적히는 것 자체가 그 칸이 내려온다는 신호다.
    if (/doorMasterKeyEnc/.test(read(f) ?? '')) {
      violations.push(`[⑤ 번들] ${f} 에 doorMasterKeyEnc 가 있다 — 암호문 칸은 브라우저로 안 내려간다. 화면은 doorMasterKeySet(등록 여부)만 받는다`)
    }
  }
}

// ── ⑥ 로그 ───────────────────────────────────────────────────
{
  const CONSOLE = /\bconsole\.(log|error|warn|info|debug|trace|dir)\s*\(/
  // 평문이 손에 잡히는 세 파일 — console 이 아예 없어야 한다. 값 이름은 res.value·plain·draft 로
  // 바뀌므로 이름으로 잡으면 새 변수 하나에 뚫린다.
  const NO_CONSOLE = [PII, ACTIONS, WIDGET]
  for (const f of NO_CONSOLE) {
    const raw = read(f)
    if (raw === null) { violations.push(`[⑥ 로그] ${f} 를 읽지 못했다 — 감지망을 고쳐야 한다`); continue }
    strip(raw).split('\n').forEach((line, i) => {
      if (CONSOLE.test(line)) violations.push(`[⑥ 로그] ${f}:${i + 1} 에 console 이 있다 — 마스터키 평문을 다루는 파일은 로그를 남기지 않는다`)
    })
  }
  for (const f of SRC) {
    if (NO_CONSOLE.includes(f)) continue
    strip(read(f) ?? '').split('\n').forEach((line, i) => {
      if (CONSOLE.test(line) && /doorMasterKey|masterKey/i.test(line)) {
        violations.push(`[⑥ 로그] ${f}:${i + 1} 의 로그 문장이 마스터키를 싣는다 — 로그는 지워지지 않고 검색된다`)
      }
    })
  }
}

// ── ⑦ getRoomDetail 반환 블록 ─────────────────────────────────
{
  const s = strip(read(DETAIL) ?? '')
  const start = s.search(/export\s+async\s+function\s+getRoomDetail\s*\(/)
  if (start < 0) {
    violations.push(`[⑦ 상세] ${DETAIL} 에서 getRoomDetail 을 못 찾았다 — 감지망 문법을 고쳐야 한다`)
  } else {
    // 함수 끝 = 다음 최상위 선언. 본문만 잘라 본다.
    const rest = s.slice(start + 10)
    const next = rest.search(/\n(export\s|async\s+function\s|function\s|const\s|type\s)/)
    const body = s.slice(start, next < 0 ? s.length : start + 10 + next)
    const destr = body.match(/const\s*\{\s*doorMasterKeyEnc\s*(?::\s*\w+\s*)?,\s*\.\.\.(\w+)\s*\}\s*=\s*room\b/)
    const rets = [...body.matchAll(/return\s*\{([\s\S]*?)\n\s*\}/g)].map(m => m[1])
    const finalRet = rets[rets.length - 1]
    if (/\bdoorMasterKeyEnc\s*:\s*true/.test(body) && !destr) {
      violations.push(`[⑦ 상세] getRoomDetail 이 암호문을 select 하면서 구조 분해로 떼어 내지 않는다 — 반환에 그대로 실려 브라우저로 간다`)
    }
    if (!finalRet) {
      violations.push(`[⑦ 상세] getRoomDetail 의 반환 블록을 못 찾았다 — 감지망 문법을 고쳐야 한다`)
    } else {
      // 키 자리만 본다 — 속성 머리({ · , · 줄 머리) 뒤에 오는 doorMasterKeyEnc(값 있는 키·단축 속성 둘 다).
      if (/(?:^|[{,])\s*doorMasterKeyEnc\s*(?:[:,}]|$)/m.test(finalRet)) violations.push(`[⑦ 상세] getRoomDetail 반환 블록에 doorMasterKeyEnc 가 있다 — 등록 여부(doorMasterKeySet)만 싣는다`)
      if (/\.\.\.\s*room\s*,/.test(finalRet)) violations.push(`[⑦ 상세] getRoomDetail 이 room 을 통째로 펼친다 — 암호문 칸을 뗀 나머지만 펼쳐야 한다`)
      if (destr && !new RegExp(`\\.\\.\\.\\s*${destr[1]}\\b`).test(finalRet)) {
        violations.push(`[⑦ 상세] getRoomDetail 이 떼어 낸 나머지(${destr[1]})를 펼치지 않는다 — 문법이 바뀌었으면 감지망을 고쳐야 한다`)
      }
      if (!/doorMasterKeySet\s*:\s*canReadScope\([^)]*'security'\)/.test(finalRet)) {
        violations.push(`[⑦ 상세] getRoomDetail 의 등록 여부가 'security' 스코프로 가려지지 않는다 — 소유자 밖 역할에 등록 여부가 내려간다`)
      }
    }
    if (!/prisma\.room\.findFirst\(\s*\{\s*where\s*:\s*\{\s*id\s*:\s*roomId\s*,\s*propertyId\s*:/.test(body)) {
      violations.push(`[⑦ 격리] getRoomDetail 이 영업장으로 묶어 읽지 않는다(findFirst + propertyId) — 남의 영업장 방 id 로 상세가 읽힌다`)
    }
  }
}

if (violations.length) {
  console.error(`\n[마스터키 축] 위반 ${violations.length}건`)
  for (const v of violations) console.error('  - ' + v)
  process.exit(1)
}
console.log(`[마스터키 축] 일곱 축 검사 · 파일 ${SRC.length}개 / 위반 0건`)
