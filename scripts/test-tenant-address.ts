// 입주자 실거주 주소 조립(lib/tenantAddress) 진리표 — 층 꼬리 걷기와 빈 조각 규칙.
import { tenantResidenceAddress, roomLabel } from '../lib/tenantAddress'

let pass = 0; let fail = 0
const eq = (name: string, got: unknown, want: unknown) => {
  const g = JSON.stringify(got); const w = JSON.stringify(want)
  if (g === w) { pass++ } else { fail++; console.error(`  - ${name}: 기대 ${w} / 실제 ${g}`) }
}

// 층 꼬리 걷기(운영자 지적 2026-09-07) — 실DB 두 표기 그대로.
eq('쉼표 나열 층', tenantResidenceAddress('서울특별시 동대문구 왕산로 16길 9 (용두동) 4,5층', '418'),
  '서울특별시 동대문구 왕산로 16길 9 (용두동) 418호')
eq('물결 범위 층(앞 쉼표까지)', tenantResidenceAddress('서울특별시 동대문구 왕산로 16길 9, 4~5층', '418'),
  '서울특별시 동대문구 왕산로 16길 9 418호')
eq('단일 층', tenantResidenceAddress('서울 어딘가로 1 3층', '201'), '서울 어딘가로 1 201호')
eq('지하 층', tenantResidenceAddress('서울 어딘가로 1 지하1층', '201'), '서울 어딘가로 1 201호')
eq('층 표기 없으면 그대로', tenantResidenceAddress('서울 어딘가로 1 (용두동)', '201'), '서울 어딘가로 1 (용두동) 201호')
// 중간의 층 표기는 건물명 일부일 수 있다 — 마지막 토큰만 걷는다.
eq('중간 층 표기는 보존', tenantResidenceAddress('서울 3층집길 9', '201'), '서울 3층집길 9 201호')
// 방이 없으면 층은 유효한 소재 표기라 걷지 않는다.
eq('방 없으면 층 유지', tenantResidenceAddress('서울 어딘가로 1 4~5층', null), '서울 어딘가로 1 4~5층')
// 빈 조각 규칙(종전 그대로).
eq('주소 없으면 방만', tenantResidenceAddress('', '201'), '201호')
eq('둘 다 없으면 빈 값', tenantResidenceAddress(null, null), '')
// 호 라벨 규칙(종전 그대로).
eq('숫자면 호를 붙인다', roomLabel('418'), '418호')
eq('글자 섞이면 그대로', roomLabel('423호 오피스'), '423호 오피스')

console.log(`입주자 주소 조립 회귀: ${pass} 통과 / ${fail} 실패`)
if (fail > 0) process.exit(1)
