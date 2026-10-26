// 분류 관리 묶음 머리마다 바로가기 버튼과 도착 id 가 한 벌로 있고, 머리마다 '맨 위로' 가 바로가기 줄로 돌아가는지 지키는 감지망. 읽기 전용, 위반 시 exit 1.
//
// 2026-10-23 운영자 결정(가이드 §22 분류 관리 묶음 머리 · 묶음 바로가기). 탭 맨 위 줄의 버튼 하나가 묶음 머리 하나로 데려간다.
// 머리를 하나 더하고 목록(OPTION_GROUPS)을 안 고치면 그 묶음만 버튼이 없고, id 를 잃으면 버튼이 눌려도 아무 데도 안 간다.
//   ⓐ 묶음 목록 정본(OPTION_GROUPS)의 id 가 비지 않고 서로 다르다.
//   ⓑ 분류 관리 탭의 머리(<OptionGroupHead title=… />)가 목록과 같은 이름·같은 차례로 하나씩 선다.
//   ⓒ 머리가 목록에서 제 id 를 찾아 달고, 포커스를 받는다(tabIndex={-1}). 스크롤 여유(scroll-mt-4)를 든다.
//   ⓓ 바로가기 줄이 탭 맨 위(첫 머리 바로 앞, 사이에 아무것도 없이)에 서고, 버튼을 목록에서 만들어 라벨이 머리 글자 그대로이며 그 id 로 간다.
//   ⓔ 도착은 모션 축소 설정을 따르고 머리에 포커스를 준다. 넘침 페이드는 정본 마스크(globals.css data-fade-track)를 쓴다.
//   ⓕ 트랙 앞에 이동 단서 캡션 '바로가기'(11px · --seg-ink-off)가 선다. 상자 버튼 줄이 2차 탭·필터로 읽히지 않게 한다.
//   ⓖ 첫 머리를 뺀 머리마다 같은 줄에 '맨 위로' 글자 링크가 서고 탭 맨 끝에 하나 더 선다(2026-10-23 운영자 승인·독립 검수). 도착은 바로가기 줄(nav)이다.
//      링크는 상자 Btn 이 아니라 11px · --seg-ink-off 글자이고 꺾쇠(›)가 없으며 히트 44px 이고 h2 밖에 선다. 머리 줄의 히트 상자는 글자 아래 맞춤으로
//      위로 올려 제 묶음 첫 카드를 덮지 않는다. 도착은 스크롤러(.app-main)를 맨 위로 올리고 모션 축소를 따르며 nav 에 포커스를 준다.
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
// 바로가기 파일은 JSX 주석({/* */})을 줄째 먼저 걷는다. 주석 안만 비우면 여러 줄 주석의 닫는 } 가 줄 첫머리에 남아 함수 끝으로 읽힌다.
const nav = strip(readFileSync(NAV, 'utf8').replace(/^[^\S\n]*\{\/\*[\s\S]*?\*\/\}[^\S\n]*\n/gm, ''))
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
// 바로가기 줄 바로 다음이 첫 머리다. 그 사이에 안내 상자가 서면 '맨 위로' 로 돌아온 눈이 버튼 줄과 첫 묶음 사이에서 끊긴다
// (만료된 이사 안내 '분류 항목이 이 탭으로 모였습니다' 를 2026-10-23 운영자 승인으로 걷었다).
else if (heads.length && tab.slice(jumpAt + '<OptionGroupJumps />'.length, heads[0].at).replace(/\{\s*\}/g, '').trim()) violations.push(`${FORM} · 묶음 바로가기 줄과 첫 묶음 머리 사이에 다른 것이 섰다. 바로가기 줄 바로 다음이 첫 머리다.`)
const jumps = nav.match(/export function OptionGroupJumps\([\s\S]*?\n\}/)?.[0] ?? ''
if (!jumps) violations.push(`${NAV} · OptionGroupJumps 를 못 찾았다.`)
if (jumps && !/\{OPTION_GROUPS\.map\(g => \(\s*<Btn key=\{g\.id\} variant="secondary" size="sm"[\s\S]{0,200}onClick=\{\(\) => go\(g\.id\)\}>\s*\{g\.title\}\s*<\/Btn>/.test(jumps)) {
  violations.push(`${NAV} · 바로가기 버튼이 목록에서 정본 Btn(secondary sm)으로 만들어지지 않거나, 라벨이 머리 글자(g.title)가 아니거나, 그 id 로 가지 않는다.`)
}

// ⓔ
if (jumps && !/matchMedia\('\(prefers-reduced-motion: reduce\)'\)\.matches/.test(jumps)) violations.push(`${NAV} · 바로가기 도착이 모션 축소 설정을 안 본다.`)
if (jumps && !/head\.focus\(\{ preventScroll: true \}\)/.test(jumps)) violations.push(`${NAV} · 바로가기 도착이 머리에 포커스를 주지 않는다(키보드·화면 낭독기가 버튼 자리에 남는다).`)
if (jumps && !/data-fade-track/.test(jumps)) violations.push(`${NAV} · 바로가기 트랙이 넘침 페이드 표식(data-fade-track)을 잃었다.`)
// ⓕ 이동 단서 캡션. 상자 버튼 줄이 ViewTabs 밑에서 2차 탭·필터로 읽히지 않게 트랙 앞에 '바로가기' 캡션이 선다(2026-10-23 디자이너 검토).
//    색은 --seg-ink-off 다(--canvas 위 5.18:1, 2026-10-26 부터 --warm-muted 와 같은 값. 그 전에는 --warm-muted 가 4.11:1 미달이라 갈랐다). --warm-dark 는 버튼 글자와 같아 캡션이 여섯째 항목처럼 읽힌다.
const cap = jumps.match(/<p aria-hidden className="([^"]*)">바로가기<\/p>\s*<div ref=\{trackRef\} data-fade-track/)
if (jumps && !cap) violations.push(`${NAV} · 바로가기 줄 앞에 이동 단서 캡션('바로가기')이 없다. 상자 버튼이 2차 탭·필터로 읽힌다.`)
else if (cap && (!/text-\[0\.6875rem\]/.test(cap[1]) || !/text-\[var\(--seg-ink-off\)\]/.test(cap[1]))) violations.push(`${NAV} · 바로가기 캡션이 11px · --seg-ink-off 가 아니다(--canvas 위 --warm-muted 는 본문 하한 미달, --warm-dark 는 버튼 글자와 같아 위계가 없다).`)
// ⓖ 맨 위로. 머리 줄(OptionGroupHead)에 링크가 들어 있어야 머리 다섯이 모두 링크를 갖는다(ⓑ 가 머리가 이 컴포넌트만 거치는지 지킨다).
const NAV_ID = nav.match(/export const OPTION_GROUP_NAV_ID = '([^']*)'/)?.[1]
if (!NAV_ID || !/^[a-z][a-z0-9-]*$/.test(NAV_ID)) violations.push(`${NAV} · 바로가기 줄 id 정본(OPTION_GROUP_NAV_ID)이 없거나 꼴이 틀렸다.`)
else if (groups.some(g => g.id === NAV_ID)) violations.push(`${NAV} · 바로가기 줄 id '${NAV_ID}' 가 묶음 머리 id 와 겹친다.`)
if (jumps && !/<nav id=\{OPTION_GROUP_NAV_ID\} tabIndex=\{-1\} aria-label="분류 묶음 바로가기"/.test(jumps)) violations.push(`${NAV} · 바로가기 줄(nav)이 id={OPTION_GROUP_NAV_ID} 와 tabIndex={-1} 을 안 든다. '맨 위로' 가 돌아와도 포커스가 머리 링크에 남는다.`)
// 링크 정본은 TopLinkButton 하나다. 머리 줄과 탭 끝이 같은 글자 문법을 쓴다.
const link = nav.match(/function TopLinkButton\([\s\S]*?\n\}/)?.[0] ?? ''
const up = link.match(/<button type="button" onClick=\{toGroupNav\}\s+className=\{`\$\{className\} ([^`]*)`\}>\s*맨 위로\s*<\/button>/)
if (!up) violations.push(`${NAV} · '맨 위로' 글자 링크 정본(TopLinkButton: button, onClick={toGroupNav}, 글자는 '맨 위로' 만)을 못 찾았다.`)
else {
  const c = up[1]
  if (!/\bmin-h-\[44px\]/.test(c) || !/\bmin-w-\[44px\]/.test(c)) violations.push(`${NAV} · '맨 위로' 히트가 44px 아래다(min-h-[44px] · min-w-[44px]).`)
  if (!/text-\[0\.6875rem\]/.test(c) || !/text-\[var\(--seg-ink-off\)\]/.test(c)) violations.push(`${NAV} · '맨 위로' 가 바로가기 캡션과 같은 11px · --seg-ink-off 글자가 아니다(큰 글자·진한 색은 머리와 겨룬다).`)
  if (/\b(?:border|bg-|rounded-(?:md|lg|xl|full))/.test(c)) violations.push(`${NAV} · '맨 위로' 가 상자(테두리·바탕)를 입었다. 머리와 겨루지 않게 글자 링크로 둔다.`)
}
if (/맨 위로(?:\s|&nbsp;|<[^>]*>)*›/.test(nav)) violations.push(`${NAV} · '맨 위로' 에 꺾쇠(›)가 붙었다. 오른쪽 표시가 위로 가는 동작과 어긋난다.`)
// 머리 줄. 첫 머리는 바로가기 줄 바로 밑이라 링크가 없고, 나머지 머리는 링크를 든다. 히트 상자는 글자를 아래에 두어(items-end pb-1) 위로 선다.
const headUse = head.match(/\{title !== OPTION_GROUPS\[0\]\.title && <TopLinkButton className="([^"]*)" \/>\}/)
if (head && !headUse) violations.push(`${NAV} · 묶음 머리 줄이 '첫 머리를 뺀 머리마다 맨 위로'(title !== OPTION_GROUPS[0].title && <TopLinkButton />) 꼴이 아니다.`)
else if (headUse && !(/\bitems-end\b/.test(headUse[1]) && /\bpb-1\b/.test(headUse[1]) && /-mt-3\.5\b/.test(headUse[1]) && /-mb-1\.5\b/.test(headUse[1]))) {
  violations.push(`${NAV} · 머리 줄 '맨 위로' 의 히트 상자 자리가 바뀌었다(items-end pb-1 -mt-3.5 -mb-1.5). 가운데 맞춤이면 아래로 5.8px 넘쳐 제 묶음 첫 카드를 덮는다(2026-10-23 실측).`)
}
// 탭 맨 끝. 마지막 묶음 마지막 카드 뒤에 하나만 선다.
const endLink = nav.match(/export function OptionGroupTopLink\(\) \{[\s\S]*?\n\}/)?.[0] ?? ''
if (!/<TopLinkButton className="[^"]*" \/>/.test(endLink)) violations.push(`${NAV} · 탭 끝 맨 위로(OptionGroupTopLink)가 정본 TopLinkButton 을 쓰지 않는다.`)
const ends = [...tab.matchAll(/<OptionGroupTopLink \/>/g)]
if (ends.length !== 1) violations.push(`${FORM} · 분류 관리 탭 끝 맨 위로(<OptionGroupTopLink />)가 ${ends.length}개다. 하나만 둔다.`)
else if (!/^\s*(?:\{\s*\}\s*)*<\/div>\s*\)\}\s*(?:\{\s*\}\s*)*$/.test(tab.slice(ends[0].index + '<OptionGroupTopLink />'.length))) {
  violations.push(`${FORM} · 탭 끝 맨 위로가 탭 맨 끝(마지막 카드 뒤)에 있지 않다.`)
}
if (head && /<h2[\s\S]*?맨 위로[\s\S]*?<\/h2>/.test(head)) violations.push(`${NAV} · '맨 위로' 가 h2 안에 들었다. 머리 이름(낭독·목차)에 링크 글자가 섞인다.`)
if (head && /<Btn\b/.test(head)) violations.push(`${NAV} · 묶음 머리 줄에 상자 Btn 이 섰다. '맨 위로' 는 글자 링크다.`)
const toNav = nav.match(/function toGroupNav\(\) \{[\s\S]*?\n\}/)?.[0] ?? ''
if (!toNav) violations.push(`${NAV} · '맨 위로' 도착 함수(toGroupNav)를 못 찾았다.`)
else {
  if (!/document\.getElementById\(OPTION_GROUP_NAV_ID\)/.test(toNav)) violations.push(`${NAV} · '맨 위로' 의 도착이 바로가기 줄(OPTION_GROUP_NAV_ID)이 아니다.`)
  if (!/matchMedia\('\(prefers-reduced-motion: reduce\)'\)\.matches/.test(toNav)) violations.push(`${NAV} · '맨 위로' 가 모션 축소 설정을 안 본다.`)
  if (!/nav\.closest\('\.app-main'\)\?\.scrollTo\(\{ top: 0,/.test(toNav)) violations.push(`${NAV} · '맨 위로' 가 셸 스크롤러(.app-main)를 맨 위로 올리지 않는다.`)
  if (!/nav\.focus\(\{ preventScroll: true \}\)/.test(toNav)) violations.push(`${NAV} · '맨 위로' 가 바로가기 줄에 포커스를 주지 않는다(키보드·낭독기가 머리 자리에 남는다).`)
}
for (const side of ['right', 'left', 'both']) {
  if (!css.includes(`[data-fade-track][data-fade="${side}"]`)) violations.push(`${CSS} · 넘침 페이드 마스크에 [data-fade-track][data-fade="${side}"] 가 없다. 바로가기 줄 끝이 흐려지지 않는다.`)
}

if (violations.length) {
  console.error(`check-option-group-jump: 위반 ${violations.length}건`)
  for (const v of violations) console.error('  - ' + v)
  process.exit(1)
}
console.log(`check-option-group-jump: 통과 · 묶음 ${groups.length}개(${want}) 머리·버튼·id 한 벌, 둘째 머리부터와 탭 끝의 '맨 위로' 가 바로가기 줄(${NAV_ID})로`)
