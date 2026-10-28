// 재고 소모 추이 배선 감지망(신고 9d26a7ee, 2026-10-26 운영자 승인). 읽기 전용, 위반 시 exit 1.
// 실행: node scripts/check-consumption-series-wiring.mjs
//
// 진리표(test-consumption-series)는 표기 판정을 본다. 여기서는 집계·화면이 그 정본을 실제로 부르는가를 글자로 묶는다.
//   ⓐ overview 월 귀속 루프가 소모와 같은 자리에서 일수·끝 점검일을 모은다(분모가 갈리면 하루당이 지어낸 값이 된다).
//   ⓑ 카드 막대가 진행 중인 달 꼬리(partialMonthTail)와 하루당 캡션(perDayCaption)을 정본으로 단다. 꼬리를 title 에만 두지 않는다.
//   ⓒ 진행 중 판정은 시계가 아니라 마지막 슬롯이다(클라 new Date() 로 월을 비교하지 않는다).
import { readFileSync } from 'node:fs'

const violations = []
const strip = (src) => src
  .replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '))
  .replace(/(^|[^:\\'"`])\/\/.*$/gm, (m, pre) => pre)
const read = (f) => { try { return strip(readFileSync(f, 'utf8')) } catch { violations.push(`${f}. 파일을 못 읽었다`); return '' } }
const need = (f, src, re, msg) => { if (!re.test(src)) violations.push(`${f}. ${msg}`) }

const OV = 'app/(app)/inventory/overview.ts'
const ov = read(OV)
need(OV, ov, /for \(const \{ curr, consumed, days \} of intervalConsumed\) \{[\s\S]{0,400}monthlyMap\[key\] = \(monthlyMap\[key\] \?\? 0\) \+ consumed\s*\n\s*monthlyDays\[key\] = \(monthlyDays\[key\] \?\? 0\) \+ days/, '월 귀속 루프가 소모와 일수를 같은 자리에서 모으지 않는다')
need(OV, ov, /days: qty == null \? null : \(monthlyDays\[month\] \?\? null\)/, '미관측 달의 일수가 null 이 아니다')
need(OV, ov, /lastDate: qty == null \? null : \(monthlyLast\[month\] \?\? null\)/, '월 슬롯에 끝 점검일이 안 실린다')

const IC = 'app/(app)/inventory/InventoryClient.tsx'
const ic = read(IC)
need(IC, ic, /import \{ partialMonthTail, perDayCaption[^}]*\} from '\.\/consumptionSeries'/, '소모 추이 표기 정본을 import 하지 않는다')
need(IC, ic, /const tail = partialMonthTail\(m, isCurrent\)/, '진행 중인 달 꼬리를 정본으로 판정하지 않는다')
need(IC, ic, /\{tail && \(\s*<span[^>]*>\{tail\}<\/span>/, "진행 중인 달 'N일까지' 가 글자로 안 선다(hover 툴팁은 터치 화면에 없다)")
need(IC, ic, /const cap = perDayCaption\(row\.monthlyConsumption, stockUnit\)/, '하루당 캡션을 정본으로 만들지 않는다')
need(IC, ic, /const isCurrent = i === lastIdx/, '진행 중 판정이 마지막 슬롯(구조적)이 아니다')

console.log(`[소모 추이 배선] 위반 ${violations.length}건`)
for (const v of violations) console.log('  - ' + v)
process.exit(violations.length ? 1 : 0)
