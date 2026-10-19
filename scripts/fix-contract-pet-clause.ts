// 영업장 계약서 저장본 3절(생활 수칙) 맨 끝에 반려동물 금지 항목과 그 7개 언어 번역을 붙이는 일회성 정정. 예행 기본, --apply 적용, --revert <undo.json> 되돌림.
//
// 왜 (신고 f4dba72c "계약서에 반려동물은 안된다는 내용이 필요할 것 같아", 계약서·법무 패널·운영자
// 2026-10-19 '추천대로'). 지금 종이(영업장 저장본)에는 3절 4항 '위해 동물' 반입 금지뿐이라 개·고양이를
// 기르는 것을 막을 근거가 없다. 승인 문안은 전면 금지 + 장애인 보조견 예외 + 기한 준 반출 요청 +
// 불응 시 강제 퇴실 조항 + 실비 부담이다. 즉시 해지·정액 위약금·동물 처분은 넣지 않았다(약관규제법 8조·9조).
// 소급은 없다. 새로 서명하는 계약부터다.
//
// 무엇을 하나. 대상 영업장 한 곳(--property <id>)의 두 칸만 쓴다.
//   · Property.contractTemplate: 3절 items **맨 끝에 한 줄을 더한다.** 손 번호는 종이 순번이다.
//   · Property.contractTranslations: 그 줄을 열쇠로 7개 언어 초안을 넣는다. 영업장이 만든 언어에만
//     넣고, 그 열쇠에 이미 번역이 있으면 덮지 않는다(사람이 고친 번역이 초안보다 낫다).
// 무엇을 안 하나.
//   · 기존 줄은 한 글자도 안 바꾼다. 번역 사전의 열쇠가 한국어 줄 자체라 한 글자만 고쳐도 그 줄 번역이
//     7개 언어에서 고아가 된다(knowledge/domain-contracts.md '번역은 고아가 된다'). 끝에 붙이면 고아 0.
//   · 박제(LeaseTerm.signedContractSnapshot · ContractShareLink.templateSnapshot ·
//     ContractFile.issuedSnapshot)는 손대지 않는다. 그때 서명한 종이다.
//   · 입실자별 본문 사본(contractOverride)은 안 고친다. 그 계약만 따로 정한 본문이라 새 조항을 얹는
//     것은 운영자 판단이다. 건수만 알린다.
//   · 다른 영업장은 안 고친다. 새 영업장의 출발점인 코드 기본 양식(lib/contract 의
//     DEFAULT_CONTRACT_TEMPLATE)에는 같은 문장이 이미 있다.
//
// 열린 링크. 미서명 열린 링크는 옛 본문 스냅샷으로 서명받는다(설정 저장도 이 정정도 링크를 닫지
// 않는다). 그래서 --apply 직전에 그 영업장의 링크를 다시 세어 1건이라도 있으면 쓰지 않고 멈춘다.
// 닫거나 서명받은 뒤 다시 돌린다(체크리스트 D).
//
// 되돌리기 파일(scripts/.fix-contract-pet-clause-undo-<ts>.json)은 영업장 계약 문안 전문이라 커밋하지
// 않는다(.gitignore 의 scripts/.fix-*-undo-*.json).
//
// 실행 방법.
//   예행    npx tsx --env-file=.env.local scripts/fix-contract-pet-clause.ts --property <영업장 id>
//   적용    npx tsx --env-file=.env.local scripts/fix-contract-pet-clause.ts --property <영업장 id> --apply
//   되돌림  npx tsx --env-file=.env.local scripts/fix-contract-pet-clause.ts --revert scripts/.fix-contract-pet-clause-undo-<ts>.json
import fs from 'node:fs'
import { createHash } from 'node:crypto'
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import {
  translationSourceLines, translationStaleAfterEdit, orphanTranslationKeys, missingTranslationPlaceholders,
  TRANSLATION_LANGS, type TranslationLang,
} from '../lib/contractTranslation'
import { propertyContractAddenda, stripClauseBullet, type ContractTemplate } from '../lib/contract'
import { parseShortStayPolicy } from '../lib/shortStay'

