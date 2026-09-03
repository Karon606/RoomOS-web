// 서류 파일 이름이 성명 표기를 따라가는지 보는 감지망 — 읽기 전용, 위반 시 exit 1.
//
// 왜 필요한가. 영문으로 발급한 서류를 목록에서 다시 보내면 파일 이름이 '이름만 로마자, 서류명은
// 한글'로 나갔다. 받는 사람이 절반을 못 읽는다. 원인은 각 화면이 서류 이름을 손으로 조립한 것이고,
// 그 자리가 여섯이었다(발급 화면 셋 · 목록 셋 · 계약서 파일 칸).
//
// 이제 이름은 lib/docBundle 의 docFileLabel(docType, nameStyle) 하나가 만든다. 손 조립이
// 되살아나면 그 화면만 조용히 갈린다 — 손사본은 언젠가 갈린다는 것이 이 저장소가 반복해 배운 것이다.
//
// 무엇을 보는가. 파일 이름을 만드는 자리(fileName= · docFileName)에서 서류 이름을 한글 리터럴로
// 박는 것을 잡는다. 표기와 무관하게 고정하기로 한 자리는 ALLOW 에 근거와 함께 적는다.
//
// 실행: node scripts/check-doc-file-label.mjs
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

// 서류 이름을 파일명에 박으면 안 되는 낱말 — DOC_TYPE_FILE_LABEL 의 한글 값들.
const DOC_WORDS = ['계약서', '실거주확인서', '입실료납부확인서', '보증금영수증']

// 표기와 무관하게 고정하기로 한 자리. 근거 없이 늘리지 마라.
const ALLOW = new Map([
  // 계약서 발급 화면 — 파일 이름을 보관·검색의 열쇠로 보고 표기와 분리한 판단(주석에 명시).
  // 서버 발급본의 Drive 파일명도 같은 값이라 둘이 짝을 이룬다.
  ['app/contract/[tenantId]/ContractView.tsx', '보관·검색 열쇠로 고정(코드 주석에 근거)'],
  // Drive 보관 파일명 — 위 화면과 짝을 이루는 서버 쪽이다. **내보낼 때의 이름은 따로 짓는다**
  // (lib/docShareQueue shareFileNames 가 표기를 따라 다시 짓고, 바이트로 확장자까지 재판정한다).
  // 보관명을 표기에 맡기면 같은 사람의 종이가 Drive 에서 두 이름으로 흩어져 검색이 깨진다.
  ['app/api/contract/generate/route.ts', 'Drive 보관명은 검색 열쇠로 고정(내보내기 이름은 별도)'],
  ['app/api/residence-cert/generate/route.ts', 'Drive 보관명은 검색 열쇠로 고정(내보내기 이름은 별도)'],
])

const roots = ['app', 'components']
const files = []
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue
    const full = join(dir, name)
    if (statSync(full).isDirectory()) { walk(full); continue }
    // **.ts 도 본다.** 첫 판이 .tsx 만 봐서, 서버 쪽 조립부(tenants/docBundle.ts)가 사람 이름과
    // 서류 이름을 둘 다 한글로 고정하고 있던 것을 놓쳤다(신고 2026-09-03).
    if (/\.tsx?$/.test(name)) files.push(full)
  }
}
for (const r of roots) walk(r)

const violations = []
let scanned = 0
for (const f of files) {
  if (ALLOW.has(f)) continue
  const src = readFileSync(f, 'utf8')
  src.split('\n').forEach((line, i) => {
    if (/^\s*(\/\/|\*|\/\*)/.test(line)) return
    // 파일 이름을 만드는 줄만 본다. 화면에 보이는 라벨(서류 제목 등)은 대상이 아니다.
    if (!/fileName\s*[=:]|docFileName\s*=/.test(line)) return
    // 그냥 옮기는 줄은 뺀다 — `fileName: f.fileName` 이 있는 줄의 **다른 칸**(검색 결과의
    // kindLabel)이 헛걸렸다. 이름을 조립하는 줄이면 fileName 바로 뒤가 따옴표나 중괄호다.
    if (/fileName\s*:\s*[\w.[\]]+\s*[,}]/.test(line)) return
    scanned++
    const hit = DOC_WORDS.find(w => line.includes(w))
    if (hit) {
      violations.push(`${f}:${i + 1} — 파일 이름에 서류명 '${hit}' 을 손으로 박았다. docFileLabel(docType, nameStyle) 을 쓴다.`)
    }
  })
}

// 사람 이름도 표기를 따르는가 (2026-08-31 운영자 지적).
//   종전에는 서류 종류만 영문으로 바뀌고 사람 이름은 늘 한글이라, 영문으로 낸 실거주 확인서가
//   '아라파트 에야신_Proof of Residence.pdf' 로 나갔다. 반쪽 영문 파일명이다.
{
  const SCREENS = [
    'app/(app)/residence-certs/ResidenceCertClient.tsx',
    'app/(app)/contracts/ContractsClient.tsx',
    'app/(app)/rent-receipts/RentReceiptsClient.tsx',
  ]
  for (const f of SCREENS) {
    const src = readFileSync(f, 'utf8')
    if (/\$\{c\.tenantName\}_\$\{docFileLabel/.test(src)) {
      violations.push(`${f} — 파일 이름의 사람 이름이 표기를 안 따른다. 영문 서류에 한글 이름이 붙는다.`)
    }
  }
}

// 시트(입주자 상세 > 서류)의 파일명 조립도 표기를 따르는가 (신고 2026-09-03).
//   여기가 **보내기의 유일한 입구**인데 사람 이름은 bundle.tenantName(한글 고정), 서류 이름은
//   DOC_TYPE_FILE_LABEL(한글 고정)이었다. 영문으로 발급한 종이가 전부 한글 이름으로 나갔다.
{
  const f = 'app/(app)/tenants/docBundle.ts'
  const src = readFileSync(f, 'utf8')
  const block = src.match(/const entries = rows\.map\(r => \{[\s\S]*?\n  \}\)/)
  if (!block) {
    violations.push(`${f} — 파일명 조립부(entries)를 못 찾았다. 구조가 바뀌었으면 이 그물도 같이 고쳐야 한다.`)
  } else {
    if (!/docFileLabel\(r\.docType/.test(block[0])) {
      violations.push(`${f} — 서류 이름이 표기를 안 따른다. docFileLabel(docType, nameStyle) 을 쓴다.`)
    }
    if (!/documentName\(bundle\.nameSource/.test(block[0])) {
      violations.push(`${f} — 사람 이름이 표기를 안 따른다. 영문 서류에 한글 이름이 붙는다.`)
    }
  }
  // 발급본에 박제된 표기가 정본까지 실려야 위 둘이 판정할 값이 있다.
  if (!/nameStyle: file\?\.nameStyle/.test(readFileSync('lib/docBundle.ts', 'utf8'))) {
    violations.push(`lib/docBundle.ts — 발급 당시 표기가 행에 안 실린다. 파일 이름이 볼 값이 없어진다.`)
  }
}

console.log(`[서류 파일명] 파일명 조립 ${scanned}줄 검사 · 예외 ${ALLOW.size}곳 / 위반 ${violations.length}건`)
if (violations.length > 0) {
  console.error('')
  for (const v of violations) console.error(`  - ${v}`)
  console.error('')
  console.error('  서류 이름은 lib/docBundle 의 docFileLabel 하나가 만든다. 표기가 영문이면 이름도 영문이다.')
  console.error('  표기와 무관하게 고정할 자리라면 이 스크립트의 ALLOW 에 근거와 함께 적는다.')
  process.exit(1)
}
