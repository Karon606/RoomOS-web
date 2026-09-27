// 목록 쿼리에 큰 컬럼이 다시 섞이는 것을 막는 감지망. 읽기 전용, 위반 시 exit 1.
// 실행: node scripts/check-list-query-payload.mjs
//
// 왜 필요한가. 2026-09-28 Supabase 가 egress 할당량(5.5GB)을 6.47GB 로 넘겨 요청을 버렸다.
// 범인은 목록 화면 셋이 큰 JSON·base64 를 통째로 select 한 것이었다.
//
//   · contract_share_links."templateSnapshot" 행당 150KB — 쓰는 것은 키 두 개
//   · contract_files."issuedSnapshot" 합 2.11MB — 쓰는 것은 이름 한 줄
//   · lease_terms 의 서명 dataURL — 쓰는 것은 있는지 없는지
//
// 실측: 홈 화면 한 번에 5.16MB 가 30.1KB 로 줄었다(99.4% 감소, 판정 23건 전부 동일).
//
// **이 결함은 주석으로 못 막는다는 것이 이미 증명됐다.** getAllContractFiles 에는
// "issuedSnapshot 은 여기서 읽지 않는다" 는 주석이 있었는데 정작 select 에 들어 있었다.
// 누군가 이름 한 줄이 필요해 넣고 주석은 안 고쳤다. 그래서 그물로 막는다.
//
// 보는 축.
//   ⓐ 목록 함수 셋의 **구획 안**에 금지된 컬럼이 select 되지 않는다.
//   ⓑ 좁은 투영 정본(lib/contractListProjection)이 세 함수가 있는 파일에 import 돼 있다.
//   앵커(함수)를 못 찾으면 침묵 통과가 아니라 위반이다 — 이름이 바뀌면 사람이 봐야 한다.
//
// 전체가 필요한 자리(원격 서명 /sign/[token], 발급 상세)는 대상이 아니다. 한 건씩 읽으므로 무겁지 않다.
import { readFileSync } from 'node:fs'

const TARGETS = [
  { file: 'app/(app)/dashboard/alerts.ts', fn: 'computeAlerts' },
  { file: 'app/(app)/contracts/actions.ts', fn: 'getPendingIssueContracts' },
  { file: 'app/(app)/contracts/actions.ts', fn: 'getAllContractFiles' },
]
const BANNED = [
  ['templateSnapshot: true', '행당 150KB 통짜. paperDocsSnapshots 로 키 두 개만 읽어라'],
  ['issuedSnapshot: true', '서명 dataURL 두 장. issuedPrintedNameSnapshots 로 이름만 읽어라'],
  ['signatureImageUrl: true', 'base64 dataURL. 목록은 signatureSignedAt 만 보면 된다'],
  ['disposalSignatureImageUrl: true', 'base64 dataURL. 목록은 disposalSignatureSignedAt 만 보면 된다'],
]

// 줄·블록 주석을 지운다(주석 속 컬럼명이 위반으로 잡히지 않게). 줄 수는 보존한다.
const strip = (src) => src
  .replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '))
  .replace(/(^|[^:\\])\/\/.*$/gm, (m, pre) => pre)

/** 함수 구획 — 선언 줄부터 다음 최상위 선언 직전까지(check-settle-status-canon 과 같은 수법). */
function regionOf(src, name) {
  const at = src.search(new RegExp(`^export\\s+async\\s+function\\s+${name}\\b`, 'm'))
  if (at < 0) return null
  const next = src.indexOf('\nexport ', at + 1)
  return next < 0 ? src.slice(at) : src.slice(at, next)
}

const fails = []
const cache = new Map()
for (const t of TARGETS) {
  if (!cache.has(t.file)) cache.set(t.file, strip(readFileSync(t.file, 'utf8')))
  const src = cache.get(t.file)
  const region = regionOf(src, t.fn)
  if (region == null) { fails.push(`ⓐ ${t.file} 에서 ${t.fn} 구획을 못 찾았다 (이름이 바뀌었나 — 사람이 볼 것)`); continue }
  for (const [needle, why] of BANNED) {
    if (region.includes(needle)) fails.push(`ⓐ ${t.fn} 이 ${needle} 을 읽는다 — ${why}`)
  }
}
for (const f of new Set(TARGETS.map(t => t.file))) {
  if (!cache.get(f).includes(`from '@/lib/contractListProjection'`)) {
    fails.push(`ⓑ ${f} 가 좁은 투영 정본을 import 하지 않는다`)
  }
}

if (fails.length) {
  console.error(`[목록 쿼리 무게] 위반 ${fails.length}건`)
  for (const f of fails) console.error('  ' + f)
  process.exit(1)
}
console.log(`[목록 쿼리 무게] 위반 0건 (목록 함수 ${TARGETS.length}개 · 금지 컬럼 ${BANNED.length}종)`)
