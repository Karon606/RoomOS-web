// 테라코타 글자가 다크에서 안 읽히는 색으로 되돌아가는 것을 잡는 감지망. 읽기 전용, 위반 시 exit 1.
//
// 왜 필요한가. `--coral`(#a03c2e)은 다크 카드 표면(#1A130E) 위에서 **2.78:1** 이라 §28 본문 하한
// (4.5:1)에 못 미친다. 정본 처방은 `--tc-text`(다크 #C9614C, 4.63:1)이고 포커스 링은 2026-09 에
// 전수 통일됐는데(check-focus-ring-token) **글자**는 그대로 남아 있었다 — 환경설정 통장사본 카드의
// '기본정보에서 계좌 보기' 링크가 다크에서 안 읽혀 웹디자이너가 잡았고(2026-10-07), 같은 클래스가
// 앱 코드 200여 곳이었다.
//
// **라이트는 한 픽셀도 안 바뀐다** — `--tc-text` 는 라이트에서 `var(--coral)` 그대로이고
// 다크에서만 밝아진다(§19 페어). 그래서 이 치환은 언제나 안전하고, 되돌릴 이유가 없다.
//
//   ⓐ Tailwind 글자색 `text-[var(--coral)]`·`text-[var(--persimmon)]`(hover: 접두사 포함)이 없다.
//      hover 도 같은 축이다 — 포커스 링과 달리 글자는 hover 상태에서도 읽혀야 한다.
//   ⓑ 인라인 `color: 'var(--coral)'` 이 없다(같은 글자 축, 스타일 객체 문법).
//   ⓒ SVG stroke·fill, 보더, 배경 틴트, outline 은 대상이 아니다 — 배치도 캔버스·영수증 사진 위
//      그림은 모드 불변(§28)이고 보더·틴트는 자기 규칙(§12·§03)이 있다.
//
// 실행: node scripts/check-coral-text-token.mjs
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const walk = (dir, out) => {
  let names
  try { names = readdirSync(dir) } catch { return out }
  for (const name of names) {
    if (name === 'node_modules' || name.startsWith('.')) continue
    const full = join(dir, name)
    if (statSync(full).isDirectory()) { walk(full, out); continue }
    if (/\.tsx?$/.test(name)) out.push(full)
  }
  return out
}
const strip = s => s
  .replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ''))
  .replace(/^[^\S\n]*\/\/.*$/gm, '')

const BAD_CLASS = /text-\[var\(--(?:coral|persimmon)\)\]/
const BAD_INLINE = /\bcolor:\s*['"]var\(--(?:coral|persimmon)\)['"]/
const violations = []
const files = walk('app', walk('components', []))
for (const f of files) {
  strip(readFileSync(f, 'utf8')).split('\n').forEach((line, i) => {
    if (BAD_CLASS.test(line)) {
      violations.push(`${f}:${i + 1} 글자색이 --coral 이다. 다크 카드 위 2.78:1 로 §28 하한 미달 — text-[var(--tc-text)] 를 쓴다(라이트 값은 같다).`)
    } else if (BAD_INLINE.test(line)) {
      violations.push(`${f}:${i + 1} 인라인 color 가 --coral 이다 — 'var(--tc-text)' 를 쓴다(라이트 값은 같다).`)
    }
  })
}

console.log(`[테라코타 글자 토큰] ${files.length}파일 검사 / 위반 ${violations.length}건`)
for (const v of violations.slice(0, 15)) console.error(`  - ${v}`)
if (violations.length > 15) console.error(`  ... 외 ${violations.length - 15}건`)
process.exit(violations.length > 0 ? 1 : 0)
