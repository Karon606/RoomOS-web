// 재고 소모 추이 배선 감지망(신고 9d26a7ee, 2026-10-26 운영자 승인). 읽기 전용, 위반 시 exit 1.
// 실행: node scripts/check-consumption-series-wiring.mjs
//
// 진리표(test-consumption-series)는 표기 판정을 본다. 여기서는 집계·화면이 그 정본을 실제로 부르는가를 글자로 묶는다.
//   ⓐ overview 월 귀속 루프가 소모와 같은 자리에서 일수·끝 점검일을 모은다(분모가 갈리면 하루당이 지어낸 값이 된다).
//   ⓑ 카드 막대가 진행 중인 달 꼬리(partialMonthTail)와 하루당 캡션(perDayCaption)을 정본으로 단다. 꼬리를 title 에만 두지 않는다.
//   ⓒ 진행 중 판정은 시계가 아니라 마지막 슬롯이다(클라 new Date() 로 월을 비교하지 않는다).
//   ⓓ 2단계. 구간 셈 정본은 consumptionSeries 하나다. 개요와 품목 상세 '소모 추이' 서버 액션이 같은 intervalConsumption 을 부르고,
//     개요에 옛 메모리 합산 사본이 되살아나지 않는다. 서버 액션은 영업장 범위로 품목을 찾고, 화면은 탭·기간 세그먼트·정본 창 함수를 쓴다.
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

// ⓓ
need(OV, ov, /import \{[^}]*\bintervalConsumption\b[^}]*\} from '\.\/consumptionSeries'/, '개요가 구간 셈 정본(consumptionSeries)을 import 하지 않는다')
need(OV, ov, /const intervalConsumed = intervalConsumption\(\{ checks: itemChecks,/, '개요의 구간 셈이 정본 intervalConsumption 이 아니다')
for (const [re, what] of [[/const sumPurchasesMem = /, 'sumPurchasesMem'], [/const sumLedgerMem = /, 'sumLedgerMem'], [/function dedupSameDay</, 'dedupSameDay'], [/const effTime = /, 'effTime'], [/intervalPairs/, '구간 짝 셈']]) {
  if (re.test(ov)) violations.push(`${OV}. ${what} 사본이 개요에 되살아났다(정본은 consumptionSeries 하나, 두 벌이면 카드와 상세가 다른 소모를 말한다)`)
}
const AC = 'app/(app)/inventory/actions.ts'
const ac = read(AC)
const fnAt = ac.indexOf('export async function getConsumptionSeries(')
const fn = fnAt >= 0 ? ac.slice(fnAt, ac.indexOf('\nexport async function ', fnAt + 10)) : ''
if (!fn) violations.push(`${AC}. getConsumptionSeries 를 못 찾았다`)
else {
  need(AC, fn, /prisma\.trackedItem\.findFirst\(\{\s*where: \{ id: trackedItemId, propertyId \}/, 'getConsumptionSeries 가 영업장 범위로 품목을 찾지 않는다')
  need(AC, fn, /intervalConsumption\(\{ checks: dedupSameDay\(checks\)/, 'getConsumptionSeries 가 같은 날 dedup 뒤 정본 구간 셈을 부르지 않는다')
  need(AC, fn, /where: \{ propertyId, category: item\.category, itemLabel: item\.label, excludeFromInventory: false \}/, 'getConsumptionSeries 구매 조회가 개요와 같은 술어(영업장·품목·재고 제외 아님)가 아니다')
  need(AC, fn, /today: kstDay\(new Date\(\)\)/, '오늘을 서버 KST 로 주지 않는다(클라 시계로 진행 중 칸을 가르면 월 경계에서 어긋난다)')
}
need(IC, ic, /\{ id: 'trend',\s*label: '소모 추이' \}/, "품목 상세에 '소모 추이' 탭이 없다")
need(IC, ic, /getConsumptionSeries\(trackedItemId\)\.then/, "'소모 추이' 가 서버 액션을 부르지 않는다")
need(IC, ic, /<SegmentedControl<Gran> size="sm" ariaLabel="추이 기간"/, '기간 고르기가 정본 SegmentedControl 이 아니다')
need(IC, ic, /const w = trendWindow\(data\.intervals, gran, data\.today, offset\)/, '창 묶음이 정본 trendWindow(서버 오늘)가 아니다')
// 2026-10-28 운영자 결정: 월 12칸. 칸이 많으면 막대 위 숫자 대신 막대를 눌러 고른 칸을 한 줄로 읽는다(형제 정본 홈 추이 차트).
need(IC, ic, /const valuesOnBars = showsBarValues\(gran\)/, '막대 위 숫자 여부가 정본 showsBarValues 가 아니다(320px 월 12칸에서 세 자리 숫자가 붙는다)')
need(IC, ic, /\{b\.qty == null \? '·' : valuesOnBars \? fmtBar\(b\.qty\) : /, '칸이 많을 때도 막대 위 숫자를 그린다')
need(IC, ic, /const readout = bucketReadout\(w\.buckets\[selIdx\], gran, stockUnit, fmt\)/, '고른 칸 읽기 줄이 정본 bucketReadout 이 아니다')
need(IC, ic, /aria-pressed=\{i === selIdx\}[\s\S]{0,160}onClick=\{\(\) => setSel\(i\)\}/, '막대를 눌러 칸을 고를 수 없다(값을 볼 길이 없다)')

console.log(`[소모 추이 배선] 위반 ${violations.length}건`)
for (const v of violations) console.log('  - ' + v)
process.exit(violations.length ? 1 : 0)
