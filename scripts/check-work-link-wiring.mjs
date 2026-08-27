// 지출·작업 연결 배선 감지 — 실행: node scripts/check-work-link-wiring.mjs
//
// 왜 필요한가. 이 기능은 **양방향**이라 한쪽만 배선하면 반쪽이 조용히 죽는다.
//   · 작업 -> 지출 : completeRoomWork 가 mode 기본 'ask' 로 되묻는가
//   · 지출 -> 작업 : 저장 두 경로(등록·수정)가 저장 뒤 되묻는가
// 그리고 판정과 문답이 정본 하나여야 한다 — 베끼면 한쪽만 낡는다(호실 일정에서 겪은 그 사고).
import { readFileSync } from 'node:fs'

const work = readFileSync('app/(app)/room-manage/workActions.ts', 'utf8')
const fin  = readFileSync('app/(app)/finance/FinanceClient.tsx', 'utf8')
const row  = readFileSync('components/work/RoomWorkRowBody.tsx', 'utf8')
const match = readFileSync('lib/roomWorkMatch.ts', 'utf8')

const fails = []
const need = (n, c, hint) => { if (!c) fails.push(`${n}${hint ? ` — ${hint}` : ''}`) }
const count = (s, re) => (s.match(re) ?? []).length

// 판정 정본 — 금액·업체명이 판정에 들어가면 413호 장판을 놓친다.
need('판정 정본이 금액을 안 본다', !/\bamount\b/.test(match.split('export function matchesWork')[1] ?? ''))
need('판정 정본이 업체명을 안 본다', !/\bvendor\b/.test(match.split('export function matchesWork')[1] ?? ''))
need('판정 정본이 공임만 본다', match.includes('isLaborItem'))
{
  const body = (match.split('export function matchesWork')[1] ?? '')
  need('종류를 정규식으로 안 박았다', !/\/[^/\n]*장판[^/\n]*\//.test(body), '멀티테넌트 위반')
}

// 작업 -> 지출
need('completeRoomWork 기본이 ask', work.includes("const mode = input.mode ?? 'ask'"))
need('ask 는 아무것도 안 쓴다', /if \(mode === 'ask' && matched\.length > 0\)[\s\S]{0,200}?return \{[\s\S]{0,80}?needsChoice: true/.test(work))
need('link 갈래가 있다', work.includes("if (mode === 'link' && matched.length > 0)"))
need('행이 문답 정본을 쓴다', row.includes('askWorkLink'))
need('행이 연결 적용취소를 건다', row.includes('unlinkExpensesFromWork'))

// 지출 -> 작업 : 저장 두 경로가 모두 되물어야 한다.
{
  // 정의 1(= async) + 호출 2(등록·수정). 한쪽만 배선하면 반쪽이 조용히 죽는다.
  const def = count(fin, /askLinkAfterExpenseSave = async/g)
  const call = count(fin, /await askLinkAfterExpenseSave\(/g)
  need('되묻기 정의는 하나', def === 1, `실제 ${def}`)
  need('지출 저장 두 경로가 되묻는다', call === 2, `실제 ${call}`)
}
need('지출 쪽이 문답 정본을 쓴다', fin.includes('askExpenseWorkLink'))
need('지출 쪽이 연결 적용취소를 건다', fin.includes('unlinkExpensesFromWork'))
// 저장 트랜잭션 안에 판정을 넣으면 저장이 그만큼 위험해진다.
need('판정이 저장 액션 밖이다', !readFileSync('app/(app)/finance/actions.ts', 'utf8').includes('matchesWork'))

// 자동으로 묶는 분기가 하나도 없어야 한다.
need('자동 연결 분기 없음', !/mode\s*=\s*['"]link['"]\s*;?\s*\/\/\s*auto/.test(work))

console.log(`\n[지출·작업 연결 배선] 위반 ${fails.length}건`)
for (const f of fails) console.log('  - ' + f)
if (fails.length > 0) process.exit(1)
