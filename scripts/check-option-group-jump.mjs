// 분류 관리 묶음 머리마다 바로가기 버튼과 도착 id 가 한 벌로 있는지 지키는 감지망. 읽기 전용, 위반 시 exit 1.
//
// 2026-10-23 운영자 결정(가이드 §22 분류 관리 묶음 머리 · 묶음 바로가기). 탭 맨 위 줄의 버튼 하나가 묶음 머리 하나로 데려간다.
// 머리를 하나 더하고 목록(OPTION_GROUPS)을 안 고치면 그 묶음만 버튼이 없고, id 를 잃으면 버튼이 눌려도 아무 데도 안 간다.
//   ⓐ 묶음 목록 정본(OPTION_GROUPS)의 id 가 비지 않고 서로 다르다.
//   ⓑ 분류 관리 탭의 머리(<OptionGroupHead title=… />)가 목록과 같은 이름·같은 차례로 하나씩 선다.
//   ⓒ 머리가 목록에서 제 id 를 찾아 달고, 포커스를 받는다(tabIndex={-1}). 스크롤 여유(scroll-mt-4)를 든다.
//   ⓓ 바로가기 줄이 탭 맨 위(첫 머리 앞)에 서고, 버튼을 목록에서 만들어 라벨이 머리 글자 그대로이며 그 id 로 간다.
//   ⓔ 도착은 모션 축소 설정을 따르고 머리에 포커스를 준다. 넘침 페이드는 정본 마스크(globals.css data-fade-track)를 쓴다.
//
// 실행: node scripts/check-option-group-jump.mjs
import { readFileSync } from 'node:fs'

const NAV = 'app/(app)/settings/OptionGroupNav.tsx'
const FORM = 'app/(app)/settings/SettingsForm.tsx'
const CSS = 'app/globals.css'
const strip = s => s
  .replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ''))
  .replace(/^[^\S\n]*\/\/.*$/gm, '')
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
const nav = strip(readFileSync(NAV, 'utf8'))
const form = strip(readFileSync(FORM, 'utf8'))
const css = readFileSync(CSS, 'utf8')
const violations = []

// ⓐ
const listSrc = nav.match(/export const OPTION_GROUPS = \[([\s\S]*?)\] as const/)?.[1] ?? ''
const groups = [...listSrc.matchAll(/\{ title: '([^']+)', id: '([^']*)' \}/g)].map(m => ({ title: m[1], id: m[2] }))
if (groups.length === 0) violations.push(`${NAV} · 묶음 목록 정본 OPTION_GROUPS 를 못 읽었다({ title, id } 꼴).`)
for (const g of groups) if (!/^[a-z][a-z0-9-]*$/.test(g.id)) violations.push(`${NAV} · '${g.title}' 묶음 id '${g.id}' 가 비었거나 영문 소문자·숫자·하이픈 꼴이 아니다.`)
const dupId = groups.map(g => g.id).filter((id, i, a) => a.indexOf(id) !== i)
if (dupId.length) violations.push(`${NAV} · 묶음 id 가 겹친다(${dupId.join(', ')}). 버튼 둘이 한 머리로 간다.`)

// ⓑ
const start = form.indexOf("{tab === 'options' && (")
const end = form.indexOf("{tab === 'pricing' && (")
const tab = start >= 0 && end > start ? form.slice(start, end) : ''
if (!tab) violations.push(`${FORM} · 분류 관리 탭 구간을 못 찾았다.`)
const heads = [...tab.matchAll(/<OptionGroupHead title="([^"]+)" \/>/g)].map(m => ({ title: m[1], at: m.index }))
const want = groups.map(g => g.title).join(' / ')
const got = heads.map(h => h.title).join(' / ')
if (want !== got) violations.push(`${FORM} · 분류 관리 묶음 머리(${got || '없음'})가 바로가기 목록(${want || '없음'})과 같은 이름·차례가 아니다. 버튼 없는 머리나 머리 없는 버튼이 생긴다.`)
if (/<h2[^>]*>\s*(?:호실|입주자|돈|청소·작업|재고·비품)\s*<\/h2>/.test(tab)) violations.push(`${FORM} · 분류 관리 탭에 OptionGroupHead 를 거치지 않은 묶음 머리 h2 가 있다(id 가 없어 바로가기가 못 간다).`)

