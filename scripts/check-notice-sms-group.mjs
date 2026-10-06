// 단체 공지 대상 그룹(입주자 | 문의·예약)의 배선을 지키는 소스 그물 — 읽기 전용, 위반 시 exit 1
//
// 2026-10-06 운영자 승인. 단체 공지가 문의·예약자(리드)에게도 갈 수 있게 되면서, 잘못 배선되면
// 입주자 공지가 문의자에게 새거나(기본 그룹·옛 드래프트) 선착순 순서가 흐트러지는(정렬 사본) 길이 열렸다.
// 순수 판정은 scripts/test-notice-targets.ts 가 쥐고, 여기는 그 판정을 **부르는 자리**를 본다.
//   ⓐ 서버 조회 where 가 두 상수(CURRENT_OCCUPANCY_STATUSES · WISH_LEAD_STATUSES)를 참조한다.
//      noticeSms.ts 안에 계약 상태 문자열 리터럴이 하나라도 있으면 위반(사본 금지).
//      확정 제외(reservationConfirmedAt: null)는 리드 갈래에만 — 거주 갈래에 걸면 예약 확정 뒤 입실한
//      입주자가 빠진다(2026-10-06 실측 ACTIVE 3건).
//   ⓑ 서버가 정본 classifyNoticeTarget 으로 가르고 그 결과를 읽는다.
//   ⓒ 받는 번호는 정본 pickTenantPhoneWithFallback(..., ['PHONE']) 그대로(문자 갈래, 유선 제외).
//   ⓓ 모달 기본 그룹은 리터럴 'resident'. 옛 드래프트(그룹 없음)·모르는 값은 'resident' 로 연다.
//      '새로 작성'도 'resident' 로 돌아간다.
//   ⓔ 목록·순번·발송 순서는 정본(noticeGroupRows · leadRanks)이 세우고, 받는 사람은 보이는 목록 순서다
//      — 첫 문자 묶음이 먼저 문의한 사람이어야 우선권이 선다.
//   ⓕ 문의 단계 판정(inquiryStageOf)은 lib/wishMatch 한 곳에만 있다(입주자 관리 로컬 사본 금지).
//   ⓖ 정본 lib/noticeTargets 가 두 상수를 읽고, 리드 갈래가 확정 시각을 본다.
//   ⓗ 웹디자이너 패스(2026-10-06)가 고친 자리가 되돌아가지 않는다.
//      날짜는 정본 leadSubLine·inquiryRangeLabel(해가 다를 때만 연도)만 — 모달에 맨 fmtMD 금지.
//      보조줄·화면에 '안내함'(발송 시도 기록에 단정 어휘) 금지. 문의일 날짜 칸은 좁은 폭에서 1열.
//      순번 칸은 목록과 제외 패널이 같은 한 벌(w-6 우정렬 tnum). 예시 템플릿 묶음 제목은 '예시 문구'.
//
// 실행: node scripts/check-notice-sms-group.mjs
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8')
// 주석은 지운다(줄 수는 유지). 주석 속 예시 문자열이 판정을 흔들면 안 된다.
const strip = raw => raw
  .replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ''))
  .replace(/^[^\S\n]*\/\/.*$/gm, '')
  .replace(/([^:'"`])\/\/[^\n'"`]*$/gm, '$1')
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, m => m.replace(/[^\n]/g, ''))

const SERVER = 'app/(app)/tenants/noticeSms.ts'
const MODAL = 'components/NoticeSmsModal.tsx'
const LIB = 'lib/noticeTargets.ts'
const fails = []

/** `export async function name(` 부터 짝 맞는 본문 끝까지. 못 찾으면 null. */
function fnBody(src, name) {
  const at = src.search(new RegExp(`(?:export\\s+)?(?:async\\s+)?function\\s+${name}\\s*\\(`))
  if (at < 0) return null
  // 인자 괄호를 짝으로 넘고(인자 타입에 { } 가 있을 수 있다), 그 뒤 줄 끝의 { 가 본문이다(반환 타입의 { } 는 건넌다).
  const paren = src.indexOf('(', at)
  const afterParams = paren + balanced(src, paren).length
  const rel = src.slice(afterParams).search(/\{[^\S\n]*\n/)
  if (rel < 0) return null
  const open = afterParams + rel
  let depth = 0
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth++
    else if (src[i] === '}' && --depth === 0) return src.slice(at, i + 1)
  }
  return null
}

/** 여는 괄호 위치에서 짝 맞는 닫는 괄호까지. */
function balanced(src, openAt) {
  const pair = { '{': '}', '(': ')', '[': ']' }
  const o = src[openAt], c = pair[o]
  let depth = 0
  for (let i = openAt; i < src.length; i++) {
    if (src[i] === o) depth++
    else if (src[i] === c && --depth === 0) return src.slice(openAt, i + 1)
  }
  return ''
}

// ── ⓐ ⓑ ⓒ 서버 ──
{
  const src = strip(read(SERVER))
  const STATUS_LIT = /['"`](ACTIVE|CHECKOUT_PENDING|WAITING_TOUR|TOUR_DONE|RESERVED|CANCELLED|CHECKED_OUT|NON_RESIDENT)['"`]/g
  let m
  while ((m = STATUS_LIT.exec(src))) {
    fails.push(`ⓐ ${SERVER}:${src.slice(0, m.index).split('\n').length} 계약 상태 리터럴 ${m[0]} — lib/leaseStatus·lib/wishMatch 상수를 참조한다(사본 금지)`)
  }
  const body = fnBody(src, 'getNoticeSmsTargets')
  if (!body) {
    fails.push(`ⓐ ${SERVER} 에서 getNoticeSmsTargets 를 못 찾았다 — 모양이 바뀌었으면 이 그물부터 고친다`)
  } else {
    const fm = body.indexOf('leaseTerm.findMany(')
    const whereAt = fm < 0 ? -1 : body.indexOf('where:', fm)
    const where = whereAt < 0 ? '' : balanced(body, body.indexOf('{', whereAt))
    if (!where) fails.push(`ⓐ getNoticeSmsTargets 의 leaseTerm.findMany where 를 못 찾았다`)
    else {
      // 갈래를 객체 단위로 가른다 — 두 상수가 각자 어느 갈래에 있고 확정 제외가 어디에 붙었는지 본다.
      const branches = []
      const orAt = where.indexOf('OR:')
      if (orAt >= 0) {
        const arr = balanced(where, where.indexOf('[', orAt))
        let i = 1
        while (i < arr.length) {
          const o = arr.indexOf('{', i)
          if (o < 0) break
          const b = balanced(arr, o)
          branches.push(b)
          i = o + b.length
        }
      }
      const resident = branches.find(b => /\bCURRENT_OCCUPANCY_STATUSES\b/.test(b))
      const lead = branches.find(b => /\bWISH_LEAD_STATUSES\b/.test(b))
      if (!resident) fails.push(`ⓐ where 의 거주 갈래가 CURRENT_OCCUPANCY_STATUSES 를 참조하지 않는다`)
      if (!lead) fails.push(`ⓐ where 의 리드 갈래가 WISH_LEAD_STATUSES 를 참조하지 않는다`)
      if (lead && !/reservationConfirmedAt:\s*null/.test(lead)) {
        fails.push(`ⓐ 리드 갈래에 reservationConfirmedAt: null 이 없다 — 예약 확정자(이미 예약금을 낸 사람)에게 선착순 안내가 간다`)
      }
      if (resident && /reservationConfirmedAt/.test(resident)) {
        fails.push(`ⓐ 거주 갈래가 reservationConfirmedAt 을 거른다 — 예약 확정 뒤 입실한 입주자가 공지에서 빠진다`)
      }
      if (/reservationConfirmedAt/.test(where.replace(lead ?? '\u0000', ''))) {
        fails.push(`ⓐ 확정 제외가 리드 갈래 밖(where 공통)에 걸렸다 — 거주자까지 빠진다`)
      }
    }
    if (!/const\s+cls\s*=\s*classifyNoticeTarget\(/.test(body) || !/\bcls\.group\b/.test(body) || !/if\s*\(\s*!cls\b/.test(body)) {
      fails.push(`ⓑ getNoticeSmsTargets 가 classifyNoticeTarget 결과로 거르고 그룹을 읽지 않는다 — 조회가 넓어진 만큼 확정자·방 없는 거주가 샌다`)
    }
    if (!/phone:\s*trimPickedPhone\(\s*pickTenantPhoneWithFallback\([^)]*\[\s*'PHONE'\s*\]\s*\)\s*\)/.test(body)) {
      fails.push(`ⓒ 받는 번호가 정본 pickTenantPhoneWithFallback(..., ['PHONE']) 를 거치지 않는다`)
    }
  }
}

// ── ⓓ ⓔ 모달 ──
{
  const src = strip(read(MODAL))
  if (!/useState<NoticeGroup>\(\s*'resident'\s*\)/.test(src)) {
    fails.push(`ⓓ ${MODAL} 기본 그룹이 리터럴 'resident' 가 아니다 — 공지 창을 열자마자 문의자에게 갈 수 있다`)
  }
  const restore = (() => { const at = src.indexOf('= loadDraft()'); return at < 0 ? '' : src.slice(at, at + 1200) })()
  if (!/d\.group\s*===\s*'lead'\s*\?\s*'lead'\s*:\s*'resident'/.test(restore)) {
    fails.push(`ⓓ 드래프트 복원이 그룹 없는 옛 드래프트·모르는 값을 'resident' 로 열지 않는다`)
  }
  const reset = fnBody(src, 'resetDraft') ?? (() => { const at = src.indexOf('const resetDraft'); return at < 0 ? '' : balanced(src, src.indexOf('{', src.indexOf('=>', at))) })()
  if (!/setGroup\(\s*'resident'\s*\)/.test(reset)) {
    fails.push(`ⓓ '새로 작성'(resetDraft)이 그룹을 'resident' 로 돌리지 않는다`)
  }
  if (!/const\s+shownTargets\s*=\s*noticeGroupRows\(/.test(src)) {
    fails.push(`ⓔ 보이는 목록이 정본 noticeGroupRows 를 거치지 않는다 — 선착순 정렬·문의일 범위가 사본이 된다`)
  }
  if (!/leadRanks\(/.test(src)) fails.push(`ⓔ 순번이 정본 leadRanks 를 거치지 않는다`)
  if (!/const\s+recipients\s*=\s*shownTargets\.filter\(/.test(src)) {
    fails.push(`ⓔ 받는 사람이 보이는 목록 순서를 따르지 않는다 — 첫 문자 묶음이 먼저 문의한 사람이 아니게 된다`)
  }
}

// ── ⓗ 웹디자이너 패스 ──
{
  const src = strip(read(MODAL))
  if (/\bfmtMD\(/.test(src)) fails.push(`ⓗ ${MODAL} 가 fmtMD 를 직접 쓴다 — 지난해 문의가 연도 없이 최근처럼 보인다(정본 leadSubLine·inquiryRangeLabel)`)
  if (!/leadSubLine\(t\)/.test(src) || !/inquiryRangeLabel\(range\)/.test(src)) {
    fails.push(`ⓗ 보조줄·문의일 칩이 정본 leadSubLine·inquiryRangeLabel 을 거치지 않는다`)
  }
  if (/안내함/.test(src) || /안내함/.test(strip(read(LIB)))) fails.push(`ⓗ '안내함' — 발송 시도 기록이라 단정 어휘를 쓰지 않는다('공지 M/D')`)
  const inq = (() => { const at = src.indexOf('editing === INQ_KEY'); return at < 0 ? '' : src.slice(at, at + 3000) })()
  if (!/grid-cols-1\s+min-\[\d+px\]:grid-cols-2/.test(inq)) {
    fails.push(`ⓗ 문의일 날짜 칸이 좁은 폭에서도 2열이다 — 카드 안이라 360px 에서 날짜가 잘린다`)
  }
  const rankCls = (src.match(/const\s+RANK_SLOT_CLS\s*=\s*'([^']*)'/) ?? [])[1] ?? ''
  if (!/\bw-6\b/.test(rankCls) || !/\btext-right\b/.test(rankCls) || !/\btabular-nums\b/.test(rankCls)) {
    fails.push(`ⓗ 순번 칸(RANK_SLOT_CLS)이 w-6 우정렬 tnum 이 아니다`)
  }
  if ((src.match(/slotCls=\{slotCls\}/g) ?? []).length < 2 || !/<span className=\{slotCls\}>\{slotOf\(t\)\}<\/span>/.test(src)) {
    fails.push(`ⓗ 목록과 제외 패널(두 자리)이 같은 순번 칸을 쓰지 않는다`)
  }
  if (!/<optgroup label="예시 문구">/.test(src) || /기본 문구/.test(src)) fails.push(`ⓗ 예시 템플릿 묶음 제목이 '예시 문구'가 아니다`)
}

// ── ⓕ 단계 판정 한 곳 ──
{
  const hits = []
  const walk = dir => {
    for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
      if (e.name === 'node_modules' || e.name.startsWith('.')) continue
      const p = path.join(dir, e.name)
      if (e.isDirectory()) walk(p)
      else if (/\.tsx?$/.test(e.name) && /function\s+inquiryStageOf\b/.test(strip(read(p)))) hits.push(p)
    }
  }
  for (const d of ['app', 'components', 'lib']) walk(d)
  if (hits.length !== 1 || hits[0] !== 'lib/wishMatch.ts') {
    fails.push(`ⓕ inquiryStageOf 정의가 lib/wishMatch.ts 한 곳이 아니다: ${hits.join(', ') || '없음'}`)
  }
}

// ── ⓖ 정본 ──
{
  const src = strip(read(LIB))
  const body = fnBody(src, 'classifyNoticeTarget')
  if (!body) fails.push(`ⓖ ${LIB} 에서 classifyNoticeTarget 을 못 찾았다`)
  else {
    if (!/CURRENT_OCCUPANCY_STATUSES/.test(body)) fails.push(`ⓖ classifyNoticeTarget 이 CURRENT_OCCUPANCY_STATUSES 를 안 읽는다`)
    if (!/WISH_LEAD_STATUSES[\s\S]{0,120}!l\.reservationConfirmedAt/.test(body)) {
      fails.push(`ⓖ classifyNoticeTarget 의 리드 갈래가 확정 시각(!l.reservationConfirmedAt)을 안 본다`)
    }
    if (!/inquiryStageOf\(/.test(body)) fails.push(`ⓖ classifyNoticeTarget 이 단계를 정본 inquiryStageOf 로 정하지 않는다`)
  }
}

if (fails.length) {
  console.error(`check-notice-sms-group: 위반 ${fails.length}건`)
  for (const f of fails) console.error('  ✗ ' + f)
  process.exit(1)
}
console.log('check-notice-sms-group: 통과 (서버 where 두 상수·확정 제외 리드 한정·정본 분류·번호 정본 · 모달 기본 resident·드래프트 복원·정렬 정본 · 단계 판정 한 곳 · 디자이너 패스 표기·칸)')
