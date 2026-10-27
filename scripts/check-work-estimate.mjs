// 작업 견적 금액(RoomWork.estimateAmount)이 돈 계산에 섞이지 않게 지키는 정적 감지망 — 읽기 전용, 위반 시 exit 1.
//
// 왜 (2026-10-27 운영자 요청·승인 계획 3단계 결정 5). "작업 완료 전에 견적 금액을 미리 받을 수도 있으니 완료 전이라도 금액은 미리 입력할 수 있는 옵션".
// 견적은 **돈이 아니라 메모**다. 지출을 만들지 않고 집계(sum)·결산·카드 정산에 절대 안 섞인다. 섞이면 아직 안 나간 돈이 방 투자금·월 지출로 잡힌다.
//
// 축.
//   ⓐ 이 칸 이름이 나오는 파일은 허용 목록뿐이다(app·lib·components). 새 자리가 생기면 사람이 보고 여기 적는다(fail closed).
//   ⓑ 허용 파일 안에서도 집계(_sum·aggregate·groupBy·reduce)와 지출 쓰기(expense.create/update 의 data·amount) 가까이에 이 칸이 없다.
//   ⓒ 완료 폼은 견적을 시공비 칸의 처음 값으로만 쓴다(setCost), 완료 액션은 견적을 읽지 않는다.
//   ⓓ 마이그레이션 SQL 은 멱등(ADD COLUMN IF NOT EXISTS)이다. ⓔ verify:fast 등록.
//
// 실행: node scripts/check-work-estimate.mjs
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const fails = []
const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' ')).replace(/(^|[^:])\/\/[^\n]*/g, '$1')
const ALLOW = new Set([
  'app/(app)/room-manage/workActions.ts',
  'app/(app)/room-manage/recordEditActions.ts',
  'lib/roomRecordEditUndo.ts',
  'components/work/RoomWorkPlanForm.tsx',
  'components/work/RoomWorkEditModal.tsx',
  'components/work/RoomWorkRowBody.tsx',
])
function walk(d, out = []) {
  for (const n of readdirSync(d)) {
    if (n === 'node_modules' || n.startsWith('.')) continue
    const p = join(d, n)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.(ts|tsx|mjs|js)$/.test(n)) out.push(p)
  }
  return out
}
const seen = new Set()
for (const f of [...walk('app'), ...walk('lib'), ...walk('components')]) {
  const s = strip(readFileSync(f, 'utf8'))
  if (!/\bestimateAmount\b/.test(s)) continue
  seen.add(f)
  if (!ALLOW.has(f)) { fails.push(`ⓐ ${f} · 견적(estimateAmount)을 허용 목록 밖에서 쓴다. 돈 계산에 섞이지 않는지 보고 이 그물 ALLOW 에 적을 것`); continue }
  const lines = s.split('\n')
  lines.forEach((ln, i) => {
    if (!/\bestimateAmount\b/.test(ln)) return
    const win = lines.slice(Math.max(0, i - 3), i + 4).join('\n')
    if (/_sum|aggregate\(|groupBy\(|\.reduce\(/.test(win)) fails.push(`ⓑ ${f}:${i + 1} · 견적이 집계(_sum·aggregate·groupBy·reduce) 가까이에 있다. 견적은 어떤 합계에도 안 든다`)
    if (/amount:\s*[^,\n]*estimateAmount/.test(ln)) fails.push(`ⓑ ${f}:${i + 1} · 견적을 금액(amount)으로 쓴다. 지출을 만들지 않는다`)
  })
  for (const m of s.matchAll(/\.expense\.(create|update|updateMany|upsert)\(/g)) {
    let depth = 0, j = m.index + m[0].length - 1
    for (; j < s.length; j++) { if (s[j] === '(') depth++; else if (s[j] === ')' && --depth === 0) break }
    if (/estimateAmount|estimate\b/.test(s.slice(m.index, j))) fails.push(`ⓑ ${f} · 지출 쓰기(expense.${m[1]})가 견적을 싣는다`)
  }
}
for (const f of ALLOW) if (!seen.has(f)) fails.push(`ⓐ ${f} · 허용 목록에 있는데 견적을 안 쓴다(낡은 목록이다)`)

{
  const w = strip(readFileSync('app/(app)/room-manage/workActions.ts', 'utf8'))
  const complete = (w.split('export async function completeRoomWork(')[1] ?? '').split('\nexport ')[0]
  if (!complete) fails.push('ⓒ completeRoomWork 를 못 찾았다')
  if (/estimate/i.test(complete)) fails.push('ⓒ completeRoomWork 가 견적을 읽는다. 완료 지출 금액은 화면이 적은 시공비(cost)뿐이다')
  const row = strip(readFileSync('components/work/RoomWorkRowBody.tsx', 'utf8'))
  if (!/if \(est\) setCost\(String\(est\)\)/.test(row) || !/견적에서 채웠습니다/.test(row)) fails.push('ⓒ RoomWorkRowBody · 완료 폼이 견적을 시공비 칸 처음 값으로 채우고 그 사실을 말하지 않는다')
  // 견적과 실제는 값이 바뀐 것이 아니라 비교라 가운뎃점으로 나란히 적는다(§29 화살표는 값 전환에만, 독립 검수 권고 7). '실제' 는 시공 몫이라 '실제 시공비'.
  if (!/`견적 \$\{fmtWon\(r\.estimateAmount\)\} · 실제 시공비 \$\{fmtWon\(r\.cost\)\}`/.test(row)) fails.push('ⓒ RoomWorkRowBody · 견적과 실제 시공비가 다를 때 비교 표기(견적 X원 · 실제 시공비 Y원)가 없다')
  if (/견적[^`\n]*→/.test(row)) fails.push('ⓒ RoomWorkRowBody · 견적 비교에 화살표를 쓴다(값 전환이 아니다, §29)')
  const rev = (w.split('export async function reopenRoomWork(')[1] ?? '').split('\nexport ')[0]
  if (/estimateAmount/.test(rev)) fails.push('ⓒ reopenRoomWork 가 견적을 건드린다. 완료 적용취소에도 견적은 남는다')
}
{
  const sql = readFileSync('prisma/migrate_room_work_estimate.sql', 'utf8')
  if (!/ALTER TABLE "room_works" ADD COLUMN IF NOT EXISTS "estimateAmount" INTEGER;/.test(sql)) fails.push('ⓓ prisma/migrate_room_work_estimate.sql 가 멱등(ADD COLUMN IF NOT EXISTS) 이 아니다')
  if (!/^\s+estimateAmount Int\?/m.test(readFileSync('prisma/schema.prisma', 'utf8'))) fails.push('ⓓ schema.prisma RoomWork 에 estimateAmount Int? 가 없다')
}
if (!JSON.parse(readFileSync('package.json', 'utf8')).scripts['verify:fast'].includes('node scripts/check-work-estimate.mjs')) fails.push('ⓔ package.json verify:fast 에 이 그물이 없다')

console.log(`[작업 견적] 축 ⓐ 허용 파일 ${ALLOW.size} · ⓑ 집계·지출 쓰기 금지 · ⓒ 완료 폼·완료 액션·적용취소 · ⓓ 스키마·SQL · ⓔ 등록 / 위반 ${fails.length}건`)
for (const f of fails) console.log('  - ' + f)
process.exit(fails.length ? 1 : 0)