const APPLY = process.argv.includes('--apply')
const REVERT_IDX = process.argv.indexOf('--revert')
const PROPERTY_IDX = process.argv.indexOf('--property')

// ── 확정 문안 (계약서·법무 패널·운영자 2026-10-19, 글자 그대로) ─────────────────
// 코드 기본 양식(lib/contract)과 그물(scripts/check-contract-unfair-clause.ts 의 PET_CLAUSE)이 같은 문장이다.
const SENTENCE = '개·고양이 등 반려동물은 호실과 공용 공간에 데려오거나 기를 수 없으며, 잠시 맡아 두는 경우도 같습니다. 다만 「장애인복지법」에 따른 장애인 보조견은 예외로 합니다. 이를 어기면 관리자가 정한 기한까지 동물을 내보내야 하며, 따르지 않으면 강제 퇴실 조항에 따라 퇴실 조치될 수 있습니다. 동물로 생긴 오염·악취·시설 손상의 원상 복구와 소독·특수 청소에 실제로 든 비용은 입실자가 부담합니다.'
// 같은 취지의 항목이 이미 있으면(운영자가 설정 화면에서 따로 적었다) 자동으로 더하지 않고 사람이 본다.
const VARIANT_MARKS = ['반려동물', '애완동물', '반려견', '애완견', '보조견']