// ⓒ
const head = nav.match(/export function OptionGroupHead\([\s\S]*?\n\}/)?.[0] ?? ''
if (!head) violations.push(`${NAV} · OptionGroupHead 를 못 찾았다.`)
if (head && !/OPTION_GROUPS\.find\(g => g\.title === title\)\?\.id/.test(head)) violations.push(`${NAV} · OptionGroupHead 가 목록에서 제 id 를 찾지 않는다.`)
if (head && !/<h2 id=\{id\} tabIndex=\{-1\}/.test(head)) violations.push(`${NAV} · 묶음 머리 h2 가 id 와 tabIndex={-1} 을 안 든다. 바로가기가 도착해도 포커스가 버튼에 남는다.`)
if (head && !/\bscroll-mt-4\b/.test(head)) violations.push(`${NAV} · 묶음 머리가 scroll-mt-4 를 잃었다. 도착한 머리가 스크롤러 위 끝에 붙는다.`)
if (head && !/title: OptionGroupTitle/.test(head)) violations.push(`${NAV} · OptionGroupHead 의 title 이 목록 타입(OptionGroupTitle)이 아니다. 목록에 없는 머리를 타입이 못 막는다.`)

// ⓓ
const jumpAt = tab.indexOf('<OptionGroupJumps />')
if (jumpAt < 0) violations.push(`${FORM} · 분류 관리 탭에 묶음 바로가기 줄(<OptionGroupJumps />)이 없다.`)
else if (heads.length && jumpAt > heads[0].at) violations.push(`${FORM} · 묶음 바로가기 줄이 첫 묶음 머리 뒤에 선다. 탭 맨 위에 둔다.`)
const jumps = nav.match(/export function OptionGroupJumps\([\s\S]*?\n\}/)?.[0] ?? ''
if (!jumps) violations.push(`${NAV} · OptionGroupJumps 를 못 찾았다.`)
if (jumps && !/\{OPTION_GROUPS\.map\(g => \(\s*<Btn key=\{g\.id\} variant="secondary" size="sm"[\s\S]{0,200}onClick=\{\(\) => go\(g\.id\)\}>\s*\{g\.title\}\s*<\/Btn>/.test(jumps)) {
  violations.push(`${NAV} · 바로가기 버튼이 목록에서 정본 Btn(secondary sm)으로 만들어지지 않거나, 라벨이 머리 글자(g.title)가 아니거나, 그 id 로 가지 않는다.`)
}

// ⓔ
if (jumps && !/matchMedia\('\(prefers-reduced-motion: reduce\)'\)\.matches/.test(jumps)) violations.push(`${NAV} · 바로가기 도착이 모션 축소 설정을 안 본다.`)
if (jumps && !/head\.focus\(\{ preventScroll: true \}\)/.test(jumps)) violations.push(`${NAV} · 바로가기 도착이 머리에 포커스를 주지 않는다(키보드·화면 낭독기가 버튼 자리에 남는다).`)
if (jumps && !/data-fade-track/.test(jumps)) violations.push(`${NAV} · 바로가기 트랙이 넘침 페이드 표식(data-fade-track)을 잃었다.`)
for (const side of ['right', 'left', 'both']) {
  if (!css.includes(`[data-fade-track][data-fade="${side}"]`)) violations.push(`${CSS} · 넘침 페이드 마스크에 [data-fade-track][data-fade="${side}"] 가 없다. 바로가기 줄 끝이 흐려지지 않는다.`)
}

if (violations.length) {
  console.error(`check-option-group-jump: 위반 ${violations.length}건`)
  for (const v of violations) console.error('  - ' + v)
  process.exit(1)
}
console.log(`check-option-group-jump: 통과 · 묶음 ${groups.length}개(${want}) 머리·버튼·id 한 벌`)
