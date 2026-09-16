// 참고용 번역본 검수 종이의 다섯 축을 지키는 감지망. 읽기 전용, 위반 시 exit 1 (2026-09-17).
//
// 자립(외부 참조 0·폰트 두 벌)과 글꼴 파일 실재는 scripts/check-print-selfcontained.ts 가 본다.
// 여기는 그 그물이 못 보는 넷이다.
//
//   축 4 — **이 라우트는 아무것도 저장하지 않는다.** prisma 의 쓰기도 Drive 업로드도 없다.
//          그 사실이 "적용취소가 없어도 되는 이유"의 전부다(되돌릴 상태가 없다). 저장을 한 줄
//          들이는 순간 그 근거가 사라지는데, 그 변화는 화면에서 아무 소리도 안 낸다.
//   축 5 — 종이가 자기가 무엇인지 말한다. 머리와 **꼬리말 양쪽**에 '참고용 · 계약서 아님'이
//          서야 하고, **그 언어로도** 같은 말이 서야 한다. 검수자는 이 종이를 받아 읽는 사람이고,
//          어느 장을 펴도 계약서가 아니라는 것을 알아야 한다. 머리만 있으면 2장째부터는 아무
//          표식이 없는 계약서처럼 읽힌다. 한국어만 있으면 그 표식을 검수자가 못 읽는다.
//   축 6 — 해석 결과가 **하나도 빠짐없이 순서대로** 종이에 선다. 절 하나가 조용히 빠지면
//          검수자는 "이 조항은 번역이 없다"가 아니라 "이 조항은 없다"로 읽고, 그 답은 거짓이다.
//          조항 번호는 자리로 매기므로 하나가 빠지면 그 아래 번호가 통째로 밀린다.
//   축 7 — **검수 지시가 검수자의 언어로 서고, 그 글자가 실제로 그려진다**(2026-09-17 오더).
//          이 종이는 그 언어를 읽을 줄 아는 사람에게 보내 "번역이 맞는지" 묻는 종이다. 지시가
//          한국어뿐이면 검수자는 지시를 못 읽은 채 답하고 그 답은 거짓이며, 운영자는 한자·벵골
//          글자를 스스로 못 읽어 그 거짓을 검증할 방법이 없다. 그래서 셋을 함께 본다.
//            · 일곱 언어 전부에 표식·진행·안내 문안이 실제로 종이에 있는가
//            · 종이에 오른 글자가 (그 언어 글꼴 ∪ Pretendard) cmap 안에 전부 있는가 —
//              두부(□)를 **구조로** 막는다. 운영자는 두부와 정상 글자를 구별하지 못한다
//            · 본문 밖 어느 규칙도 font-family 를 Pretendard 로 못박지 않는가 — 못박으면
//              그 자리만 두부가 되는데, cmap 대조는 글꼴 합집합을 보므로 그것을 못 잡는다
//   축 8 — **화면이 종이와 같은 사전을 쓴다**(2026-09-17 오더). 축 7 은 종이만 보는데, 같은
//          표식·같은 머리가 화면에도 서고 그 화면은 **원격 서명에서 외국인 입주자가 직접 보는
//          자리**다. 종이만 일곱 언어로 가고 화면이 한국어·영어로 남으면, 자기 언어로 계약서를
//          읽는 사람에게 화면에서 유일하게 못 읽는 글자가 "이 줄만 번역이 없다"는 그 표식이 된다.
//          그리고 운영자 미리보기가 종이와 다른 글자를 보이는 순간, 그 창은 확인이 아니라
//          착각이 된다. 그래서 둘을 함께 본다.
//            · 화면을 **실제로 그려** 일곱 언어의 표식·배지가 사전 문자열 그대로 서는가 —
//              소스 문자열만 찾으면 `import` 만 남기고 호출을 지우는 손질을 못 잡는다
//            · 화면 파일에 한국어 `원문`·`Reference only` 리터럴이 되살아나지 않았는가 —
//              사전을 부르는 척하며 옆에 리터럴을 세우는 손질은 그림만으로는 안 걸린다
//
// 실행: npx tsx scripts/check-translation-print.mjs
import { readFileSync } from 'node:fs'
import { brotliDecompressSync } from 'node:zlib'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { DEFAULT_CONTRACT_TEMPLATE, propertyContractAddenda, appendSubLeaseAddendum, renderContractText, stripClauseBullet } from '../lib/contract.ts'
import { ContractTranslationBody, ContractTranslationCard } from '../components/doc/ContractTranslationView.tsx'
import {
  resolveContractTranslation, translationSourceLines, TRANSLATION_LANGS,
  TRANSLATION_PRINT_MARK, TRANSLATION_PRINT_PROGRESS_LEFT, TRANSLATION_PRINT_PROGRESS_MARKED,
  TRANSLATION_PRINT_PROGRESS_ALL, TRANSLATION_PRINT_VAR_GUIDE,
} from '../lib/contractTranslation.ts'
import {
  TRANSLATION_PRINT_HEAD, TRANSLATION_PRINT_FOOTER,
} from '../lib/contractTranslation.ts'
import {
  buildContractTranslationPrintHtml, buildTranslationPrintFooterTemplate, TRANSLATION_SCRIPT_FONT,
} from '../lib/contractTranslationPrintHtml.ts'

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
    violations.push(`${ROUTE} 를 읽지 못했다 — 라우트가 옮겨졌으면 이 그물부터 고친다. 축 4~7 은 판정 불가다`)
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