// ── 번역 초안 (참고용 번역본, 2026-10-19) ─────────────────────────────────────
// 용어는 같은 영업장 사전의 기존 번역을 따른다. 호실 ja 部屋 · zh 房间 · zht 房間 · vi phòng ·
// ru комната · bn কক্ষ, 입실자 ja 入居者 · zh 入住人 · zht 入住者 · vi người sử dụng phòng ·
// ru проживающий · en the Occupant · bn বাসিন্দা, 관리자 ja 管理者 · zh/zht 管理人员/管理人員 ·
// vi người quản lý · ru управляющий · en the manager · bn ব্যবস্থাপক, 강제 퇴실 ja 強制退去 ·
// zh 强制搬离 · zht 強制遷出 · vi buộc trả phòng · ru принудительное выселение · en Forced Move-out ·
// bn বাধ্যতামূলক কক্ষ ত্যাগ. 법 이름 인용부호는 그 언어 사전의 관례(ja·zht 「」, zh 《》, ru «», en·vi·bn '').
// 번역본은 서명 대상이 아니고 종이에 참고용 고지가 붙는다(lib/contractTranslation TRANSLATION_NOTICE).
// 원어민 검수는 설정 > 계약서 > 참고용 번역본의 검수 PDF 로 한다.
const DRAFTS: Record<TranslationLang, string> = {
  en: "Pets such as dogs and cats may not be brought into or kept in the rooms or shared spaces, and the same applies to looking after an animal temporarily. However, assistance dogs for persons with disabilities under Korea's 'Act on Welfare of Persons with Disabilities' are exempt. If this rule is breached, the Occupant must remove the animal by the deadline set by the manager, and if the Occupant does not comply, the Occupant may be required to move out under the Forced Move-out provisions. The Occupant bears the costs actually incurred in restoring contamination, odors, and damage to facilities caused by the animal and in disinfection and special cleaning.",
  ja: '犬・猫などのペットは、部屋および共用スペースに連れて入ることも飼うこともできず、一時的に預かる場合も同様です。ただし、韓国の「障害者福祉法」に基づく障害者補助犬は除きます。これに違反した場合は、管理者が定めた期限までに動物を施設の外に移さなければならず、従わない場合は強制退去の条項に基づき退去の措置をとることがあります。動物によって生じた汚れ・悪臭・施設の破損の原状回復ならびに消毒・特殊清掃に実際にかかった費用は、入居者が負担します。',
  zh: '狗、猫等宠物不得带入房间及公共区域，也不得在其中饲养，临时代为照看的情形亦同。但依据韩国《残疾人福利法》规定的残疾人辅助犬除外。如有违反，入住人须在管理人员规定的期限前将动物带离；不服从的，可依据强制搬离条款令其搬离。因动物造成的污染、恶臭、设施损坏的恢复原状费用，以及消毒、特殊清洁实际产生的费用，由入住人承担。',
  zht: '狗、貓等寵物不得帶入房間及公共區域，亦不得於其中飼養，臨時代為照顧者亦同。但依韓國「身心障礙者福利法」所定之身心障礙者輔助犬，不在此限。如有違反，入住者應於管理人員所定期限前將動物帶離；未遵從者，得依強制遷出條款予以遷出處置。因動物所生之污染、惡臭、設施毀損之回復原狀費用，以及消毒、特殊清潔實際支出之費用，由入住者負擔。',
  vi: "Không được mang thú cưng như chó, mèo vào phòng và khu vực chung, cũng không được nuôi ở đó; trường hợp trông giữ tạm thời cũng vậy. Tuy nhiên, chó hỗ trợ người khuyết tật theo 'Luật Phúc lợi người khuyết tật' của Hàn Quốc là ngoại lệ. Nếu vi phạm, người sử dụng phòng phải đưa động vật ra khỏi cơ sở trước thời hạn do người quản lý quy định; nếu không tuân theo, có thể bị buộc trả phòng theo điều khoản buộc trả phòng. Chi phí thực tế phát sinh để khôi phục nguyên trạng do ô nhiễm, mùi hôi, hư hỏng cơ sở vật chất mà động vật gây ra, cùng chi phí khử trùng và vệ sinh đặc biệt, do người sử dụng phòng chịu.",
  ru: 'Домашних животных, таких как собаки и кошки, запрещается приносить в комнаты и общие помещения и содержать там; это касается и временной передержки животных. Исключение составляют собаки-помощники для лиц с инвалидностью согласно корейскому «Закону о социальном обеспечении лиц с инвалидностью». При нарушении проживающий обязан убрать животное из заведения до срока, установленного управляющим, а если он этого не сделает, он может быть выселен в соответствии с положениями о принудительном выселении. Фактически понесённые расходы на устранение загрязнений, запаха и повреждений имущества, вызванных животным, а также на дезинфекцию и специальную уборку несёт проживающий.',
  bn: "কুকুর, বিড়াল ইত্যাদি পোষা প্রাণী কক্ষে ও যৌথ ব্যবহারের স্থানে আনা বা পালন করা যাবে না, এবং অল্প সময়ের জন্য কারও প্রাণী দেখাশোনা করার ক্ষেত্রেও একই নিয়ম প্রযোজ্য। তবে কোরিয়ার 'প্রতিবন্ধী ব্যক্তি কল্যাণ আইন' অনুযায়ী প্রতিবন্ধী ব্যক্তিদের সহায়তাকারী কুকুর এর ব্যতিক্রম। এই নিয়ম লঙ্ঘন করলে ব্যবস্থাপকের নির্ধারিত সময়সীমার মধ্যে প্রাণীটিকে প্রতিষ্ঠান থেকে সরিয়ে নিতে হবে, এবং তা না মানলে বাধ্যতামূলক কক্ষ ত্যাগের ধারা অনুযায়ী কক্ষ ত্যাগের ব্যবস্থা নেওয়া হতে পারে। প্রাণীর কারণে সৃষ্ট দূষণ, দুর্গন্ধ ও স্থাপনার ক্ষতি পূর্বাবস্থায় ফেরানো এবং জীবাণুমুক্তকরণ ও বিশেষ পরিচ্ছন্নতার জন্য প্রকৃতপক্ষে যে খরচ হবে, তা বাসিন্দা বহন করবেন।",
}

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) })

