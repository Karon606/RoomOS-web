// 서류 화면이 '들어온 곳'을 잊고 목록으로 튕기는 것을 잡는 감지망. 읽기 전용, 위반 시 exit 1.
//
// 왜 필요한가(신고 2026-09-03). 입주자 상세의 서류 시트에서 실거주 확인서를 발급하면 그 사람에게
// 돌아와야 하는데 실거주 확인서 **목록**으로 갔다. 납부 확인서·보증금 영수증도 같았다.
//
// 정본은 이미 있었다. `lib/docNav` 의 `resolveDocBack` 이고, 그 파일 주석이 이 증상을 정확히
// 예고해 두었다 — "화면마다 하드코딩하던 것이 '입주자 상세에서 들어갔는데 목록으로 튕긴다'를
// 만들었다". 그런데 **작성 화면 둘이 그 정본을 안 타고** 목록 경로를 손으로 적고 있었다.
// 진입 링크(서류 시트 writeHref)는 from 을 제대로 싣고 있었으므로, 받는 쪽만 빠진 것이다.
//
//   ⓐ 서류 작성 화면의 page 가 from·tenantId 를 읽어 resolveDocBack 으로 옮긴다.
//   ⓑ 그 화면 안에 목록 경로 리터럴이 없다. 돌아가기 링크도 발급 후 이동도 back 을 쓴다.
//
// 실행: node scripts/check-doc-back-nav.mjs
import { readFileSync } from 'node:fs'

// (작성 화면 page, 그 화면 컴포넌트)
const SCREENS = [
  ['app/residence-cert/[tenantId]/page.tsx', 'app/residence-cert/[tenantId]/ResidenceCertView.tsx'],
  ['app/rent-receipt/[tenantId]/page.tsx', 'app/rent-receipt/[tenantId]/RentReceiptView.tsx'],
]
// 이 화면들이 손으로 적으면 안 되는 목적지 — 목록으로 튕기는 길이다.
const LIST_PATHS = ['/residence-certs', '/rent-receipts', '/contracts']

const violations = []
const strip = s => s
  .replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ''))
  .replace(/^[^\S\n]*\/\/.*$/gm, '')

for (const [page, view] of SCREENS) {
  const p = strip(readFileSync(page, 'utf8'))
  // ⓐ page 가 복귀 정보를 읽어 정본으로 옮기는가.
  if (!/resolveDocBack\(/.test(p)) {
    violations.push(`${page} — resolveDocBack 을 안 쓴다. 들어온 곳을 모른 채 화면이 열린다.`)
  }
  if (!/from\?: string/.test(p) || !/tenantId\?: string/.test(p)) {
    violations.push(`${page} — searchParams 에서 from·tenantId 를 안 읽는다. 진입 링크가 실어 보낸 복귀 정보가 버려진다.`)
  }

  // ⓑ 화면이 목록 경로를 손으로 적는가.
  const v = strip(readFileSync(view, 'utf8'))
  v.split('\n').forEach((line, i) => {
    for (const path of LIST_PATHS) {
      if (line.includes(`'${path}`) || line.includes(`"${path}`)) {
        violations.push(`${view}:${i + 1} 목록 경로를 손으로 적었다. 돌아갈 곳은 back(resolveDocBack)이 정한다.`)
      }
    }
  })
  if (!/back\.href/.test(v)) {
    violations.push(`${view} — back.href 를 안 쓴다. 돌아가기 링크와 발급 후 이동이 정본을 안 탄다.`)
  }
}

console.log(`[서류 복귀 경로] 작성 화면 ${SCREENS.length}개 검사 / 위반 ${violations.length}건`)
for (const v of violations.slice(0, 15)) console.error(`  - ${v}`)
process.exit(violations.length > 0 ? 1 : 0)
