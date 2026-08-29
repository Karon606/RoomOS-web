// 서류 메일이 바깥 주소를 물고 나가는 것을 잡는 감지망 — 읽기 전용, 위반 시 exit 1.
//
// 왜 필요한가. 메일은 나가면 못 되돌린다. 본문이 외부 주소를 참조하면 넷이 한꺼번에 걸린다.
//   · 수신함 상당수가 외부 이미지를 기본 차단해 그 자리가 빈다.
//   · 열 때마다 원격 요청이 나가 열람 추적과 구분되지 않는다(서류 메일에 붙일 성질이 아니다).
//   · **그 주소가 죽는 날 과거 발송분이 통째로 깨진다.** 로고를 새로 올리면 앱이 옛 Drive 파일을
//     휴지통으로 보내므로, 링크였다면 로고 한 번 바꾸는 것으로 지난 메일이 전부 깨진다.
//   · 스팸 점수가 오른다.
//
// 그래서 메일에 실리는 것은 cid(인라인 첨부)와 data(미리보기)뿐이어야 한다. 서류 쪽에는
// 같은 축의 그물이 이미 있다(check-print-selfcontained). 그 메일판이다.
//
// 렌더 결과는 scripts/test-doc-mail-render.ts 가 실제로 그려 보며 검사한다. 여기서는 **소스에
// 외부 주소가 박히는 것**을 막는다 — 렌더 케이스가 안 닿는 분기에 누가 링크를 심어도 잡히게.
//
// 실행: node scripts/check-mail-selfcontained.mjs
import { readFileSync } from 'node:fs'

const TARGETS = ['lib/docMail.ts', 'lib/docMailLogo.ts']
// 주석과 문서 링크는 본문에 안 실린다. 코드 줄에 박힌 주소만 본다.
const isComment = (line) => /^\s*(\/\/|\*|\/\*)/.test(line)

const violations = []
let scanned = 0
for (const f of TARGETS) {
  const src = readFileSync(f, 'utf8')
  src.split('\n').forEach((line, i) => {
    if (isComment(line)) return
    scanned++
    // 로고 조달은 서버가 발송 **전에** 부르는 fetch 라 메일에 안 실린다. 그 파일만 예외다.
    if (f === 'lib/docMailLogo.ts') return
    const m = line.match(/https?:\/\/[^\s'"`)]+/)
    if (m) violations.push(`${f}:${i + 1} — 메일을 짓는 자리에 바깥 주소가 있다: ${m[0].slice(0, 60)}`)
  })
}

console.log(`[메일 자립] 코드 ${scanned}줄 검사 / 위반 ${violations.length}건`)
if (violations.length > 0) {
  console.error('')
  for (const v of violations) console.error(`  - ${v}`)
  console.error('')
  console.error('  메일에 실리는 것은 cid(인라인 첨부)와 data(미리보기)뿐이다.')
  console.error('  이미지가 필요하면 lib/docMailLogo 처럼 발송 전에 바이트를 받아 첨부로 싣는다.')
  process.exit(1)
}
