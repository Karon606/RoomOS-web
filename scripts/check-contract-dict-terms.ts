// 영업장 사전(Property.contractTranslations)의 금지 낱말·자형 순도를 보는 그물 — 읽기 전용, 위반 시 exit 1 (2026-09-16).
//
// **왜 새로 세우나.** 번역 축의 그물 둘은 DB 를 못 본다. `verify:fast` 의 진리표
// (`scripts/test-contract-translation.ts` 13·14단계)는 **코드에 박힌 권장 문안**만 훑고,
// `verify:db` 의 31개 검사에는 사전 낱말 축이 아예 없었다. 그런데 영업장은 설정 > 계약서 >
// 번역 화면에서 사전을 **직접 고칠 수 있다.** 2026-09-16 에 `退房`·`退住` 34줄을 옮겨 놓아도,
// 운영자가 내일 그 칸에 `退房` 을 다시 적으면 아무 데서도 안 운다 — 종이에는 나가는데.
//
// **두 축을 함께 본다.**
//   ⓐ 금지 낱말 — 임대차·숙박업 프레임(13단계 축)과 그 언어의 실무어가 아닌 퇴실 낱말(14단계 축).
//   ⓑ 자형 순도 — zh 칸에 번체 전용 글자, zht 칸에 간체 전용 글자. 낱말만 보면 **우회가 남는다.**
//      zht 칸에 간체 본문을 통째로 붙이고 `遷出` 한 글자만 번체로 두면 ⓐ 는 전부 초록인데
//      대만 입주자가 받는 종이는 간체로 나간다. 낱말 축과 자형 축은 다르다.
//
// **고아는 위반이 아니다.** 원문에서 사라진 열쇠에 딸린 번역은 종이에 안 나간다(해석이
// `translationSourceLines` 집합만 본다). 그래도 세는 이유는 조항을 되돌리면 그 줄이 되살아나기
// 때문이다 — 살아있는 줄과 **갈라서 보고**하고, exit 코드는 살아있는 줄만 정한다.
//
// **금지 낱말 표가 진리표와 쌍둥이다.** 입력이 달라서 한 상수로 못 묶었다 — 진리표는 코드에 박힌
// 7언어 권장 문안을, 여기는 운영자가 친 사전을 본다. 한쪽에 낱말을 더하면 **다른 쪽도 같이
// 고쳐야 한다**(`scripts/test-contract-translation.ts` 의 `FORBIDDEN` 과 14단계 정규식).
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import {
  parseContractTranslations, translationSourceLines, TRANSLATION_LANGS,
  type TranslationLang,
} from '../lib/contractTranslation'
import { DEFAULT_CONTRACT_TEMPLATE, propertyContractAddenda, type ContractTemplate } from '../lib/contract'
import { parseShortStayPolicy } from '../lib/shortStay'

/**
 * 언어별 금지 낱말. 어간·부분 문자열로 잡는다(굴절·합성어를 함께 문다).
 *
 * 축 둘이 한 표에 섞여 있다 — `why` 가 그것을 가른다. '임대차'·'숙박업' 은 법 프레임(13단계
 * 축)이고 '기숙사'·'호텔'·'호적'·'옛 낱말' 은 그 언어의 실무어가 아니라는 축(14단계)이다.
 * 사전 한 칸을 훑는 데 두 번 돌 이유가 없어 한 표로 뒀고, 보고 줄이 `why` 를 그대로 찍는다.
 *
 * vi 는 없다 — 본문이 사람을 `người thuê`(임차인)라 부르고 있어 화면만 막으면 문서 안에서
 * 어긋난다. 진리표 13단계가 vi 를 뺀 것과 같은 이유이고, 원어민 확인 뒤로 미뤘다.
 */
const FORBIDDEN: Partial<Record<TranslationLang, { word: string; why: string }[]>> = {
  ru: [{ word: 'аренд', why: '임대차' }, { word: 'наём', why: '임대차' }, { word: 'найм', why: '임대차' }],
  bn: [{ word: 'ভাড়াটিয়া', why: '세입자' }, { word: 'বাড়িভাড়া', why: '집세' }],
  en: [{ word: 'Tenant', why: '임차인' }, { word: 'tenant', why: '임차인' }, { word: 'landlord', why: '임대인' }],
  ja: [
    { word: '入室', why: '옛 낱말' }, { word: '退室', why: '옛 낱말' },
    { word: '賃料', why: '임대차' }, { word: '家賃', why: '임대차' }, { word: '宿泊料', why: '숙박업' },
  ],
  zh: [
    { word: '租金', why: '임대차' }, { word: '房租', why: '임대차' }, { word: '住宿费', why: '숙박업' },
    { word: '退住', why: '옛 낱말' }, { word: '退房', why: '호텔' }, { word: '退租', why: '임대차' },
    { word: '退宿', why: '기숙사' }, { word: '迁出', why: '호적' },
  ],
  zht: [
    { word: '租金', why: '임대차' }, { word: '房租', why: '임대차' }, { word: '住宿費', why: '숙박업' },
    { word: '退住', why: '옛 낱말' }, { word: '退房', why: '호텔' }, { word: '退租', why: '임대차' },
    { word: '退宿', why: '기숙사' }, { word: '迁出', why: '호적' },
  ],
}