// ── 더미 종이 — 축 5·6·7 이 같은 정본으로 만든 결과물을 본다 ────────────────
const template = DEFAULT_CONTRACT_TEMPLATE
const addenda = propertyContractAddenda({}, true)
// 줄마다 서로 다른 번역을 넣는다. 같은 문자열이 여러 줄에 서면 '순서대로 전부 있다'를 못 가른다.
// 번호는 자릿수를 맞춘다 — '번역줄5' 는 '번역줄50' 안에 들어 있어, 5번 줄이 빠져도 50번 줄이
// 그 자리를 대신 맞춰 준다(그러면 빠짐을 '순서 어김'으로 잘못 부르거나 아예 놓친다).
// 청소비 갈래까지 전부 채운다 — 축 7 의 '다 찼을 때' 진행 문장을 세우려면 한 칸도 비면 안 된다.
const lines = translationSourceLines(template, addenda, true, 'property')
const fullDict = {}
lines.forEach((l, i) => { fullDict[l.text] = `번역줄${String(i).padStart(4, '0')}` })

// 종이가 찍을 '항목' 수 — 변수 줄을 뺀 수다. 변수 인자를 안 넘기면 제목·절 제목·항목·서약문만
// 나오고, 그것이 곧 검수자가 종이에서 셀 수 있는 덩어리다(축 7 이 이 수로 대조한다).
const itemCount = translationSourceLines(template, addenda).length

/** 그 언어의 종이 한 벌(본문 HTML + 꼬리말 템플릿). 글꼴 바이트는 더미다 — 글자만 본다. */
function paper(lang, dict) {
  const resolved = resolveContractTranslation(
    { enabled: true, langs: { [lang]: { published: true, dict } } },
    template, lang, addenda, true)
  if (!resolved) return null
  const script = TRANSLATION_SCRIPT_FONT[lang] ? 'ZHVtbXk=' : null
  return {
    resolved,
    html: buildContractTranslationPrintHtml(resolved, {
      source: template, sourceAddenda: addenda,
      pretendardBase64: 'ZHVtbXk=', scriptFontBase64: script, today: '2026-01-01',
    }),
    footer: buildTranslationPrintFooterTemplate(lang, 'ZHVtbXk=', script),
  }
}

const jaPaper = paper('ja', fullDict)
if (!jaPaper) {
  violations.push('더미 해석이 null 이다 — 그물이 축 5·6·7 을 판정할 수 없다. 해석 정본이 바뀌었으면 여기부터 고친다')
}

