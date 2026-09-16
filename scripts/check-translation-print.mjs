// 참고용 번역본 검수 종이의 세 축을 지키는 감지망. 읽기 전용, 위반 시 exit 1 (2026-09-17).
//
// 자립(외부 참조 0·폰트 두 벌)과 글꼴 파일 실재는 scripts/check-print-selfcontained.ts 가 본다.
// 여기는 그 그물이 못 보는 셋이다.
//
//   축 4 — **이 라우트는 아무것도 저장하지 않는다.** prisma 의 쓰기도 Drive 업로드도 없다.
//          그 사실이 "적용취소가 없어도 되는 이유"의 전부다(되돌릴 상태가 없다). 저장을 한 줄
//          들이는 순간 그 근거가 사라지는데, 그 변화는 화면에서 아무 소리도 안 낸다.
//   축 5 — 종이가 자기가 무엇인지 말한다. 머리와 **꼬리말 양쪽**에 '참고용 · 계약서 아님'이
//          서야 한다. 검수자는 이 종이를 받아 읽는 사람이고, 어느 장을 펴도 계약서가 아니라는
//          것을 알아야 한다. 머리만 있으면 2장째부터는 아무 표식이 없는 계약서처럼 읽힌다.
//   축 6 — 해석 결과가 **하나도 빠짐없이 순서대로** 종이에 선다. 절 하나가 조용히 빠지면
//          검수자는 "이 조항은 번역이 없다"가 아니라 "이 조항은 없다"로 읽고, 그 답은 거짓이다.
//          조항 번호는 자리로 매기므로 하나가 빠지면 그 아래 번호가 통째로 밀린다.
//
// 실행: npx tsx scripts/check-translation-print.mjs
import { readFileSync } from 'node:fs'
import { DEFAULT_CONTRACT_TEMPLATE, propertyContractAddenda, appendSubLeaseAddendum, renderContractText, stripClauseBullet } from '../lib/contract.ts'
import { resolveContractTranslation, translationSourceLines } from '../lib/contractTranslation.ts'
import { buildContractTranslationPrintHtml, buildTranslationPrintFooterTemplate, TRANSLATION_PRINT_FOOTER_TEXT } from '../lib/contractTranslationPrintHtml.ts'

const ROUTE = 'app/api/contract-translation/pdf/route.ts'
const violations = []

/** 주석을 지운 소스. 주석 안의 예시 문자열이 축 4 를 오발화시키지 않게 한다. */
const strip = s => s
  .replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ''))
  .replace(/^[^\S\n]*\/\/.*$/gm, '')