/**
 * 자형 전용 글자 짝 — 같은 순서로 1:1 이다(费/費 · 洁/潔 …).
 *
 * 이 계약서 문안이 실제로 쓰는 글자에서 뽑았다. 한자 전량 대조표가 아니라 **이 종이에 서는
 * 글자**의 표이고, 그래서 침묵한다고 자형이 순수하다는 뜻은 아니다.
 */
const SIMP_ONLY = '费洁对价结离时与无内后务为'
const TRAD_ONLY = '費潔對價結離時與無內後務為'

/** 열쇠(한국어 원문)를 보고 줄에 넣을 만큼만 자른다. 사전 열쇠가 문장 전체라 길다. */
const head = (s: string, n = 24): string => (s.length > n ? `${s.slice(0, n)}…` : s)

async function main() {
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) })
  const properties = await prisma.property.findMany({
    select: {
      id: true, name: true,
      contractTemplate: true, contractTranslations: true,
      subLeaseAddendum: true, roomScheduleAddendum: true,
      shortStayPolicy: true, shortStayAddendum: true, earlyCheckoutAddendum: true,
      refundClauseInContract: true,
    },
  })

  const violations: string[] = []
  const orphanNotes: string[] = []
  let liveRows = 0
  let orphanRows = 0

  for (const p of properties) {
    const parsed = parseContractTranslations(p.contractTranslations)
    // 살아있는 열쇠 집합은 편집기와 **같은 입력**으로 센다(app/(app)/settings/actions 의
    // getContractTranslationSettings + SettingsForm 의 'property' 범위). 여기서 규칙을 베끼면
    // 이 그물만 특약 줄을 빠뜨려 멀쩡한 번역이 고아로 잡힌다.
    const template = (p.contractTemplate as ContractTemplate | null) ?? DEFAULT_CONTRACT_TEMPLATE
    const addenda = propertyContractAddenda(p, parseShortStayPolicy(p.shortStayPolicy).enabled)
    const live = new Set(
      translationSourceLines(template, addenda, p.refundClauseInContract ?? true, 'property').map(l => l.text),
    )

    for (const lang of TRANSLATION_LANGS) {
      const dict = parsed.langs[lang]?.dict
      if (!dict) continue
      const words = FORBIDDEN[lang] ?? []
      const badGlyphs = lang === 'zht' ? SIMP_ONLY : lang === 'zh' ? TRAD_ONLY : ''

      for (const [key, text] of Object.entries(dict)) {
        const alive = live.has(key)
        if (alive) liveRows++
        else orphanRows++

        const found: string[] = []
        for (const w of words) if (text.includes(w.word)) found.push(`'${w.word}'(${w.why})`)
        for (const ch of badGlyphs) {
          if (!text.includes(ch)) continue
          found.push(`'${ch}'(${lang === 'zht' ? '간체 전용' : '번체 전용'} 자형)`)
        }
        if (found.length === 0) continue

        const line = `${p.name} · ${lang} · 「${head(key)}」 — ${found.join(' · ')}`
        if (alive) violations.push(line)
        else orphanNotes.push(line)
      }
    }
  }

  console.log(`[실측] 영업장 ${properties.length}곳 · 사전 줄 살아있는 ${liveRows} · 고아 ${orphanRows}`)
  console.log(`[실측] 금지 낱말 ${Object.values(FORBIDDEN).reduce((n, w) => n + (w?.length ?? 0), 0)}개 ` +
    `· 자형 표 ${SIMP_ONLY.length}짝 · 위반(살아있는 줄) ${violations.length} · 고아 줄 ${orphanNotes.length}`)

  if (orphanNotes.length > 0) {
    // 고아는 종이에 안 나가므로 참고다. 조항을 되돌리면 그 줄이 그대로 되살아나니 알려만 둔다.
    console.log(`\n참고 — 고아 줄에 걸린 낱말 ${orphanNotes.length}건(종이에 안 나간다):`)
    for (const n of orphanNotes) console.log(`  - ${n}`)
  }

  if (violations.length > 0) {
    console.error(`\n계약서 사전에 금지 낱말·섞인 자형이 있다 ${violations.length}건:`)
    for (const v of violations) console.error(`  - ${v}`)
    console.error('\n설정 > 계약서 > 번역에서 그 줄을 고쳐라. 용어 근거는 knowledge/glossary.md.')
    await prisma.$disconnect()
    process.exit(1)
  }

  console.log('\n계약서 사전 낱말 축 이상 없음')
  await prisma.$disconnect()
}

main().catch(e => { console.error(e); process.exit(1) })