// ── 축 5. 종이가 자기가 무엇인지 말한다 ────────────────────────────────────
// **언어별 표를 조회해 그 언어의 문안으로 대조한다.** 한 언어의 문자열을 그물에 손으로 박아 두면
// 머리가 그 언어로 바뀌는 날 그물만 어긋나고, 반대로 그물을 지우면 그 축을 통째로 잃는다.
// 한국어 두 조각도 같은 루프가 본다 — 한국어가 지워지면 운영자가 자기 종이를 못 알아본다.
//
// **문안 표(`TRANSLATION_PRINT_*`)를 보지 조립 함수를 보지 마라.** 조립 함수를 불러 기대값을
// 만들면 그 함수가 그 언어를 빠뜨리도록 망가져도 양쪽이 함께 움직여 그물이 통과한다(역주입
// 2026-09-17 에서 실제로 놓쳤다). 그물의 기대값은 종이와 **다른 자리**에서 와야 한다.
for (const lang of TRANSLATION_LANGS) {
  const p = paper(lang, {})
  if (!p) { violations.push(`${lang} 더미 해석이 null 이다 — 축 5·7 이 그 언어를 판정 못 한다`); continue }
  for (const [where, doc, want] of [
    ['종이 본문', p.html, TRANSLATION_PRINT_HEAD[lang]],
    ['꼬리말 템플릿', p.footer, TRANSLATION_PRINT_FOOTER[lang]],
  ]) {
    for (const phrase of ['참고용', '계약서 아님', want]) {
      if (!doc.includes(phrase)) {
        violations.push(`${where}(${lang})에 '${phrase}' 가 없다 — 검수자가 받아 읽는 종이라 어느 장을`
          + ' 펴도 계약서가 아니라는 것이 읽혀야 한다. 머리에만 있으면 2장째부터 표식이 없고,'
          + ' 한국어에만 있으면 그 표식을 정작 검수자가 못 읽는다')
      }
    }
  }
}

