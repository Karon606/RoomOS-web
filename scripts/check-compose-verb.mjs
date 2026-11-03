// 내용을 채우는 화면을 여는 버튼이 서류 동사 정본 '작성'을 쓰는지 보는 감지망 — 읽기 전용, 위반 시 exit 1.
//
// 서류 동사는 다섯이다(knowledge/doc-vocabulary: 발급·보내기·저장·보기·작성). 서류 시트 알약의 '문자 쓰기'·'메일 쓰기'는
// 같은 일(확인 화면을 연다)을 사전 밖 낱말로 불렀다(2026-11-03 운영자 승인 '추천대로'). 이름 정의처가 둘이면 반드시 갈린다.
//
// 실행: node scripts/check-compose-verb.mjs
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

// 주석은 빼고 본다(개정 경위를 적은 문장은 남아도 된다).
const strip = s => s
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1')
const walk = p => readdirSync(p).flatMap(n => { const f = join(p, n); return statSync(f).isDirectory() ? walk(f) : /\.(tsx|ts)$/.test(f) ? [f] : [] })

const violations = []
for (const f of [...walk('app'), ...walk('components'), ...walk('lib')]) {
  const src = strip(readFileSync(f, 'utf8'))
  const m = /(문자|메일)\s*쓰기/.exec(src)
  if (m) violations.push(`${f}: '${m[0]}' 이 화면 글자에 있다. 내용을 채우는 화면을 여는 버튼은 '${m[1]} 작성'이다(서류 동사 정본)`)
}
// 서류 시트 알약 두 버튼이 정본 라벨로 서 있는가(지우고 초록이 되지 않게).
{
  const f = 'components/doc/TenantDocBundleSheet.tsx'
  const src = strip(readFileSync(f, 'utf8'))
  for (const label of ['문자 작성', '메일 작성']) {
    if (!new RegExp(`<PillButton\\b[^\\n]*\\n\\s*${label}\\s*</PillButton>`).test(src)) violations.push(`${f}: 서류 알약 '${label}' 버튼을 못 찾았다`)
  }
}

console.log(`[작성 동사] 위반 ${violations.length}건`)
for (const v of violations) console.log('  - ' + v)
process.exit(violations.length ? 1 : 0)