// ── 축 4. 아무것도 저장하지 않는다 ─────────────────────────────────────────
{
  let src
  try { src = strip(readFileSync(ROUTE, 'utf8')) } catch {
    violations.push(`${ROUTE} 를 읽지 못했다 — 라우트가 옮겨졌으면 이 그물부터 고친다. 축 4~6 은 판정 불가다`)
    src = null
  }
  if (src) {
    const write = /prisma\s*\.\s*[A-Za-z_$][\w$]*\s*\.\s*(create|createMany|createManyAndReturn|update|updateMany|upsert|delete|deleteMany)\s*\(/g
    let m
    while ((m = write.exec(src))) {
      violations.push(`${ROUTE} 가 prisma.${m[1]} 로 DB 를 쓴다 — 이 라우트는 읽기뿐이라야 한다.`
        + ' 저장이 생기면 적용취소가 필요해지고(되돌릴 상태가 생긴다), 검수용 종이라는 성격 자체가 바뀐다')
    }
    for (const [re, what] of [
      [/\$transaction\s*\(/, 'prisma.$transaction'],
      [/\$executeRaw/, 'prisma.$executeRaw'],
      [/uploadToDrive/, 'uploadToDrive'],
    ]) {
      if (re.test(src)) {
        violations.push(`${ROUTE} 에 ${what} 가 있다 — 이 종이는 DB 에도 Drive 에도 안 남는다.`
          + ' 남기기 시작하면 발급 이력·박제·삭제 복구까지 따라와야 하고, 그것은 다른 기능이다')
      }
    }
  }
}

// ── 더미 종이 한 벌 — 축 5·6 이 같은 결과물을 본다 ─────────────────────────
const template = DEFAULT_CONTRACT_TEMPLATE
const addenda = propertyContractAddenda({}, true)
// 줄마다 서로 다른 번역을 넣는다. 같은 문자열이 여러 줄에 서면 '순서대로 전부 있다'를 못 가른다.
// 번호는 자릿수를 맞춘다 — '번역줄5' 는 '번역줄50' 안에 들어 있어, 5번 줄이 빠져도 50번 줄이
// 그 자리를 대신 맞춰 준다(그러면 빠짐을 '순서 어김'으로 잘못 부르거나 아예 놓친다).
const lines = translationSourceLines(template, addenda, true, 'property')
const dict = {}
lines.forEach((l, i) => { dict[l.text] = `번역줄${String(i).padStart(4, '0')}` })
const resolved = resolveContractTranslation(
  { enabled: true, langs: { ja: { published: true, dict } } },
  template, 'ja', addenda, true)

if (!resolved) {
  violations.push('더미 해석이 null 이다 — 그물이 축 5·6 을 판정할 수 없다. 해석 정본이 바뀌었으면 여기부터 고친다')
} else {
  const html = buildContractTranslationPrintHtml(resolved, {
    source: template, sourceAddenda: addenda,
    pretendardBase64: 'ZHVtbXk=', scriptFontBase64: 'ZHVtbXk=', today: '2026-01-01',
  })
  const footer = buildTranslationPrintFooterTemplate('ZHVtbXk=')

  // ── 축 5. 종이가 자기가 무엇인지 말한다 ─────────────────────────────────
  // 영어 한 줄은 대소문자를 안 따진다. 머리에서는 홀로 선 라벨이라 'Not a contract' 이고
  // 꼬리말에서는 문장 안이라 'not a contract' 다 — 둘 다 옳은 영어고, 여기서 따지면 그물이
  // 문장 부호를 강요하게 된다. 지켜야 할 것은 **그 말이 있느냐**다.
  for (const [where, doc] of [['종이 본문', html], ['꼬리말 템플릿', footer]]) {
    const hay = doc.toLowerCase()
    for (const phrase of ['참고용', '계약서 아님', 'not a contract']) {
      if (!hay.includes(phrase)) {
        violations.push(`${where}에 '${phrase}' 가 없다 — 검수자가 받아 읽는 종이라 어느 장을 펴도`
          + ' 계약서가 아니라는 것이 읽혀야 한다. 머리에만 있으면 2장째부터 표식이 없다')
      }
    }
  }
  if (!footer.includes(TRANSLATION_PRINT_FOOTER_TEXT)) {
    violations.push('꼬리말 템플릿이 TRANSLATION_PRINT_FOOTER_TEXT 정본을 안 쓴다 — 문안이 두 벌이 되면 한쪽만 고쳐진다')
  }

  // ── 축 6. 해석 결과가 순서대로 전부 선다 ────────────────────────────────
  // 절 번호는 종이와 같은 정본이 매긴다(appendSubLeaseAddendum). 기대값을 손으로 세면 형제 절이
  // 하나 늘 때 그물만 어긋난다.
  const render = s => (resolved.vars ? renderContractText(s, resolved.vars) : s)
  const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const expected = [['제목', esc(render(resolved.title))]]
  for (const sec of appendSubLeaseAddendum(resolved.sections, ...(resolved.addenda ?? []))) {
    expected.push([`절 제목 '${sec.title.slice(0, 20)}'`, esc(render(sec.title))])
    for (const item of sec.items) expected.push([`항목 '${item.slice(0, 20)}'`, esc(stripClauseBullet(render(item)))])
  }
  if (resolved.oathText) expected.push(['서약문', esc(render(resolved.oathText))])

  let cursor = 0
  for (const [what, text] of expected) {
    if (!text) continue
    const at = html.indexOf(text, cursor)
    if (at < 0) {
      violations.push(html.includes(text)
        ? `${what} 가 종이에 **순서를 어겨** 서 있다 — 조항 번호는 자리로 매기므로 순서가 바뀌면 "몇 조 몇 항"이 두 종이에서 다른 곳을 가리킨다`
        : `${what} 가 종이에 없다 — 해석은 그 줄을 내놨는데 종이가 안 그렸다. 검수자는 "번역이 없다"가 아니라 "조항이 없다"로 읽는다`)
      continue
    }
    cursor = at + text.length
  }
  if (expected.length < 10) {
    violations.push(`기대 문자열이 ${expected.length}개뿐이다 — 더미 해석이 비었거나 구조가 바뀌었다. 그물이 사실상 아무것도 안 본다`)
  }
}

if (violations.length) {
  console.error(`\n[번역본 검수 종이] 위반 ${violations.length}건`)
  for (const v of violations) console.error('  - ' + v)
  console.error('\n  이 종이는 저장되지 않는 검수용이고, 운영자는 여기 실린 글자를 스스로 읽지 못한다(2026-09-17 오더).')
  process.exit(1)
}
console.log('[번역본 검수 종이] 저장 0건 · 참고용 표식 머리와 꼬리말 · 해석 결과 순서대로 전부 / 위반 0건')
