// 계약서 참고용 번역본을 파일에서 읽어 영업장 사전에 넣는다(초기 적재·재적용용).
//
// 왜 스크립트인가. 8언어 × 49줄을 화면에서 손으로 넣는 것은 현실적이지 않고, 한 번 넣고 끝날
// 일도 아니다(본문을 고치면 그 줄만 다시 채운다). 그래서 파일을 진실로 두고 **저장 경로의
// 정본**(mergeTranslationLang)을 그대로 불러 넣는다 — 화면 저장과 같은 규칙을 지나야
// 자리표시자 검사·권장 문안 정리 같은 규칙이 여기서만 빠지는 일이 없다.
//
// 파일 모양: `<dir>/contract-<lang>.json` = [{ ko: '한국어 원문', t: '번역문' }, ...]
// `ko` 가 사전의 열쇠라 **원문과 한 글자도 달라선 안 된다.** 다르면 그 줄은 조용히 고아가 되고
// 번역본에는 한국어가 그대로 남는다. 그래서 넣기 전에 열쇠·개수·자리표시자를 먼저 검사한다.
//
// 실행: npx tsx --env-file=.env.local scripts/seed-contract-translations.ts <dir>          (예행)
//       npx tsx --env-file=.env.local scripts/seed-contract-translations.ts <dir> --apply  (적용)
import fs from 'node:fs'
import path from 'node:path'
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { parseContractTranslations, mergeTranslationLang, asTranslationLang, refundTranslationKey } from '../lib/contractTranslation'

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DIRECT_URL }) })
const dir = process.argv[2]
const apply = process.argv.includes('--apply')
const PH = /\{\{[^}]+\}\}/g
const phSet = (s: string) => (s.match(PH) ?? []).slice().sort().join('|')

async function main() {
  if (!dir) { console.error('번역 파일 폴더를 인자로 주세요.'); process.exit(1) }
  const props = await prisma.property.findMany({ select: { id: true, name: true, contractTranslations: true } })

  for (const prop of props) {
    console.log(`\n=== ${prop.name} ===`)
    let stored: unknown = prop.contractTranslations
    let touched = 0

    for (const file of fs.readdirSync(dir).filter(f => /^contract-[a-z]+\.json$/.test(f)).sort()) {
      const lang = asTranslationLang(file.slice('contract-'.length, -'.json'.length))
      if (!lang) continue
      const rows = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8')) as { ko: string; t: string }[]

      // 자리표시자가 어긋난 줄은 넣지 않는다 — 그 자리에 들어갈 값이 사라지고 조용히 실패한다.
      const bad = rows.filter(r => phSet(r.ko) !== phSet(r.t ?? ''))
      const empty = rows.filter(r => !(r.t ?? '').trim())
      const dict: Record<string, string> = {}
      // 환불 규정 줄은 넣지 않는다. 그 칸은 '빈 칸 = 권장 번역' 규칙이라, 값을 넣으면
      // 권장과 다른 직접 번역으로 표시돼 경고가 선다. 권장 문안이 정본이므로 비워 둔다.
      const refundKey = refundTranslationKey()
      let skippedRefund = 0
      for (const r of rows) {
        if (!r.ko || !(r.t ?? '').trim()) continue
        if (phSet(r.ko) !== phSet(r.t)) continue
        if (r.ko === refundKey) { skippedRefund++; continue }
        dict[r.ko] = r.t.trim()
      }
      if (skippedRefund) console.log(`   (환불 규정 ${skippedRefund}줄은 권장 문안을 쓰도록 비워 둔다)`)
      console.log(`${lang}: 파일 ${rows.length}줄 / 넣을 것 ${Object.keys(dict).length}줄`
        + (bad.length ? ` / 자리표시자 어긋남 ${bad.length}줄(제외)` : '')
        + (empty.length ? ` / 빈 번역 ${empty.length}줄(제외)` : ''))
      if (bad.length) for (const b of bad) console.log(`   [제외] ${b.ko.slice(0, 40)}…`)

      // 병합 정본은 자리표시자가 어긋나면 거부한다(ok:false). 여기서 조용히 넘기지 않는다.
      const res = mergeTranslationLang(stored, lang, { dict })
      if (!res.ok) { console.log(`   [거부] 자리표시자 누락 ${res.missing.length}건 — 이 언어는 건너뛴다.`); continue }
      stored = res.next
      touched++
    }

    const parsed = parseContractTranslations(stored)
    const langs = Object.keys(parsed.langs)
    console.log(`언어 ${touched}개 병합 / 사전에 남은 언어: ${langs.join(', ') || '없음'}`)
    if (!apply) continue
    await prisma.property.update({ where: { id: prop.id }, data: { contractTranslations: parsed as object } })
    console.log('적용함.')
  }

  if (!apply) console.log('\n(예행이다. --apply 로 적용한다.)')
  await prisma.$disconnect()
}

main().catch(async e => { console.error(e); await prisma.$disconnect(); process.exit(1) })
