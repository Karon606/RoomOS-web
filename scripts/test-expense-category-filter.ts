// 지출 목록 카테고리 1차 필터 진리표 + 재무 화면 배선 그물 — 실행: npx tsx scripts/test-expense-category-filter.ts
//
// 고정하는 것(운영자 승인 2026-10-23 '추천대로').
//   · 선택지: 이 달에 행이 있는 카테고리를 설정 순서로, 목록 밖 옛 카테고리는 뒤에, 고른 값은 행이 없어도 선다(?cat= 결함 봉합)
//   · 필터 합계 = 걸러진 행 합, 필터 해제('all')면 입력 그대로(돈 불변)
//   · 섞인 주문: 맞는 행만 더하고 '주문 3건 중 2건', 배송비 행은 그 행의 카테고리
//   · 배선: 패널 카테고리 select 제거 · '필터 N' 에서 제외 · SegmentedControl(sm·scroll·비 sticky) · replaceState(?cat=) ·
//     합계 라벨·캡션 · 빈 목록 · '목록에서 보기' · 판정 정본 단일 경유 · 엑셀은 필터를 따라가지 않음
import fs from 'node:fs'
import path from 'node:path'
import { ALL_CATEGORIES, matchesExpenseCategory, expenseCategoryChoices, expenseTotalLabel, categoryFilterCaption, orderGroupChip } from '../lib/expenseCategoryFilter'
import { fmtWon } from '../lib/fmtMoney'

let pass = 0
const fails: string[] = []
function eq(name: string, got: unknown, want: unknown) {
  const a = JSON.stringify(got), b = JSON.stringify(want)
  if (a === b) { pass++; return }
  fails.push(`${name}: 기대 ${b} / 실제 ${a}`)
}
function must(name: string, ok: boolean) { if (ok) pass++; else fails.push(name) }

// ── 진리표 1 · 선택지 구성 ──────────────────────────────────────────
{
  const setting = ['식비', '부식비', '통신/렌탈/보험료', '소모품', '부식비']
  eq('행 있는 카테고리만 설정 순서로, 목록 밖은 뒤 가나다순',
    expenseCategoryChoices(setting, ['소모품', '부식비', '부식비', '옛분류', '가스'], ALL_CATEGORIES),
    ['부식비', '소모품', '가스', '옛분류'])
  eq('설정 중복은 한 번만', expenseCategoryChoices(setting, ['부식비'], ALL_CATEGORIES), ['부식비'])
  eq('?cat= 값이 목록 밖이어도 선택지에 선다(전체로 보이며 걸러지는 결함)',
    expenseCategoryChoices(setting, ['부식비'], '없는분류'), ['부식비', '없는분류'])
  eq('고른 설정 카테고리는 행이 없어도 제자리(설정 순서)에 선다',
    expenseCategoryChoices(setting, ['소모품'], '식비'), ['식비', '소모품'])
  eq('빈 달 · 전체면 선택지 없음', expenseCategoryChoices(setting, [], ALL_CATEGORIES), [])
  eq('빈 카테고리 글자는 버린다', expenseCategoryChoices(setting, ['', '부식비'], ALL_CATEGORIES), ['부식비'])
  eq('긴 이름도 그대로', expenseCategoryChoices(setting, ['통신/렌탈/보험료'], '통신/렌탈/보험료'), ['통신/렌탈/보험료'])
}

// ── 진리표 2 · 행 판정과 필터 합계(돈 불변) ─────────────────────────
{
  eq('all 은 언제나 참', matchesExpenseCategory('아무거나', ALL_CATEGORIES), true)
  eq('같은 카테고리 참', matchesExpenseCategory('부식비', '부식비'), true)
  eq('다른 카테고리 거짓', matchesExpenseCategory('소모품', '부식비'), false)
  const rows = [
    { category: '부식비', amount: 12000 }, { category: '소모품', amount: 3300 }, { category: '부식비', amount: 45000 },
    { category: '통신/렌탈/보험료', amount: 88000 }, { category: '부식비', amount: 0 },
  ]
  const sum = (xs: { amount: number }[]) => xs.reduce((s, r) => s + r.amount, 0)
  const all = rows.filter(r => matchesExpenseCategory(r.category, ALL_CATEGORIES))
  eq('필터 해제면 행·합계 그대로', [all.length, sum(all)], [rows.length, sum(rows)])
  const food = rows.filter(r => matchesExpenseCategory(r.category, '부식비'))
  eq('필터 합계 = 걸러진 행 합', sum(food), 57000)
  // 무작위 다수: 카테고리별 합의 합 == 전체
  let seed = 7
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648
  const cats = ['부식비', '소모품', '가스', '옛분류']
  for (let t = 0; t < 200; t++) {
    const xs = Array.from({ length: Math.floor(rnd() * 30) }, () => ({ category: cats[Math.floor(rnd() * 4)], amount: Math.floor(rnd() * 100000) }))
    const parts = cats.map(c => sum(xs.filter(r => matchesExpenseCategory(r.category, c))))
    if (parts.reduce((a, b) => a + b, 0) !== sum(xs)) { fails.push(`무작위 ${t}: Σ카테고리 합 ≠ 전체`); break }
  }
  pass++
}