// ── 축 6. 해석 결과가 순서대로 전부 선다 ───────────────────────────────────
// 절 번호는 종이와 같은 정본이 매긴다(appendSubLeaseAddendum). 기대값을 손으로 세면 형제 절이
// 하나 늘 때 그물만 어긋난다.
if (jaPaper) {
  const { resolved, html } = jaPaper
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

// ── woff2 cmap 읽기 — 축 7 이 쓰는 재료 ────────────────────────────────────
//
// **왜 직접 읽나.** 글꼴에 그 글자가 있는지는 파일만이 안다. 실측을 주석에 적어 두는 방식은
// 글꼴을 갈아 끼우는 날 조용히 거짓이 된다. fontTools(python)로 같은 다섯 벌을 열어 대조해
// 코드포인트 집합이 글자 하나까지 같은 것을 확인했다(2026-09-17) — 그래서 외부 도구에 기대지
// 않고 여기서 읽는다. verify 가 파이썬 유무에 걸리면 그물이 환경 따라 꺼진다.
//
// woff2 는 표 디렉터리 뒤에 모든 표를 이어 붙여 brotli 로 한 덩어리 압축한 것이다. 변형이
// 걸리는 표는 glyf·loca 뿐이고 cmap 은 원본 그대로라, 앞선 표들의 저장 길이만 더하면 자리가 나온다.
const WOFF2_KNOWN_TAGS = [
  'cmap', 'head', 'hhea', 'hmtx', 'maxp', 'name', 'OS/2', 'post', 'cvt ', 'fpgm', 'glyf', 'loca',
  'prep', 'CFF ', 'VORG', 'EBDT', 'EBLC', 'gasp', 'hdmx', 'kern', 'LTSH', 'PCLT', 'VDMX', 'vhea',
  'vmtx', 'BASE', 'GDEF', 'GPOS', 'GSUB', 'EBSC', 'JSTF', 'MATH', 'CBDT', 'CBLC', 'COLR', 'CPAL',
  'SVG ', 'sbix', 'acnt', 'avar', 'bdat', 'bloc', 'bsln', 'cvar', 'fdsc', 'feat', 'fmtx', 'fvar',
  'gvar', 'hsty', 'just', 'lcar', 'mort', 'morx', 'opbd', 'prop', 'trak', 'Zapf', 'Silf', 'Glat',
  'Gloc', 'Feat', 'Sill',
]

/** 그 woff2 의 cmap 표 바이트. */
function woff2CmapTable(buf) {
  if (buf.readUInt32BE(0) !== 0x774f4632) throw new Error('woff2 서명이 아니다')
  const numTables = buf.readUInt16BE(12)
  const totalCompressedSize = buf.readUInt32BE(20)
  let p = 48
  const u128 = () => {
    let v = 0
    for (let i = 0; i < 5; i++) {
      const b = buf[p++]
      v = ((v << 7) | (b & 0x7f)) >>> 0
      if (!(b & 0x80)) return v
    }
    throw new Error('UIntBase128 이 5바이트를 넘는다')
  }
  const dir = []
  for (let i = 0; i < numTables; i++) {
    const flags = buf[p++]
    const idx = flags & 0x3f
    let tag
    if (idx === 0x3f) { tag = buf.toString('latin1', p, p + 4); p += 4 } else { tag = WOFF2_KNOWN_TAGS[idx] }
    const version = (flags >> 6) & 0x03
    const origLength = u128()
    // 널 변형의 표식이 glyf·loca 만 다르다(그 둘은 3 이 널, 나머지는 0 이 널).
    const transformed = (tag === 'glyf' || tag === 'loca') ? version !== 3 : version !== 0
    dir.push({ tag, storedLength: transformed ? u128() : origLength })
  }
  const data = brotliDecompressSync(buf.subarray(p, p + totalCompressedSize))
  let at = 0
  for (const t of dir) {
    if (t.tag === 'cmap') return data.subarray(at, at + t.storedLength)
    at += t.storedLength
  }
  throw new Error('cmap 표가 없다')
}

/** cmap 이 실제 글리프로 잇는 코드포인트 전부(형식 4·12). 글리프 0 은 두부라 안 센다. */
function cmapCodepoints(cmap) {
  const out = new Set()
  const numTables = cmap.readUInt16BE(2)
  for (let i = 0; i < numTables; i++) {
    const off = cmap.readUInt32BE(4 + i * 8 + 4)
    const format = cmap.readUInt16BE(off)
    if (format === 4) {
      const segX2 = cmap.readUInt16BE(off + 6)
      const endAt = off + 14
      const startAt = endAt + segX2 + 2
      const deltaAt = startAt + segX2
      const roAt = deltaAt + segX2
      for (let s = 0; s < segX2 / 2; s++) {
        const end = cmap.readUInt16BE(endAt + s * 2)
        const start = cmap.readUInt16BE(startAt + s * 2)
        const delta = cmap.readInt16BE(deltaAt + s * 2)
        const ro = cmap.readUInt16BE(roAt + s * 2)
        if (start === 0xffff) continue
        for (let c = start; c <= end && c !== 0xffff; c++) {
          let g
          if (ro === 0) g = (c + delta) & 0xffff
          else {
            const gi = roAt + s * 2 + ro + (c - start) * 2
            if (gi + 1 >= cmap.length) continue
            g = cmap.readUInt16BE(gi)
            if (g !== 0) g = (g + delta) & 0xffff
          }
          if (g !== 0) out.add(c)
        }
      }
    } else if (format === 12) {
      const nGroups = cmap.readUInt32BE(off + 12)
      for (let g = 0; g < nGroups; g++) {
        const at = off + 16 + g * 12
        const start = cmap.readUInt32BE(at)
        const end = cmap.readUInt32BE(at + 4)
        const startGid = cmap.readUInt32BE(at + 8)
        for (let c = start; c <= end; c++) if (startGid + (c - start) !== 0) out.add(c)
      }
    }
  }
  return out
}

const cmapCache = new Map()
function fontCodepoints(path) {
  const hit = cmapCache.get(path)
  if (hit) return hit
  const set = cmapCodepoints(woff2CmapTable(readFileSync(path)))
  cmapCache.set(path, set)
  return set
}

/** 종이에 실제로 그려지는 글자만. 스타일·제목·태그·엔티티를 걷는다(글꼴 바이트도 함께 걷힌다). */
function visibleText(doc) {
  return doc
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<title[\s\S]*?<\/title>/gi, '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
}

// ── 축 7. 검수 지시가 검수자의 언어로 서고 그 글자가 실제로 그려진다 ────────
{
  let pretendard = null
  try { pretendard = fontCodepoints('public/fonts/PretendardVariable.woff2') } catch (e) {
    violations.push(`Pretendard 의 cmap 을 읽지 못했다(${e.message}) — 축 7 의 두부 대조가 판정 불가다`)
  }

  for (const lang of TRANSLATION_LANGS) {
    // (1) 과 (2-b) 는 **표식과 그 인용**이라 두 자리에 같은 낱말이 있다. 한쪽만 고치면 종이가
    //     자기 표식을 못 가리키는데, 그 어긋남은 종이 위에서 아무 소리도 안 낸다.
    if (!TRANSLATION_PRINT_PROGRESS_MARKED[lang].includes(TRANSLATION_PRINT_MARK[lang])) {
      violations.push(`${lang} 의 진행 둘째 문장이 표식 '${TRANSLATION_PRINT_MARK[lang]}' 를 인용하지 않는다`
        + ' — 표식과 인용은 짝으로 고쳐야 한다. 갈리면 종이가 자기 표식을 못 가리키고,'
        + ' 검수자는 있지도 않은 표식을 찾다가 "표식이 없다"고 답한다')
    }

    // 원문이 남은 종이(표식·진행 두 문장)와 다 찬 종이('전부 번역됨' 문장)를 둘 다 본다.
    const left = paper(lang, {})
    const full = paper(lang, fullDict)
    if (!left || !full) continue   // 위 축 5 가 이미 null 을 말했다

    // 세는 수도 그물이 **따로 센다.** 종이가 찍는 수는 사전 열쇠 수(변수 줄 포함)가 아니라
    // 검수자가 종이에서 셀 수 있는 덩어리 수라야 한다 — 변수 줄은 조항 안에 치환돼 들어가므로
    // 독립된 줄로 안 선다. 종이가 열쇠 수로 되돌아가면 이 자리에서 숫자가 안 맞아 걸린다.
    const fill = (s, n) => s.replace(/\{총\}/g, String(itemCount)).replace(/\{남은\}/g, String(n))
    for (const [what, doc, text] of [
      // 표식은 **표식 자리에** 있어야 한다. 낱말만 찾으면 바로 아래 인용 문장이 그 낱말을 품고
      // 있어(「未翻訳」の印が…) 표식이 한국어로 되돌아가도 그물이 통과한다(역주입에서 놓쳤다).
      ['회색 표식', left.html, `<span class="src-mark">${TRANSLATION_PRINT_MARK[lang]}</span>`],
      ['진행(남음)', left.html, fill(TRANSLATION_PRINT_PROGRESS_LEFT[lang], left.resolved.fallbackCount)],
      ['진행(표식 인용)', left.html, TRANSLATION_PRINT_PROGRESS_MARKED[lang]],
      ['진행(다 찼을 때)', full.html, fill(TRANSLATION_PRINT_PROGRESS_ALL[lang], 0)],
      // 안내문은 `{{ }}` 를 **글자 그대로** 품는다. renderContractText 를 태우면 그 자리가
      // `{{}}` 로 쪼그라들어 여기서 걸린다 — "고장이 아니다"라고 말하는 문장이 고장 나는 자리다.
      ['검수 안내', left.html, TRANSLATION_PRINT_VAR_GUIDE[lang]],
    ]) {
      if (text && !doc.includes(text)) {
        violations.push(`${lang} 종이에 ${what} 문안이 없다 — 검수 지시를 검수자가 못 읽으면`
          + ' 그 검수는 지시를 못 읽은 채 나온 답이고, 운영자는 그 언어를 못 읽어 검증할 방법이 없다')
      }
    }

    // 본문 밖 어느 규칙도 font-family 를 못박지 않는다. @font-face 선언은 글꼴 이름을 짓는
    // 자리라 제외한다. 못박으면 그 자리만 두부가 되는데, 아래 cmap 대조는 합집합을 보므로 못 잡는다.
    const style = (left.html.match(/<style>([\s\S]*?)<\/style>/) ?? [])[1] ?? ''
    const rules = style.replace(/@font-face\s*\{[^}]*\}/g, '')
    const first = TRANSLATION_SCRIPT_FONT[lang] ? 'TranslationScript' : 'Pretendard'
    for (const m of rules.matchAll(/font-family:\s*([^;}]+)/g)) {
      if (!m[1].includes(first)) {
        violations.push(`${lang} 종이의 CSS 에 '${m[1].trim()}' 로 글꼴을 못박은 규칙이 있다`
          + ` — 그 언어 글꼴('${first}')을 앞에 두지 않으면 그 자리 글자가 통째로 두부(□)가 된다.`
          + ' Pretendard 에는 한자 0자·벵골 0자이고 fontconfig 에 CJK 가 없어 폴백도 없다.'
          + ' 운영자는 두부와 정상 글자를 구별하지 못해 그 종이를 그대로 검수자에게 보낸다')
      }
    }

    // 종이에 오른 글자가 전부 그려지는가. 두부를 **구조로** 막는 유일한 축이다.
    if (!pretendard) continue
    const file = TRANSLATION_SCRIPT_FONT[lang]
    let script = null
    if (file) {
      try { script = fontCodepoints(`public/fonts-i18n/${file}`) } catch (e) {
        violations.push(`${lang} 의 글꼴 ${file} 에서 cmap 을 읽지 못했다(${e.message}) — 두부 대조가 판정 불가다`)
        continue
      }
    }
    const missing = new Map()
    for (const doc of [left.html, full.html, left.footer]) {
      for (const ch of visibleText(doc)) {
        const c = ch.codePointAt(0)
        if (c <= 0x20) continue
        if (pretendard.has(c) || script?.has(c)) continue
        missing.set(ch, `U+${c.toString(16).toUpperCase().padStart(4, '0')}`)
      }
    }
    if (missing.size) {
      const shown = [...missing].slice(0, 8).map(([ch, u]) => `${ch}(${u})`).join(' ')
      violations.push(`${lang} 종이에 글꼴이 못 그리는 글자가 ${missing.size}자 있다: ${shown}`
        + ' — 그 자리는 네모(□)로 찍힌다. 운영자는 두부와 정상 글자를 구별하지 못하므로 그대로'
        + ' 검수자에게 보내고, 검수자는 번역이 틀렸다고 답한다. 그 답은 거짓이다')
    }
  }
}