/** 키 순서와 무관한 직렬화. jsonb 는 키 순서를 자기 식으로 바꿔 돌려주므로 비교는 이것으로 한다. */
function stable(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`
  if (v && typeof v === 'object') {
    return `{${Object.keys(v as Record<string, unknown>).sort()
      .map(k => `${JSON.stringify(k)}:${stable((v as Record<string, unknown>)[k])}`).join(',')}}`
  }
  return JSON.stringify(v ?? null)
}
const digest = (rows: unknown[]): string => createHash('sha256').update(stable(rows)).digest('hex').slice(0, 16)

type Section = { id?: unknown; title?: unknown; items?: unknown }
type StoredTranslations = { enabled?: unknown; langs?: Record<string, { published?: unknown; dict?: Record<string, unknown> } | undefined> }

/** 3절을 찾는다. id 'rules' 가 정본이고, 없으면 제목으로. 둘 이상이거나 없으면 null. */
function findRulesIndex(t: ContractTemplate): number | null {
  const secs = (Array.isArray(t.sections) ? t.sections : []) as Section[]
  const byId = secs.map((s, i) => (s?.id === 'rules' ? i : -1)).filter(i => i >= 0)
  if (byId.length === 1) return byId[0]
  if (byId.length > 1) return null
  const byTitle = secs.map((s, i) => (typeof s?.title === 'string' && s.title.includes('생활 수칙') ? i : -1)).filter(i => i >= 0)
  return byTitle.length === 1 ? byTitle[0] : null
}

/**
 * 새 줄의 저장 모양. 같은 절의 꼴을 따른다. 손 번호(`\tN.\t`)면 종이 순번(항목 수 + 1), 점(`- `)이면 점.
 * 종이는 번호를 CSS counter 로 자리에서 매기고 본문 손 번호는 stripClauseBullet 이 걷으므로, 손 번호가
 * 없는 줄이 끼어 있어도 자리 순번이 종이 번호와 같다(2026-10-05 통보 지연 배상 정정과 같은 규칙).
 * 섞여 있거나 둘 다 아니면 null 이고 사람이 본다.
 */
function newItemFor(items: string[]): { item: string; why: string } | null {
  const numbered = items.filter(it => /^\t\d+\.\t/.test(it))
  const dashed = items.filter(it => /^- /.test(it))
  if (numbered.length > 0 && dashed.length === 0) {
    const lastHand = Math.max(...numbered.map(it => Number(/^\t(\d+)\./.exec(it)?.[1] ?? 0)))
    const n = items.length + 1
    if (n <= lastHand) return null
    return { item: `\t${n}.\t${SENTENCE}`, why: `손 번호 꼴, 항목 ${items.length}개 중 손 번호 마지막 ${lastHand}, 종이 순번으로 ${n}번` }
  }
  if (dashed.length === items.length && items.length > 0) {
    return { item: `- ${SENTENCE}`, why: `점 꼴, 항목 ${items.length}개 모두 '- ' 로 시작` }
  }
  return null
}

function printSection(title: string, items: string[]): void {
  console.log(`  [${title}]`)
  items.forEach((it, i) => {
    console.log(`    저장 ${String(i).padStart(2)}: ${JSON.stringify(it)}`)
    console.log(`    종이 ${String(i + 1).padStart(2)}. ${stripClauseBullet(it)}`)
  })
}

// ── 불가침 점검 ─────────────────────────────────────────────────────────────
// 적용 전후에 같은 값을 잰다. 이 정정이 건드려도 되는 것은 대상 영업장의 두 칸뿐이다.
type Guard = {
  signedSnapshots: string; signedSnapshotCount: number
  linkSnapshots: string; linkCount: number
  issuedSnapshots: string; issuedCount: number
  otherProperties: string
  overrides: string; overrideCount: number
  openUnsigned: number; openAny: number
}

async function measureGuard(propertyId: string): Promise<Guard> {
  const now = new Date()
  const leases = await prisma.leaseTerm.findMany({ orderBy: { id: 'asc' }, select: { id: true, signedContractSnapshot: true, contractOverride: true } })
  const signed = leases.filter(l => l.signedContractSnapshot != null)
  const overridden = leases.filter(l => l.contractOverride != null)
  const links = await prisma.contractShareLink.findMany({ orderBy: { id: 'asc' }, select: { id: true, templateSnapshot: true } })
  const files = await prisma.contractFile.findMany({ orderBy: { id: 'asc' }, select: { id: true, issuedSnapshot: true } })
  const props = await prisma.property.findMany({ orderBy: { id: 'asc' }, select: { id: true, contractTranslations: true, contractTemplate: true } })
  // 미서명 열린 링크는 closeStaleUnsignedLinks(app/contract/[tenantId]/actions.ts)와 같은 다섯 조건으로, 대상 영업장만 센다.
  const openUnsigned = await prisma.contractShareLink.count({
    where: { propertyId, signedAt: null, disposalSignedAt: null, submittedAt: null, closedAt: null, expiresAt: { gt: now } },
  })
  const openAny = await prisma.contractShareLink.count({ where: { propertyId, submittedAt: null, closedAt: null, expiresAt: { gt: now } } })
  return {
    signedSnapshots: digest(signed.map(l => [l.id, l.signedContractSnapshot])), signedSnapshotCount: signed.length,
    linkSnapshots: digest(links.map(l => [l.id, l.templateSnapshot])), linkCount: links.length,
    issuedSnapshots: digest(files.map(f => [f.id, f.issuedSnapshot])), issuedCount: files.length,
    otherProperties: digest(props.filter(p => p.id !== propertyId).map(p => [p.id, p.contractTemplate, p.contractTranslations])),
    overrides: digest(overridden.map(l => [l.id, l.contractOverride])), overrideCount: overridden.length,
    openUnsigned, openAny,
  }
}

function printGuard(g: Guard): void {
  console.log(`  서명 박제(LeaseTerm.signedContractSnapshot) ${g.signedSnapshotCount}건 · 지문 ${g.signedSnapshots}`)
  console.log(`  링크 스냅샷(ContractShareLink.templateSnapshot) ${g.linkCount}건 · 지문 ${g.linkSnapshots}`)
  console.log(`  발급본 박제(ContractFile.issuedSnapshot) ${g.issuedCount}건 · 지문 ${g.issuedSnapshots}`)
  console.log(`  입실자별 본문 사본(contractOverride) ${g.overrideCount}건 · 지문 ${g.overrides}`)
  console.log(`  다른 영업장 저장본·사전 지문 ${g.otherProperties}`)
  console.log(`  이 영업장 열린 링크: 미서명 ${g.openUnsigned}건 · 제출 전 전체 ${g.openAny}건`)
}

function compareGuard(before: Guard, after: Guard): string[] {
  const diffs: string[] = []
  for (const k of Object.keys(before) as (keyof Guard)[]) {
    if (before[k] !== after[k]) diffs.push(`${k}: ${before[k]} 에서 ${after[k]} 로`)
  }
  return diffs
}

// ── 번역 ────────────────────────────────────────────────────────────────────
type PropRow = {
  contractTranslations: unknown; refundClauseInContract: boolean | null; shortStayPolicy: unknown
  subLeaseAddendum: unknown; shortStayAddendum: unknown; earlyCheckoutAddendum: unknown; roomScheduleAddendum: unknown
}

/** 사전에 새 열쇠의 초안을 넣은 다음 모양과 언어별 처리 결과. 영업장이 만든 언어만 만진다. */
function withDrafts(stored: unknown, key: string): { next: unknown; rows: string[]; added: number } {
  const rows: string[] = []
  if (!stored || typeof stored !== 'object' || Array.isArray(stored)) {
    return { next: stored, rows: ['  번역 사전이 없다(이 영업장은 참고용 번역본을 쓰지 않는다). 번역은 건너뛴다.'], added: 0 }
  }
  const src = stored as StoredTranslations
  const langs = { ...(src.langs ?? {}) }
  let added = 0
  for (const lang of TRANSLATION_LANGS) {
    const draft = DRAFTS[lang]
    const entry = langs[lang]
    const show = `${lang.padEnd(3)} ${draft}`
    if (!entry || typeof entry !== 'object') { rows.push(`  ${show}\n      (이 언어는 영업장이 만들지 않아 넣지 않는다)`); continue }
    const dict = (entry.dict && typeof entry.dict === 'object' ? entry.dict : {}) as Record<string, unknown>
    const cur = dict[key]
    if (typeof cur === 'string' && cur.trim()) {
      rows.push(`  ${show}\n      (이미 번역이 있어 덮지 않는다: ${cur === draft ? '초안과 같음' : JSON.stringify(cur.slice(0, 60))})`)
      continue
    }
    langs[lang] = { ...entry, dict: { ...dict, [key]: draft } }
    added++
    rows.push(`  ${show}`)
  }
  return { next: { ...src, langs }, rows, added }
}

function translationImpact(p: PropRow, before: ContractTemplate, after: ContractTemplate, newItem: string, translationsAfter: unknown): void {
  const addenda = propertyContractAddenda(p, parseShortStayPolicy(p.shortStayPolicy).enabled)
  const refund = p.refundClauseInContract ?? true
  const linesBefore = translationSourceLines(before, addenda, refund, 'property')
  const linesAfter = translationSourceLines(after, addenda, refund, 'property')
  const stale = translationStaleAfterEdit(p.contractTranslations, before, after, addenda, refund, 'property')
  const orphanDelta = TRANSLATION_LANGS.map(lang => {
    const b = orphanTranslationKeys(p.contractTranslations, before, lang, addenda, refund, 'property').length
    const a = orphanTranslationKeys(translationsAfter, after, lang, addenda, refund, 'property').length
    return `${lang} ${b}/${a}`
  })
  const at = linesAfter.findIndex(l => l.text === newItem)
  console.log(`  번역 대상 줄 적용 전 ${linesBefore.length} · 후 ${linesAfter.length} (새 줄은 '한국어 전문 복사' 의 ${at + 1}번째 줄)`)
  console.log(`  원문으로 돌아가는 기존 번역: ${stale.lines}줄 · ${stale.langs}개 언어 (0 이어야 한다)`)
  console.log(`  고아 번역(언어별 전/후): ${orphanDelta.join(' · ')}`)
}

async function revert(file: string): Promise<void> {
  const undo = JSON.parse(fs.readFileSync(file, 'utf8')) as {
    propertyId: string
    before: { contractTemplate: unknown; contractTranslations: unknown }
    after: { contractTemplate: unknown; contractTranslations: unknown }
  }
  const cur = await prisma.property.findUnique({ where: { id: undo.propertyId }, select: { contractTemplate: true, contractTranslations: true } })
  if (!cur) throw new Error('대상 영업장이 없다')
  if (stable(cur.contractTemplate) !== stable(undo.after.contractTemplate) || stable(cur.contractTranslations) !== stable(undo.after.contractTranslations)) {
    throw new Error('지금 저장본이나 번역 사전이 적용 직후와 다르다(그 사이 설정 화면에서 고쳤다). 덮어쓰지 않고 멈춘다. 사람이 본다.')
  }
  const g0 = await measureGuard(undo.propertyId)
  await prisma.property.update({
    where: { id: undo.propertyId },
    data: { contractTemplate: undo.before.contractTemplate as never, contractTranslations: undo.before.contractTranslations as never },
  })
  const g1 = await measureGuard(undo.propertyId)
  const back = await prisma.property.findUnique({ where: { id: undo.propertyId }, select: { contractTemplate: true, contractTranslations: true } })
  const same = stable(back?.contractTemplate) === stable(undo.before.contractTemplate) && stable(back?.contractTranslations) === stable(undo.before.contractTranslations)
  console.log(`되돌림 완료. 저장본·번역 사전이 적용 전과 ${same ? '같다' : '다르다(확인 필요)'}.`)
  const diffs = compareGuard(g0, g1)
  console.log(diffs.length ? `불가침 점검 실패: ${diffs.join(' · ')}` : '불가침 점검: 박제·링크·발급본·사본·다른 영업장·열린 링크 건수 모두 그대로.')
  if (diffs.length || !same) process.exitCode = 1
}

async function main(): Promise<void> {
  if (REVERT_IDX > 0) {
    const file = process.argv[REVERT_IDX + 1]
    if (!file) throw new Error('--revert 다음에 되돌리기 파일 경로를 적는다')
    await revert(file)
    return
  }
  const propertyId = PROPERTY_IDX > 0 ? process.argv[PROPERTY_IDX + 1] : undefined
  if (!propertyId || propertyId.startsWith('--')) throw new Error('--property <영업장 id> 를 적는다(영업장마다 따로 돌린다)')

  console.log(APPLY ? '[적용] DB 를 실제로 씁니다.' : '[예행] 아무것도 쓰지 않습니다. 적용은 --apply.')

  const p = await prisma.property.findUnique({
    where: { id: propertyId },
    select: {
      id: true, name: true, contractTemplate: true, contractTranslations: true, refundClauseInContract: true,
      shortStayPolicy: true, subLeaseAddendum: true, shortStayAddendum: true, earlyCheckoutAddendum: true, roomScheduleAddendum: true,
    },
  })
  if (!p) throw new Error(`영업장 ${propertyId} 이 없다`)
  if (!p.contractTemplate) throw new Error('이 영업장은 저장본이 없다(코드 기본 양식을 쓴다). 코드 기본 양식에 이미 같은 문장이 있으니 할 일이 없다.')

  const before = p.contractTemplate as unknown as ContractTemplate
  const idx = findRulesIndex(before)
  if (idx == null) throw new Error("3절('생활 수칙')을 하나로 특정하지 못했다. 사람이 본다.")
  const sec = before.sections[idx]
  const items = Array.isArray(sec.items) ? sec.items : []

  console.log(`\n=== 영업장 ${p.name} (${p.id})`)
  console.log(`  대상 절: sections[${idx}] id=${JSON.stringify(sec.id)} title=${JSON.stringify(sec.title)} · 항목 ${items.length}개`)

  // 이미 있으면 본문은 건너뛰고 그 줄을 열쇠로 번역만 채운다(두 번 돌려도 같은 결과).
  const allItems = before.sections.flatMap(s => (Array.isArray(s.items) ? s.items : []))
  const existing = items.find(it => typeof it === 'string' && it.includes(SENTENCE))
  if (!existing && allItems.some(it => typeof it === 'string' && it.includes(SENTENCE))) {
    throw new Error('그 문장이 3절이 아닌 다른 절에 있다. 자동으로 고치지 않고 멈춘다(사람이 본다).')
  }
  if (!existing) {
    const variant = allItems.find(it => typeof it === 'string' && VARIANT_MARKS.some(m => it.includes(m)))
    if (variant) {
      console.log(`  같은 취지의 항목이 이미 있다. 자동으로 더하지 않고 멈춘다(사람이 본다).\n    ${JSON.stringify(variant)}`)
      return
    }
  }

  let newItem: string
  let after: ContractTemplate
  if (existing) {
    newItem = existing
    after = before
    console.log(`  이미 3절에 그 문장이 있다. 본문은 그대로 두고 번역만 본다.\n    ${JSON.stringify(existing)}`)
  } else {
    const made = newItemFor(items)
    if (!made) throw new Error("이 절의 꼴('\\tN.\\t' 손 번호 또는 '- ' 점)을 특정하지 못했다. 사람이 본다.")
    newItem = made.item
    console.log(`  번호 근거: ${made.why}`)
    after = {
      ...before,
      sections: before.sections.map((s, i) => (i === idx ? { ...s, items: [...items, newItem] } : s)),
    }
    console.log('\n--- 3절 변경 전')
    printSection(String(sec.title), items)
    console.log('\n--- 3절 변경 후')
    printSection(String(sec.title), [...items, newItem])

    const untouched = before.sections.every((s, i) => i === idx || stable(s) === stable(after.sections[i]))
      && stable({ ...before, sections: null }) === stable({ ...after, sections: null })
      && items.every((it, j) => (after.sections[idx].items[j] === it))
    console.log(`\n  기존 줄 불변: ${untouched ? '다른 절·서약문·제목·3절 기존 항목 모두 글자 그대로' : '어긋남(멈춘다)'}`)
    if (!untouched) throw new Error('기존 줄이 바뀌었다. 멈춘다')
  }

  // 초안은 자리표시자를 품지 않는다(원문에 없다). 그래도 저장 경로의 검사와 같은 함수로 확인한다.
  for (const lang of TRANSLATION_LANGS) {
    const miss = missingTranslationPlaceholders(newItem, DRAFTS[lang])
    if (miss.length) throw new Error(`${lang} 초안이 자리표시자를 잃었다: ${miss.join(', ')}`)
  }
  const tr = withDrafts(p.contractTranslations, newItem)
  console.log(`\n--- 번역 초안(열쇠 = 새 줄 전문) · 넣을 칸 ${tr.added}`)
  for (const r of tr.rows) console.log(r)

  console.log('\n--- 번역 영향')
  translationImpact(p, before, after, newItem, tr.next)

  console.log('\n--- 불가침 점검(적용 전)')
  const g0 = await measureGuard(p.id)
  printGuard(g0)

  const templateChanges = after !== before
  if (!templateChanges && tr.added === 0) {
    console.log('\n할 일이 없다(본문·번역 모두 이미 반영됨).')
    return
  }
  if (!APPLY) {
    console.log('\n예행이라 DB 는 그대로입니다. 적용하려면 --apply 를 붙여 다시 실행하세요.')
    if (g0.openUnsigned > 0) console.log(`주의. 이 영업장에 미서명 열린 링크 ${g0.openUnsigned}건이 있어 지금 --apply 하면 멈춘다.`)
    return
  }

  // 직전 재확인(체크리스트 D). 위 measureGuard 와 사이에 링크가 새로 나갔을 수 있어 한 번 더 센다.
  const now = new Date()
  const openUnsigned = await prisma.contractShareLink.count({
    where: { propertyId: p.id, signedAt: null, disposalSignedAt: null, submittedAt: null, closedAt: null, expiresAt: { gt: now } },
  })
  if (openUnsigned > 0) throw new Error(`미서명 열린 링크 ${openUnsigned}건. 옛 본문으로 서명받는다. 닫거나 서명받은 뒤 다시 돌린다. 아무것도 안 썼다.`)

  // 읽은 뒤 그 사이 설정 화면에서 저장했으면 덮어쓰지 않는다.
  const fresh = await prisma.property.findUnique({ where: { id: p.id }, select: { contractTemplate: true, contractTranslations: true } })
  if (stable(fresh?.contractTemplate) !== stable(before) || stable(fresh?.contractTranslations) !== stable(p.contractTranslations)) {
    throw new Error('읽은 뒤 저장본이나 번역 사전이 바뀌었다. 다시 돌린다. 아무것도 안 썼다.')
  }

  const file = `scripts/.fix-contract-pet-clause-undo-${Date.now()}.json`
  fs.writeFileSync(file, JSON.stringify({
    propertyId: p.id, propertyName: p.name, appliedAt: new Date().toISOString(), newItem,
    before: { contractTemplate: before, contractTranslations: p.contractTranslations },
    after: { contractTemplate: after, contractTranslations: tr.next },
  }, null, 2))
  await prisma.property.update({
    where: { id: p.id },
    data: { contractTemplate: after as never, contractTranslations: tr.next as never },
  })

  const back = await prisma.property.findUnique({ where: { id: p.id }, select: { contractTemplate: true, contractTranslations: true } })
  const g1 = await measureGuard(p.id)
  console.log('\n--- 불가침 점검(적용 후)')
  printGuard(g1)
  const diffs = compareGuard(g0, g1)
  const stored = stable(back?.contractTemplate) === stable(after) && stable(back?.contractTranslations) === stable(tr.next)
  console.log(`\n  저장본·번역 사전: ${stored ? '의도한 모양 그대로 저장됨' : '의도와 다르다(확인 필요)'}`)
  console.log(diffs.length
    ? `  불가침 점검 실패: ${diffs.join(' · ')}`
    : '  불가침 점검: 서명 박제·링크 스냅샷·발급본 박제·사본·다른 영업장·열린 링크 건수 모두 그대로.')
  if (diffs.length || !stored) process.exitCode = 1
  console.log(`\n적용했다. 되돌리기: npx tsx --env-file=.env.local scripts/fix-contract-pet-clause.ts --revert ${file}`)
  console.log('다음 할 일: 설정 > 계약서 > 참고용 번역본에서 새 줄 번역을 검수 PDF 로 원어민에게 확인받는다.')
}

main()
  .catch(e => { console.error(e instanceof Error ? e.message : e); process.exitCode = 1 })
  .finally(() => prisma.$disconnect())
