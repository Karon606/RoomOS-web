// 서류 변수 사전 감사 — 사전(lib/docVariables)과 실제 치환 코드·점프 앵커의 드리프트를 잡는다.
//
// 사전은 설명서다. 설명서가 코드와 갈리면 허브가 없는 변수를 말하거나 새 변수를 침묵하는데,
// 둘 다 사람이 눈치채기 어렵다. 그래서 양방향으로 잰다.
//   (가) 치환 코드에 있는 키는 전부 사전에 있어야 한다 — 새 변수를 만들면 사전도 채워라.
//   (나) 사전의 키는 전부 치환 코드에 실재해야 한다 — 지운 변수를 사전에 남기지 마라.
//   (다) 사전·문안 목록이 가리키는 점프 앵커는 환경설정 화면에 실재해야 한다.
//
// 실행: npx tsx scripts/check-doc-variable-registry.ts (DB 불필요, 소스만 읽는다)
import { readFileSync } from 'node:fs'
import { DOC_VARIABLES, DOC_TEMPLATES } from '../lib/docVariables'

const violations: string[] = []
const src = (p: string) => readFileSync(p, 'utf8')

const dictKeys = (grammar: string) => new Set(DOC_VARIABLES.filter(v => v.grammar === grammar).map(v => v.key))
const diff = (a: Set<string>, b: Set<string>) => [...a].filter(k => !b.has(k))

// ── (가)(나) 계약서 본문 {{영문·한글}} — 인쇄 정본의 vars 블록과 대조
{
  const printSrc = src('lib/contractPrintHtml.ts')
  const block = printSrc.match(/const vars: Record<string, string> = \{([\s\S]*?)\n {2}\}/)
  if (!block) {
    violations.push('lib/contractPrintHtml.ts — 계약서 변수 블록(const vars)을 못 찾았다. 감지망을 고칠 것.')
  } else {
    const extracted = new Set([...block[1].matchAll(/^\s{4}([A-Za-z가-힣][\w가-힣]*):/gm)].map(m => m[1]))
    // 스프레드(...cleaningFeeVars)와 치환 지점이 다른 키 — lib/contract 에서 확인한다.
    const special = new Set(['청소비', '청소비조항', '청소비공제', '일정'])
    const dict = dictKeys('doc')
    for (const k of diff(extracted, dict)) violations.push(`계약서 변수 {{${k}}} 가 사전(lib/docVariables)에 없다. 허브가 이 변수를 모른다.`)
    for (const k of diff(dict, new Set([...extracted, ...special]))) violations.push(`사전의 계약서 변수 {{${k}}} 가 치환 코드에 없다. 지운 변수가 사전에 남았다.`)
    const contractSrc = src('lib/contract.ts')
    for (const k of special) {
      if (dict.has(k) && !contractSrc.includes(k)) violations.push(`사전의 {{${k}}} 근거를 lib/contract.ts 에서 못 찾았다.`)
    }
  }
  const dcBlock = printSrc.match(/const dcVars: Record<string, string> = \{([\s\S]*?)\}/)
  if (!dcBlock) {
    violations.push('lib/contractPrintHtml.ts — 동의서 변수 블록(dcVars)을 못 찾았다.')
  } else {
    const extracted = new Set([...dcBlock[1].matchAll(/([가-힣]+):/g)].map(m => m[1]))
    const dict = dictKeys('consent')
    for (const k of diff(extracted, dict)) violations.push(`동의서 변수 {{${k}}} 가 사전에 없다.`)
    for (const k of diff(dict, extracted)) violations.push(`사전의 동의서 변수 {{${k}}} 가 치환 코드에 없다.`)
  }
}

// ── (가)(나) 문자·메일 {단괄호} — replaceAll 호출과 대조
{
  const files = ['lib/docSms.ts', 'lib/docMail.ts', 'components/UnpaidSmsModal.tsx', 'components/TenantSmsModal.tsx']
  const extracted = new Set<string>()
  for (const f of files) {
    // 치환 문법이 두 가지다 — replaceAll 호출(docSms·문자 모달)과 치환 맵 객체 키(docMail).
    for (const m of src(f).matchAll(/replace(?:All)?\(\s*'\{([가-힣]+)\}'/g)) extracted.add(m[1])
    for (const m of src(f).matchAll(/'\{([가-힣]+)\}':/g)) extracted.add(m[1])
  }
  const dict = dictKeys('msg')
  for (const k of diff(extracted, dict)) violations.push(`문자·메일 변수 {${k}} 가 사전에 없다.`)
  for (const k of diff(dict, extracted)) violations.push(`사전의 문자·메일 변수 {${k}} 가 치환 코드에 없다.`)
}

// ── (다) 점프 앵커 실재
{
  const formSrc = src('app/(app)/settings/SettingsForm.tsx')
  const anchors = new Set<string>()
  for (const v of DOC_VARIABLES) if (v.editAnchor) anchors.add(v.editAnchor)
  for (const t of DOC_TEMPLATES) anchors.add(t.editAnchor)
  for (const a of anchors) {
    if (!formSrc.includes(`id="${a}"`)) violations.push(`점프 앵커 ${a} 가 환경설정 화면에 없다. 허브의 이동 버튼이 허공을 가리킨다.`)
  }
}

console.log(`[서류 변수 사전] 변수 ${DOC_VARIABLES.length}건 · 문안 ${DOC_TEMPLATES.length}건 대조 / 위반 ${violations.length}건`)
if (violations.length > 0) {
  for (const v of violations) console.error(`  - ${v}`)
  process.exit(1)
}
