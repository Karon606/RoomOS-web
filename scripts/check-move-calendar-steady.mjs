// 일정 탭 '전체' 축(모든 호실) 화면 감지망. 읽기 전용 소스 검사, 위반 시 exit 1.
//
// 왜 필요한가 (2026-10-19 운영자 승인 "추천대로", 호실 관리 > 일정 '전체'에 모든 호실).
//   조립 규칙은 scripts/test-move-calendar.ts 가 순수 함수로 지키고, 운영 데이터 대조는
//   check-move-calendar-drift 축 D 가 진다. 그 둘이 못 보는 것이 화면의 자리다. 소제목이 필터 축에도
//   서거나, '오늘로'가 다시 카드 오른쪽 아래(absolute)로 돌아가 첫 화면에서 사라지거나, 무변동 막대가
//   '퇴실일 미정'을 서른 몇 번 반복하거나, memo 를 깨는 인라인 함수가 돌아와도 눈으로는 회귀를 못 잡는다.
//
// 무엇을 보나 (축 여덟)
//   ① 소제목은 lib 정본(steadyHeading)이 자리와 문구를 낸다. 화면이 축을 따로 따지거나 문구를 짓지 않는다.
//   ② 무변동 거주 막대는 이름만 세운다(nameOnly). lib 라벨은 그대로라 title·aria 가 상태를 말한다.
//   ③ '오늘로'는 트랙 상자(grid 한 칸) 안 sticky 닻에 있다. absolute 로 돌아가면 첫 화면에서 사라진다.
//      카드가 overflow-hidden 이면 카드가 스크롤 컨테이너가 되어 닻이 영영 안 붙는다(clip 이어야 한다).
//   ④ 두 축 스크롤러 금지. 세로 스크롤러를 이 파일에 만들면 Android 터치 래치(신고 d8554128)가 돌아온다.
//   ⑤ 호실 열 긴 이름은 말줄임 + title(형제 좁은 호실 칸 문법).
//   ⑥ 카드 끝 안내 줄은 정본 문구(excludedRoomsNote)이고 카드 안(--cream 바탕)이다.
//   ⑦ RoomManageClient 가 MoveCalendar 에 인라인 함수를 안 넘긴다(memo 가 ?at= 마다 깨진다).
//   ⑧ 계속 공실인 무변동 행은 'N일 공실' 대신 '공실' 한 마디다.
//
// 실행: node scripts/check-move-calendar-steady.mjs
import { readFileSync } from 'node:fs'

const SRC = 'components/room-manage/MoveCalendar.tsx'
const CLIENT = 'app/(app)/room-manage/RoomManageClient.tsx'
const violations = []

/** 주석을 걷는다. 설명하려고 적은 낱말이 위반으로 잡히면 그물이 주석을 못 쓰게 만든다. */
const strip = s => s
  .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, '')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^[ \t]*\/\/.*$/gm, '')

const src = strip(readFileSync(SRC, 'utf8'))
const client = strip(readFileSync(CLIENT, 'utf8'))

/** marker 를 포함한 JSX 여는 태그 하나(중괄호 깊이와 따옴표를 센다. 속성값에 화살표 함수가 산다). */
function tagAround(text, needle) {
  const at = text.indexOf(needle)
  if (at < 0) return null
  const start = text.lastIndexOf('<', at)
  let depth = 0, q = null
  for (let i = start; i < text.length; i++) {
    const c = text[i]
    if (q) { if (c === q && text[i - 1] !== '\\') q = null; continue }
    if (c === '"' || c === "'" || c === '`') { q = c; continue }
    if (c === '{') depth++
    else if (c === '}') depth--
    else if (c === '>' && depth === 0) return text.slice(start, i + 1)
  }
  return null
}

/**
 * from(카드 여는 태그 자리)부터 at 까지 열린 div 의 깊이. 카드 자신이 1 이다.
 * 스스로 닫는 <div ... /> 는 세지 않는다(태그를 통째로 잘라 끝이 /> 인지 본다).
 */
function divDepth(text, from, at) {
  let depth = 0
  let i = from
  while (i < at) {
    const open = text.indexOf('<div', i)
    const close = text.indexOf('</div>', i)
    const next = Math.min(open < 0 ? Infinity : open, close < 0 ? Infinity : close)
    if (next === Infinity || next >= at) break
    if (next === close) { depth--; i = close + 6; continue }
    const tag = tagAround(text.slice(open), '<div') ?? ''
    if (!/\/>$/.test(tag)) depth++
    i = open + Math.max(4, tag.length)
  }
  return depth
}