// ── 축 8. 화면이 종이와 같은 사전을 쓴다 ───────────────────────────────────
//
// **그려서 본다.** 소스에서 `TRANSLATION_PRINT_MARK` 라는 글자를 찾는 그물은 `import` 만 남기고
// 호출을 지운 화면을 통과시킨다(그 손질이 실제 역주입에서 통과했다). 컴포넌트를 실제로 렌더해
// 결과 HTML 을 보면 그 손질은 표식이 사라지거나 다른 글자가 서는 것으로 드러난다.
//
// 기대값은 종이와 **같은 표**에서 온다(TRANSLATION_PRINT_MARK · TRANSLATION_PRINT_HEAD). 화면이
// 제 문안을 따로 들면 다음에 한쪽만 고쳐지고, 그때 미리보기는 확인이 아니라 착각이 된다.
{
  const SCREEN = 'components/doc/ContractTranslationView.tsx'
  const SETTINGS = 'app/(app)/settings/SettingsForm.tsx'

  // 사전을 통째로 비운 해석 — 모든 줄이 한국어로 떨어져 표식이 전부 선다.
  for (const lang of TRANSLATION_LANGS) {
    const resolved = resolveContractTranslation(
      { enabled: true, langs: { [lang]: { published: true, dict: {} } } },
      template, lang, addenda, true)
    if (!resolved) continue   // 축 5 가 이미 null 을 말했다
    if (resolved.fallbackCount === 0) {
      violations.push(`${lang} 화면 더미에 원문으로 남은 줄이 없다 — 표식이 설 자리가 없어 축 8 이 아무것도 안 본다`)
      continue
    }
    const props = { translation: resolved, source: template, sourceAddenda: addenda }
    // 두 자리를 다 그린다. 같은 본문이 **설정 미리보기**(운영자)와 **서명 화면 접힘 카드**
    // (입주자)에 함께 서므로, 한쪽만 보면 카드 껍데기가 본문을 가리는 손질을 놓친다.
    for (const [where, el] of [
      ['미리보기·발급 상세 본문', createElement(ContractTranslationBody, props)],
      ['서명 화면 접힘 카드', createElement(ContractTranslationCard, props)],
    ]) {
      let html
      try { html = renderToStaticMarkup(el) } catch (e) {
        violations.push(`${lang} ${where} 를 그리지 못했다(${e.message}) — 축 8 이 판정 불가다`)
        continue
      }
      for (const [what, want] of [
        // 표식은 **표식 자리에** 서야 한다. 낱말만 찾으면 옆 문장이 그 낱말을 품은 날 통과한다.
        ['회색 표식', `>${TRANSLATION_PRINT_MARK[lang]}</span>`],
        ['참고용 배지', `>${TRANSLATION_PRINT_HEAD[lang]}</span>`],
      ]) {
        if (!html.includes(want)) {
          violations.push(`${lang} ${where} 에 ${what} 문안이 없다 — 종이는 그 언어로 갔는데 화면이 안 갔다.`
            + ' 원격 서명 화면은 외국인 입주자가 직접 보는 자리라, 못 읽는 표식은 "이 줄만 번역이'
            + ' 없다"는 말을 전하지 못하고, 운영자 미리보기는 종이와 다른 글자를 보여 확인이 아니라 착각이 된다')
        }
      }
    }
  }

  // 그림이 못 보는 자리 — **리터럴의 부활**. 사전을 부르는 척하며 옆에 한국어·영어 문안을 세우면
  // 위 렌더 대조는 통과한다(사전 문안도 함께 서 있으므로). 주석과 import 는 걷고 본다.
  const screenSrc = strip(readFileSync(SCREEN, 'utf8')).replace(/^\s*import\s[\s\S]*?from\s[^\n]*$/gm, '')
  for (const [bad, why] of [
    ['원문', '한국어 표식이 되살아났다 — 자기 언어로 계약서를 읽는 사람에게 유일하게 못 읽는 글자가 된다'],
    ['Reference only', '영어 배지가 되살아났다 — 베트남어·벵골어로 읽는 사람에게 이 카드가 무엇인지 말하지 못한다'],
  ]) {
    if (screenSrc.includes(bad)) {
      violations.push(`${SCREEN} 에 '${bad}' 리터럴이 있다 — ${why}.`
        + ' 문안은 종이와 같은 표에서만 온다(TRANSLATION_PRINT_MARK · TRANSLATION_PRINT_HEAD)')
    }
  }

  // 미리보기의 진행 줄은 표식 낱말을 **사전에서 인용한다**(종이의 progressKo 와 같은 규칙).
  // 여기에 '원문'을 글자로 박으면 화면 표식은 그 언어인데 이 줄만 있지도 않은 낱말을 가리켜,
  // 운영자는 '원문'을 찾다가 "표식이 없다"고 답한다. 그 답은 거짓이다.
  const settingsSrc = strip(readFileSync(SETTINGS, 'utf8'))
  const at = settingsSrc.indexOf('preview.fallbackCount > 0')
  if (at < 0) {
    violations.push(`${SETTINGS} 에서 미리보기 진행 줄을 못 찾았다 — 구조가 바뀌었으면 이 그물부터 고친다.`
      + ' 운영자가 그 언어 표식을 못 짚어도 개수를 알 수 있는 유일한 줄이다')
  } else {
    const block = settingsSrc.slice(at, at + 600)
    if (!/TRANSLATION_PRINT_MARK\[lang\]/.test(block)) {
      violations.push(`${SETTINGS} 의 미리보기 진행 줄이 표식을 사전에서 인용하지 않는다`
        + ' — 표식과 인용은 짝으로 움직여야 한다. 갈리면 그 줄이 있지도 않은 낱말을 가리키고,'
        + ' 운영자는 한자·벵골 표식을 못 짚는 대신 이 줄에 기대므로 신호를 통째로 잃는다')
    }
    if (/회색\s*원문/.test(block)) {
      violations.push(`${SETTINGS} 의 미리보기 진행 줄에 '회색 원문' 이 글자로 박혀 있다`
        + ' — 화면 표식은 그 언어 단독이라 그 낱말은 화면 어디에도 없다')
    }
  }
}

if (violations.length) {
  console.error(`\n[번역본 검수 종이] 위반 ${violations.length}건`)
  for (const v of violations) console.error('  - ' + v)
  console.error('\n  이 종이는 저장되지 않는 검수용이고, 운영자는 여기 실린 글자를 스스로 읽지 못한다(2026-09-17 오더).')
  process.exit(1)
}
console.log(`[번역본 검수 종이] 저장 0건 · 참고용 표식 머리와 꼬리말 · 해석 결과 순서대로 전부`
  + ` · 검수 지시 ${TRANSLATION_LANGS.length}언어 문안과 글꼴 전량`
  + ` · 화면 두 자리 ${TRANSLATION_LANGS.length}언어 표식·배지 같은 사전 / 위반 0건`)
