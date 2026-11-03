// 서류 화면 돌아갈 곳(lib/docNav resolveDocBack) 진리표. 실패 시 exit 1.
// 실행: npx tsx scripts/test-doc-nav.ts
import { resolveDocBack } from '../lib/docNav'

let fail = 0
const eq = (name: string, got: unknown, want: unknown) => {
  if (JSON.stringify(got) === JSON.stringify(want)) return
  fail++
  console.log(`  실패 ${name}\n    기대 ${JSON.stringify(want)}\n    실제 ${JSON.stringify(got)}`)
}
const HOME = { label: '홈', href: '/dashboard' }
eq('목록 키', resolveDocBack('rent-receipts'), { label: '납부 확인서 · 영수증', href: '/rent-receipts' })
eq('계약서 키', resolveDocBack('contracts'), { label: '계약서', href: '/contracts' })
eq('입실자 정보', resolveDocBack('tenant', 'a b'), { label: '입실자 정보', href: '/tenants?tenantId=a%20b' })
eq('tenant 인데 id 없음은 홈', resolveDocBack('tenant'), HOME)
eq('없음은 홈', resolveDocBack(undefined), HOME)
eq('모르는 키는 홈', resolveDocBack('nope'), HOME)
// 프로토타입 이름은 표의 키가 아니다(2026-11-04 독립 검수). 종전에는 href 가 undefined 였다.
for (const k of ['constructor', 'toString', '__proto__', 'hasOwnProperty', 'valueOf']) eq(`프로토타입 이름 ${k} 은 홈`, resolveDocBack(k), HOME)
console.log(`[서류 돌아갈 곳 진리표] ${fail === 0 ? '통과' : `실패 ${fail}`}`)
process.exit(fail ? 1 : 0)