// ── ① 소제목 ──
if (!/const heading = steadyHeading\(rows, axis\)/.test(src)) {
  violations.push(`${SRC}: 소제목 자리를 lib 정본 steadyHeading(rows, axis) 로 안 정한다. 축 판정이 화면에 사본으로 생긴다.`)
}
if (!/\{heading\?\.index === ri && \(/.test(src)) {
  violations.push(`${SRC}: 소제목 줄이 steadyHeading 이 낸 자리(heading.index)에만 서지 않는다. 필터 축에도 설 수 있다.`)
}
if (/변동 없음 \$\{/.test(src)) {
  violations.push(`${SRC}: '변동 없음 N실' 문구를 화면이 짓는다. 문구는 lib steadyHeading 한 곳이다.`)
}

// ── ② 무변동 막대 이름만 ──
if (!/const nameOnly = steady && bar\.kind === 'resident' && !bar\.planned/.test(src)) {
  violations.push(`${SRC}: 무변동 거주 막대 표식(nameOnly)이 없다. 서른 몇 줄이 '퇴실일 미정'을 반복한다.`)
}
if (!/bar\.stateLabel && !nameOnly \?/.test(src)) {
  violations.push(`${SRC}: full 모드 글자가 nameOnly 를 안 본다. 무변동 막대에 상태 문구가 붙는다.`)
}
if (!/steady=\{!!row\.steady\}/.test(src)) {
  violations.push(`${SRC}: 막대에 행 표식(steady)을 안 넘긴다.`)
}

// ── ③ '오늘로' 닻 ──
{
  const btn = tagAround(src, 'ref={todayBtnRef}')
  if (!btn) violations.push(`${SRC}: '오늘로' 버튼(ref={todayBtnRef})을 못 찾았다. 이 그물부터 고칠 것.`)
  else if (/\babsolute\b/.test(btn)) violations.push(`${SRC}: '오늘로'가 absolute 로 돌아갔다. 카드가 네 화면 남짓이라 첫 화면에서 사라진다.`)
  // 구조는 카드(overflow-clip) > 트랙 상자(grid 한 칸) > [스크롤러, sticky 닻] 이다. 닻이 움직일 수 있는
  // 범위는 자기를 담은 상자라, 닻이 트랙 상자 바로 안(카드 기준 깊이 2)이어야 머리·끝 줄을 안 덮는다.
  const btnAt = src.indexOf('ref={todayBtnRef}')
  const anchorAt = btnAt < 0 ? -1 : src.lastIndexOf('<div', btnAt)
  const anchor = anchorAt < 0 ? null : tagAround(src.slice(anchorAt), '<div')
  if (!anchor || !/\bsticky\b/.test(anchor) || !/gridArea: '1 \/ 1'/.test(anchor) || !/alignSelf: 'end'/.test(anchor)) {
    violations.push(`${SRC}: '오늘로'의 닻이 트랙과 같은 grid 칸(1 / 1)의 sticky 가 아니다. 화면 아래에 안 붙거나, 카드 머리·끝 줄을 덮는다.`)
  } else if (/\bfixed\b/.test(anchor)) {
    violations.push(`${SRC}: '오늘로' 닻이 fixed 다. 카드가 화면에 없을 때도 떠 있다.`)
  }
  if (!/gridArea: '1 \/ 1', overscrollBehaviorX/.test(src)) {
    violations.push(`${SRC}: 트랙 스크롤러가 닻과 같은 grid 칸(1 / 1)에 서지 않는다.`)
  }
  const cardAt = src.indexOf('<div className="rounded-xl overflow-clip"')
  if (cardAt < 0 || /rounded-xl overflow-hidden/.test(src)) {
    violations.push(`${SRC}: 카드 셸이 overflow-clip 이 아니다. hidden 이면 카드가 스크롤 컨테이너가 되어 안쪽 sticky 닻이 안 붙는다.`)
  } else if (anchorAt > 0) {
    const scrollAt = src.indexOf('<div ref={scrollRef}')
    const wrapAt = src.lastIndexOf('<div', scrollAt - 1)
    const wrap = wrapAt < 0 ? null : tagAround(src.slice(wrapAt), '<div')
    if (!wrap || !/className="grid grid-cols-1"/.test(wrap) || divDepth(src, cardAt, scrollAt) !== 2 || divDepth(src, cardAt, anchorAt) !== 2) {
      violations.push(`${SRC}: 스크롤러와 '오늘로' 닻이 카드 안 트랙 상자(grid 한 칸) 바로 안에 함께 서지 않는다. 닻이 카드 머리·끝 줄까지 올라간다(320px · 125% 실측).`)
    }
  }
}

// ── ④ 두 축 스크롤러 금지 ──
{
  const ys = src.match(/overflow-y-(auto|scroll)|overflow-(auto|scroll)\b|overflowY:\s*'(auto|scroll)'|overflow:\s*'(auto|scroll)'/g) ?? []
  if (ys.length > 0) violations.push(`${SRC}: 세로 스크롤러가 생겼다(${ys.join(', ')}). 스크롤러는 셸 main 하나여야 한다(두 축 스크롤러 Android 래치, 신고 d8554128).`)
  const xs = src.match(/overflow-x-auto/g) ?? []
  if (xs.length !== 1) violations.push(`${SRC}: 가로 스크롤러가 ${xs.length}개다(트랙 하나여야 한다).`)
}

// ── ⑤ 호실 열 말줄임 ──
{
  const room = tagAround(src, 'className="mc-room sticky left-0 z-20 flex')
  if (!room || !/title=\{fmtRoomNo\(row\.roomNo\)\}/.test(room) || !/\bmin-w-0\b/.test(room)) {
    violations.push(`${SRC}: 호실 열 버튼에 title·min-w-0 이 없다. 긴 호실명이 66px 칸을 넘친다.`)
  }
  if (!/<span className="min-w-0 truncate">\{fmtRoomNo\(row\.roomNo\)\}<\/span>/.test(src)) {
    violations.push(`${SRC}: 호실 열 글자가 말줄임(truncate) 상자 안에 있지 않다.`)
  }
}

// ── ⑥ 카드 끝 안내 줄 ──
if (!/const excludedNote = excludedRoomsNote\(data\.excludedRoomCount\)/.test(src)) {
  violations.push(`${SRC}: 안내 줄이 정본 excludedRoomsNote 를 안 쓴다.`)
}
{
  const cardAt = src.indexOf('<div className="rounded-xl overflow-clip"')
  const noteAt = src.indexOf('{excludedNote && (')
  const noteTag = noteAt < 0 ? null : tagAround(src.slice(noteAt), '<p ')
  if (noteAt < 0 || cardAt < 0 || noteAt < cardAt || divDepth(src, cardAt, noteAt) !== 1 || !noteTag || !/borderTop/.test(noteTag)) {
    violations.push(`${SRC}: 안내 줄이 카드 안 끝 줄(카드 바로 안, 구분선 1px)이 아니다. 카드 밖 --canvas 위에서는 --ink-m 이 AA 미달이다(라이트 4.11:1).`)
  }
}

// ── ⑦ memo 를 깨는 인라인 함수 ──
{
  const tag = tagAround(client, '<MoveCalendar ')
  if (!tag) violations.push(`${CLIENT}: <MoveCalendar> 를 못 찾았다. 이 그물부터 고칠 것.`)
  else if (/=>/.test(tag)) violations.push(`${CLIENT}: MoveCalendar 에 인라인 함수를 넘긴다. ?at= 이 바뀔 때마다 memo 가 깨져 트랙 수백 칸이 다시 그려진다.`)
  if (!/const goWorksTab = useCallback\(/.test(client)) violations.push(`${CLIENT}: '작업 탭에서 보기' 문이 useCallback 으로 고정되지 않았다.`)
}

// ── ⑧ 계속 공실 무변동 행 ──
if (!/\{row\.steady && row\.bars\.length === 0 && \(/.test(src) || !/\{!\(row\.steady && row\.bars\.length === 0\) && row\.gaps\.map\(/.test(src)) {
  violations.push(`${SRC}: 계속 공실인 무변동 행이 'N일 공실' 가운데 캡션을 그대로 단다('공실' 한 마디여야 한다).`)
}

if (violations.length) {
  console.error(`\n[일정 '전체' 축 화면] 위반 ${violations.length}건`)
  for (const v of violations) console.error(`  - ${v}`)
  console.error('')
  process.exit(1)
}
console.log("[일정 '전체' 축 화면] 위반 0건")
