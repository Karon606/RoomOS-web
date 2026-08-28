// 화면 안 로딩 자리에 브랜드 마크가 서는 것을 잡는 감지망 — 읽기 전용, 위반 시 exit 1.
//
// 브랜드 마크(아치)는 **셸이 없는 구간**의 것이다. 콜드 부트·로그아웃·소셜 리디렉트처럼
// 앱이 아직 안 그려진 자리에서 "여기 스테이음이다"를 말한다. 앱 안에서 이미 화면이 서 있는데
// 모달 본문이나 목록 자리에 같은 마크가 뜨면, 그 자리가 잠깐 다른 앱처럼 보인다
// (운영자 지적 2026-08-28 — 재고 품목 모달. "아직 남아있네"라는 말대로 재발한 자리다).
//
// 그 자리의 정본은 SkeletonRows 다(components/ui/Skeleton, v2.0 §17). 자리를 잡아 주면서
// 브랜드를 두 번 말하지 않는다.
//
// 실행: node scripts/check-inline-brand-loader.mjs
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

// 마크가 정당한 자리 — 셸 없는 구간의 스플래시와 워드마크 정본.
const ALLOW_DIR = 'components/brand'
const ROOTS = ['app', 'components']
// 아치 경로 정본과 그 상수 이름. 손으로 베낀 좌표까지 잡는다.
const MARK = /ARCH_PATH|M ?8 ?82 ?C ?8 ?32/

function walk(p) {
  const out = []
  for (const n of readdirSync(p)) {
    const f = join(p, n)
    if (f.startsWith(ALLOW_DIR)) continue
    const st = statSync(f)
    if (st.isDirectory()) out.push(...walk(f))
    else if (/\.tsx?$/.test(f)) out.push(f)
  }
  return out
}

const violations = []
let checked = 0
for (const root of ROOTS) {
  for (const f of walk(root)) {
    checked++
    const src = readFileSync(f, 'utf8')
    if (MARK.test(src)) {
      violations.push(`${f} — 앱 화면 안에서 브랜드 마크를 그린다. 로딩 자리면 SkeletonRows 를 쓸 것`)
    }
  }
}

console.log(`[인라인 브랜드 로더] 파일 ${checked}개 검사 / 위반 ${violations.length}건`)
if (violations.length > 0) {
  console.error('')
  for (const v of violations) console.error(`  - ${v}`)
  console.error('')
  console.error('  브랜드 마크는 셸 없는 구간(components/brand)의 것이다. 앱 안 로딩 자리의 정본은 SkeletonRows.')
  process.exit(1)
}
