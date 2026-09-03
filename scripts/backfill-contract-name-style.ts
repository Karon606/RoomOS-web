// 기존 ContractFile 의 nameStyle 태그를 실제 종이와 맞추는 백필 — 기본은 예행, --apply 로만 적용.
//
// 왜 필요한가(운영자 확인 A-2, 2026-09-03). 발급 화면이 표기 해석값을 저장 payload 에 안 실어
// 보내던 시절의 행들이 남아 있다. 외국인 다수가 null 이고, 한 건은 종이가 영문인데 ko 로 박제됐다.
// 앞으로 발급되는 건은 358adb49 이후 맞게 저장된다.
import prisma from '../lib/prisma'
import { resolveDocNameStyle, docNameStyles, isKoreanNationality, type DocNameStyle } from '../lib/documentName'

const apply = process.argv.includes('--apply')

async function main() {
  const rows = await prisma.contractFile.findMany({
    select: {
      id: true, nameStyle: true, createdAt: true, leaseTermId: true, fileName: true, issuedSnapshot: true,
      leaseTerm: {
        select: {
          tenant: {
            select: {
              id: true, name: true, englishName: true, nativeName: true,
              nationality: true, foreignRegNoEnc: true, docNameStyle: true,
            },
          },
        },
      },
    },
    orderBy: { createdAt: 'asc' },
  })

  const plan: { id: string; who: string; from: string; to: DocNameStyle; why: string }[] = []
  for (const r of rows) {
    const t = r.leaseTerm?.tenant
    if (!t) continue
    // 운영자가 종이를 찍어 올린 스캔본은 대상이 아니다. 우리가 인쇄한 것이 아니라서 어느 표기로
    // 적힌 종이인지 우리가 모른다. 추정으로 태그를 붙이면 지금과 반대 방향의 오류가 된다.
    if (!(/^계약서_/.test(r.fileName) && r.issuedSnapshot != null)) continue
    // 내국인은 태그가 null 이어도 기본값(한글)으로 동작해 표시가 같다. 무변화 갱신은 하지 않는다.
    const isForeign = !!t.foreignRegNoEnc || !isKoreanNationality(t.nationality)
    if (!isForeign) continue
    const available = docNameStyles({ name: t.name, englishName: t.englishName, nativeName: t.nativeName })
    const want = resolveDocNameStyle({
      saved: null,                       // 박제값을 근거로 쓰지 않는다 — 그것이 틀린 것이 문제다
      siblings: [],
      tenant: (t.docNameStyle as DocNameStyle | null) ?? null,
      nationality: t.nationality,
      hasForeignRegNo: !!t.foreignRegNoEnc,
      available,
    })
    if (r.nameStyle === want) continue
    const foreign = isForeign
    plan.push({
      id: r.id,
      who: `${t.name}(${t.nationality ?? '국적없음'}${foreign ? ', 외국인' : ''})`,
      from: r.nameStyle ?? 'null',
      to: want,
      why: t.docNameStyle ? `사람 단위 지정 ${t.docNameStyle}` : foreign ? '외국인 기본 영문' : '내국인 기본 한글',
    })
  }

  console.log(`\nContractFile ${rows.length}건 중 태그가 어긋난 것 ${plan.length}건\n`)
  const byMove = new Map<string, number>()
  for (const p of plan) {
    byMove.set(`${p.from} -> ${p.to}`, (byMove.get(`${p.from} -> ${p.to}`) ?? 0) + 1)
    console.log(`  ${p.who.padEnd(28)} ${p.from.padEnd(5)} -> ${p.to.padEnd(6)} (${p.why})`)
  }
  console.log('\n이동 요약')
  for (const [k, v] of byMove) console.log(`  ${k}: ${v}건`)

  if (!apply) { console.log('\n예행이다. 적용하려면 --apply 를 붙인다.'); return }
  for (const p of plan) await prisma.contractFile.update({ where: { id: p.id }, data: { nameStyle: p.to } })
  console.log(`\n적용 완료 ${plan.length}건`)
}

main().finally(() => prisma.$disconnect())