// ── 진리표 3 · 합계 라벨·캡션 ───────────────────────────────────────
{
  eq('필터 없으면 종전 글자', expenseTotalLabel(ALL_CATEGORIES), '실제 지출 합계')
  eq('필터면 카테고리 이름', expenseTotalLabel('부식비'), '부식비 합계')
  eq('캡션', categoryFilterCaption(12, 2345000, fmtWon), '12건 · 이 달 전체 2,345,000원')
}

// ── 진리표 4 · 섞인 주문 메타(주문별 보기) ──────────────────────────
{
  eq('다 남으면 종전 칩', orderGroupChip(3, 3), '주문 3품목')
  eq('일부만 남으면 N건 중 M건', orderGroupChip(3, 2), '주문 3건 중 2건')
  eq('배송비만 남으면', orderGroupChip(3, 0), '주문 3건 중 배송비')
  // 주문 하나: 부식비 2 + 소모품 1 + 배송비(부식비)
  const order = [
    { category: '부식비', amount: 10000, isShipping: false }, { category: '부식비', amount: 5000, isShipping: false },
    { category: '소모품', amount: 7000, isShipping: false }, { category: '부식비', amount: 3000, isShipping: true },
  ]
  const shown = order.filter(r => matchesExpenseCategory(r.category, '부식비'))
  eq('섞인 주문 금액은 맞는 행만(배송비는 그 행 카테고리)', shown.reduce((s, r) => s + r.amount, 0), 18000)
  eq('섞인 주문 메타', orderGroupChip(order.filter(r => !r.isShipping).length, shown.filter(r => !r.isShipping).length), '주문 3건 중 2건')
  const other = order.filter(r => matchesExpenseCategory(r.category, '소모품'))
  eq('다른 카테고리에선 배송비가 빠진다', [other.length, other.reduce((s, r) => s + r.amount, 0)], [1, 7000])
}

