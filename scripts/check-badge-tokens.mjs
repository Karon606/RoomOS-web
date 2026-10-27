// 배지 색이 §04 의미 토큰 트라이어드 밖으로 새는 것을 잡는 감지망. 읽기 전용, 위반 시 exit 1.
//
// 왜 필요한가. Badge 의 pale-green ring 이 차트 팔레트(--viz-3)에 알파 30% 를 얹은 값이었고
// pale-coral 은 --persimmon 계열에 알파 20% 였다. §04 는 "각 의미 = fg / bg / ring / solid" 이고
// 결정 6 이 "페일 틴트는 bg/fg/ring 트라이어드 1:1" 이다. 트라이어드 밖 값은 다크에서 §28 틴트표를
// 못 타고, 알파 슬래시는 토큰 값이 바뀌어도 따라가지 않는다(2026-09-03 정비).
//
//   ⓐ 배지 두 정본(Badge·StatusBadge)에 --viz-* 참조가 없다. 차트 팔레트는 배지 색이 아니다.
//   ⓑ hex 리터럴이 없다. 색은 토큰만.
//   ⓒ 토큰 뒤 알파 슬래시(/20 같은)가 없다. 반투명은 토큰 값 안에 있다.
//   ⓓ 틴트 배지에 ring 이 없다(§11 2026-09 개정). 정본 두 파일과, 정본 밖에서 같은 문법을 손으로
//      쓴 자리(-bg + -fg + ring-1)를 함께 본다. 정본만 걷으면 모조가 새 이질감이 된다.
//      메타 칩(bg --canvas + ring --warm-border)과 폼 에러 박스·선택 보더의 ring 은 대상이 아니다.
//   ⓔ 배지 모양 줄(py-0.5 + rounded 의 span)이 style 에서 color-mix 로 색을 섞지 않는다(2026-10-27 D4, 홈 영수증 카드).
//      color-mix 로 지은 틴트는 §04 트라이어드 밖이라 다크 틴트표를 못 탄다. 상태는 정본 Badge, 메타 정보는 §11 메타 칩이다.
//      좁은 축이다. 이번에 고친 화면만 본다(COLOR_MIX_SURFACES). 같은 꼴이 남은 자리는 홈 '알림'·'이달 미수납' 머리의 건수 칩 둘
//      (숫자 카운터는 §11 범위 밖)과 환경설정 푸시 이력의 출처 칩 하나다. 그 화면을 고칠 때 여기에 더한다(빼는 일은 없다).
//
// 실행: node scripts/check-badge-tokens.mjs
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const FILES = ['components/ui/Badge.tsx', 'components/ui/StatusBadge.tsx']
// 줄 수를 보존해야 줄번호가 안 밀린다. 블록 주석은 줄바꿈만 남기고 지우고, 줄 주석의 앞 여백은
// `\s*` 가 아니라 `[^\S\n]*` 다 — m 플래그에서 `\s` 는 줄바꿈까지 먹어 줄이 통째로 사라진다.
const stripComments = s => s
  .replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ''))
  .replace(/^[^\S\n]*\/\/.*$/gm, '')
  .replace(/\/\/[^\n'"`]*$/gm, '')
const violations = []

for (const f of FILES) {
  const lines = stripComments(readFileSync(f, 'utf8')).split('\n')
  lines.forEach((line, i) => {
    const at = `${f}:${i + 1}`
    if (/--viz-\d/.test(line)) violations.push(`${at} 차트 팔레트(--viz-*)가 배지 색에 섰다. §04 의미 토큰 트라이어드로.`)
    if (/#[0-9a-fA-F]{3,8}\b/.test(line)) violations.push(`${at} hex 리터럴이 배지 색에 섰다. 토큰만(§04).`)
    if (/\]\/\d+/.test(line) || /var\(--[\w-]+\)\/\d+/.test(line)) violations.push(`${at} 토큰 뒤 알파 슬래시다. 반투명은 -bg/-ring 토큰 값 안에 있다(§04 결정 6).`)
  })
}

// ⓓ 정본 밖의 손 배지 — 한 줄에 의미색 -bg 와 -fg 가 함께 있고 ring 이 붙으면 틴트 배지 모조다.
const walk = (dir, out) => {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue
    const full = join(dir, name)
    if (statSync(full).isDirectory()) { walk(full, out); continue }
    if (name.endsWith('.tsx')) out.push(full)
  }
  return out
}
const TINT = /(danger|success|warning|info|deposit|reserve|neutral|inspect)/
for (const f of walk('app', walk('components', []))) {
  const lines = stripComments(readFileSync(f, 'utf8')).split('\n')
  lines.forEach((line, i) => {
    if (!/\bring-1\b/.test(line)) return
    // 버튼은 대상이 아니다 — 눌리는 면의 테두리는 §10 이 정한다(디자이너 패스 2026-09-03).
    if (/hover:|disabled:|onClick/.test(line)) return
    const bg = line.match(/bg-\[var\(--([\w-]+)-bg\)\]/)
    const fg = line.match(/text-\[var\(--([\w-]+)-fg\)\]/)
    if (!bg || !fg || bg[1] !== fg[1] || !TINT.test(bg[1])) return
    violations.push(`${f}:${i + 1} 틴트 배지에 ring 이 붙었다. -bg + -fg 만 쓴다(§11 2026-09 개정).`)
  })
}

// ⓔ 배지 모양 줄의 style color-mix — 여는 태그 하나를 중괄호 깊이로 잘라 본다(style={{ … }} 의 '>' 를 끝으로 읽지 않게).
{
  const tagEnd = (src, from) => { let d = 0; for (let k = from; k < src.length; k++) { const c = src[k]; if (c === '{') d++; else if (c === '}') d--; else if (c === '>' && d === 0) return k } return -1 }
  const COLOR_MIX_SURFACES = ['components/dashboard/PendingReceiptSection.tsx']
  for (const f of COLOR_MIX_SURFACES) {
    const src = stripComments(readFileSync(f, 'utf8'))
    for (const m of src.matchAll(/<span\b/g)) {
      const end = tagEnd(src, m.index)
      if (end < 0) continue
      const tag = src.slice(m.index, end + 1)
      const cls = tag.match(/className=(?:"([^"]*)"|\{`([^`]*)`\})/)
      const c = cls ? (cls[1] ?? cls[2] ?? '') : ''
      if (!/(?:^|\s)py-0\.5(?:\s|$)/.test(c) || !/(?:^|\s)rounded(?:-\w+)?(?:\s|$)/.test(c)) continue
      if (!/style=\{\{[\s\S]*color-mix\(/.test(tag)) continue
      violations.push(`${f}:${src.slice(0, m.index).split('\n').length} 배지 모양 줄이 style 에서 color-mix 로 색을 섞는다. 상태는 정본 Badge, 메타 정보는 §11 메타 칩으로(§04 트라이어드).`)
    }
  }
}

console.log(`[배지 토큰] 정본 ${FILES.length}파일 + 손 배지 검사(ⓓ ring · ⓔ color-mix) / 위반 ${violations.length}건`)
for (const v of violations) console.error(`  - ${v}`)
process.exit(violations.length > 0 ? 1 : 0)