// ── 배선 ───────────────────────────────────────────────────────────
{
  const f = 'app/(app)/finance/FinanceClient.tsx'
  const s = fs.readFileSync(path.join(__dirname, '..', f), 'utf8')
  const page = fs.readFileSync(path.join(__dirname, '../app/(app)/finance/page.tsx'), 'utf8')
  must(`${f} — 필터 패널 카테고리 select 가 없다(1차 필터로 옮김)`, !/<select value=\{expFilter\.category\}/.test(s))
  const cnt = s.match(/const expFilterCount =\s*\[([^\]]*)\]/)
  must(`${f} — '필터 N' 개수에서 카테고리를 뺀다`, !!cnt && !/category/.test(cnt[1]))
  must(`${f} — 패널 초기화가 카테고리를 지우지 않는다`, /setExpFilter\(f => \(\{ \.\.\.f, method: 'all', finance: 'all', roomId: 'all', kind: 'all' \}\)\)/.test(s))
  const seg = s.match(/<SegmentedControl\s+size="sm"\s+scroll\s+ariaLabel="지출 카테고리"\s+value=\{expFilter\.category\}[\s\S]*?\/>/)
  must(`${f} — 카테고리 SegmentedControl(sm·scroll·value=expFilter.category)`, !!seg)
  must(`${f} — 선택지는 '전체' + catChoices`, !!seg && /\{ value: ALL_CATEGORIES, label: '전체' \}/.test(seg[0]) && /\.\.\.catChoices\.map/.test(seg[0]))
  must(`${f} — 선택지는 정본 expenseCategoryChoices 에 고른 값을 넘겨 만든다`, /const catChoices = expenseCategoryChoices\(\s*expenseCategories,[\s\S]{0,200}?expFilter\.category,\s*\)/.test(s))
  if (seg) {
    const before = s.slice(0, s.indexOf(seg[0]))
    const sticky = before.lastIndexOf('sticky top-0')
    const seg2 = before.slice(sticky)
    const depth = (seg2.match(/<div\b/g) ?? []).length - (seg2.match(/<\/div>/g) ?? []).length
    must(`${f} — 1차 필터는 sticky 검색 줄 밖에 선다`, sticky >= 0 && depth <= 0)
  }
  must(`${f} — ?cat= 를 replaceState 로 유지(기록을 쌓지 않음)`, /window\.history\.replaceState\(null, '', `\$\{url\.pathname\}\$\{url\.search\}\$\{url\.hash\}`\)/.test(s)
    && /url\.searchParams\.set\('cat', want\)/.test(s) && /url\.searchParams\.delete\('cat'\)/.test(s) && !/history\.pushState/.test(s)
    && /\}, \[expFilter\.category, catInUrl\]\)/.test(s))
  must(`${f} — 합계 라벨이 정본 라벨을 쓴다`, /\{`\$\{expenseTotalLabel\(expFilter\.category\)\} `\}<span className="text-\[0\.65625rem\]">\(예정 제외\)<\/span>/.test(s) && !/>실제 지출 합계 </.test(s))
  must(`${f} — 필터 캡션이 걸러진 건수와 이 달 전체(currentTotal)를 말한다`, /expFilter\.category !== ALL_CATEGORIES && \([\s\S]{0,200}categoryFilterCaption\(filteredExpenses\.length, currentTotal, fmtWon\)/.test(s))
  must(`${f} — 합계는 걸러진 목록 합이다`, /const totalExp = filteredExpenses\.reduce\(\(s, e\) => s \+ e\.amount, 0\)/.test(s))
  must(`${f} — 카테고리 판정은 정본 한 곳(손 판정 0)`, !/expFilter\.category (===|!==) 'all'/.test(s) && !/\.category\s*!==\s*expFilter\.category/.test(s) && !/\.category\s*===\s*expFilter\.category/.test(s))
  const uses = (s.match(/matchesExpenseCategory\(\w+\.category, expFilter\.category\)/g) ?? []).length
  must(`${f} — 목록·도래 없음·예정 행·흔적 줄·빈 목록 판정이 정본을 쓴다(${uses}곳)`, uses >= 6)
  must(`${f} — 주문 묶음 칩이 정본을 쓴다(모바일·데스크톱)`, (s.match(/\{orderChipText\(e, grp\)\}/g) ?? []).length === 2 && !/주문 \{grp\.filter\(r => !r\.isShipping\)\.length\}품목/.test(s))
  must(`${f} — 섞인 주문 전체 수는 필터가 걸렸을 때만 주문 요약에서`, /const whole = expFilter\.category !== ALL_CATEGORIES && e\.orderId \? orderSummaries\.get\(e\.orderId\)\?\.count \?\? shown : shown/.test(s))
  must(`${f} — 주문 묶음 금액은 걸러진 행만 더한다`, /const rows = filteredExpenses\.filter\(x => x\.orderId === e\.orderId\)/.test(s))
  must(`${f} — 빈 목록 '이 달 X 지출이 없습니다' + [전체 보기]`, /title=\{`이 달 \$\{expFilter\.category\} 지출이 없습니다`\}/.test(s) && /category: ALL_CATEGORIES \}\)\)\}>전체 보기<\/Btn>/.test(s) && (s.match(/\{?emptyState\}?\n/g) ?? []).length >= 2)
  must(`${f} — 세부 머리 '목록에서 보기'가 카테고리만 걸고 검색어를 비운다`, /onClick=\{\(\) => showCategoryInList\(openCategory, ''\)\}[\s\S]{0,400}목록에서 보기 ›/.test(s))
  const toggle = s.match(/const toggleCategory = \(cat: string\) => \{([\s\S]*?)\n  \}/)
  must(`${f} — 범례 탭은 펼침만(목록을 거르지 않는다)`, !!toggle && !/setExpFilter/.test(toggle[1]))
  must(`${f} — showCategoryInList 가 다른 필터·금액·검색을 정리하고 목록으로 간다`, /const showCategoryInList = \(cat: string, search: string\) => \{\s*setTab\('expense'\)\s*setExpFilter\(\{ method: 'all', category: cat, finance: 'all', roomId: 'all', kind: 'all' \}\)\s*setExpAmountMin\(undefined\); setExpAmountMax\(undefined\)\s*setExpListSearch\(search\)/.test(s))
  must(`${f} — 카테고리가 보이는 자리에 있으니 패널을 펼친 채 열지 않는다`, /const \[showExpFilters, setShowExpFilters\] = useState\(false\)/.test(s) && !/setShowExpFilters\(true\)/.test(s))
  const excel = s.match(/const handleExpenseExcel = \(\) => \{([\s\S]*?)\n  \}/)
  must(`${f} — 지출 엑셀은 필터를 따라가지 않는다`, !!excel && !/expFilter|filteredExpenses/.test(excel[1]))
  must(`page.tsx — ?cat= 를 다듬어 초기값으로 넘긴다`, /initialCategory=\{cat && cat\.trim\(\) \? cat\.trim\(\) : undefined\}/.test(page))
  must(`${f} — 초기값이 ?cat= 이다`, /category: initialCategory \?\? ALL_CATEGORIES/.test(s))
}

console.log(`expense-category-filter: ${pass} 통과, ${fails.length} 실패`)
if (fails.length) { for (const x of fails) console.error('  실패 ' + x); process.exit(1) }
