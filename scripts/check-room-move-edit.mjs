// 이사일을 고치는 길이 막히지 않았는지 보는 감지망 — 읽기 전용, 위반 시 exit 1.
//
// 왜 필요한가. 화면이 '방이 비는 날'과 '실제로 들어가는 날'을 한 값으로 접어 두어, 청소 때문에
// 이사를 하루 미루려는데 고칠 자리가 없었다(2026-08-31 운영자 급건, 404호).
//
// 그리고 그 길은 두 단계에 다 있어야 한다. 예약 상태에서만 고칠 수 있으면, 입실 처리를 마친
// 순간 입실을 적용취소하고 처음부터 다시 짜는 것이 유일한 길이 된다.
//
// 축은 셋이다.
//   ⓐ 예약 단계 — 일정 시트가 이사일을 상태로 쥐고 사람이 고친다(파생값 박기 금지).
//   ⓑ 입실 단계 — 경계 이동 액션과 그 적용취소가 있고, 화면에 진입점이 있다.
//   ⓒ 경계 이동이 겹침 판정과 연속성 검증을 지난다.
//
// 실행: node scripts/check-room-move-edit.mjs
import { readFileSync } from 'node:fs'

const violations = []

// ⓐ 예약 단계.
{
  const f = 'components/tenant/RoomScheduleSheet.tsx'
  const src = readFileSync(f, 'utf8')
  if (/const endAt = opts\?\.mainAvailableFrom \?\? null/.test(src)) {
    violations.push(`${f} — 이사일이 서버 파생값으로 박혀 사람이 못 고친다. 청소나 사정으로 미룰 길이 없어진다.`)
  }
  if (!/setEndEdit/.test(src)) {
    violations.push(`${f} — 이사일을 고치는 상태가 없다.`)
  }
}

// ⓑ 입실 단계.
{
  const f = 'app/(app)/tenants/actions.ts'
  const src = readFileSync(f, 'utf8')
  for (const [name, re] of [
    ['경계 이동', /export async function changeRoomMoveDate\b/],
    ['경계 이동 적용취소', /export async function undoChangeRoomMoveDate\b/],
  ]) {
    if (!re.test(src)) {
      violations.push(`${f} — '${name}' 이 없다. 입실 처리를 마치면 이사일을 못 고쳐 입실을 무르는 것이 유일한 길이 된다.`)
    }
  }
  const body = readFileSync('components/entity-modal/bodies/TenantBody.tsx', 'utf8')
  if (!/changeRoomMoveDate\(/.test(body)) {
    violations.push('components/entity-modal/bodies/TenantBody.tsx — 이사일 바꾸기 진입점이 없다. 서버에만 있으면 아무도 못 쓴다.')
  }
}

// ⓒ 경계 이동이 검증을 지나는가.
{
  const f = 'app/(app)/tenants/actions.ts'
  const src = readFileSync(f, 'utf8')
  const fn = src.match(/export async function changeRoomMoveDate[\s\S]*?\n\}\n/)
  if (fn) {
    if (!/roomScheduleClash\(/.test(fn[0])) {
      violations.push(`${f} — 경계 이동이 겹침 판정을 안 지난다. 임시 호실에 하루 더 머무는 동안 남의 예약과 부딪힐 수 있다.`)
    }
    if (!/validateRoomSchedule\(/.test(fn[0])) {
      violations.push(`${f} — 경계 이동이 연속성 검증을 안 지난다. 빈틈이나 겹침이 있는 일정이 저장된다.`)
    }
  }
}

// ⓓ 입실 처리 뒤에도 남은 이사 계획이 캘린더에 서는가 (2026-08-31 운영자 지적).
//    종전에는 실제 거주 구간이 하나라도 생기면 계획을 통째로 버렸다. 그래서 임시 호실에 입실
//    처리를 하는 순간 계약 호실 막대가 사라졌다. 402호에 사람이 있는 것은 보이는데 그 사람이
//    며칠 뒤 404호로 온다는 사실이 방 기준 화면 어디에도 안 남았다.
{
  const f = 'lib/moveCalendarData.ts'
  const src = readFileSync(f, 'utf8')
  if (/roomStays\.length > 0\)\s*return l/.test(src)) {
    violations.push(`${f} — 실제 구간이 있으면 계획을 통째로 버린다. 입실 처리하는 순간 앞으로 갈 방의 막대가 캘린더에서 사라진다.`)
  }
  if (!/const rest = plan\.filter/.test(src)) {
    violations.push(`${f} — 아직 안 옮긴 구간을 예정으로 잇지 않는다.`)
  }
}


// ⓔ 오늘 이사 — 일정보다 일찍 옮기는 길과 되돌리는 길 (2026-09-01 운영자 요청).
//
//    청소가 일찍 끝나 예정일 전에 옮기는 일은 실무에서 반복된다. 종전에는 이사일을 오늘로
//    바꾸고 홈 알림에서 확인하는 두 단계 우회뿐이었고, 이사 처리 자체에는 되돌릴 길이 없어
//    방 하나 잘못 옮기면 입실 전체를 물러야 했다(§16).
{
  const f = 'app/(app)/tenants/actions.ts'
  const src = readFileSync(f, 'utf8')
  if (!/export async function undoRoomMove\b/.test(src)) {
    violations.push(`${f} — 이사 기록 적용취소(undoRoomMove)가 없다. 잘못 옮기면 입실 전체를 물러야 한다.`)
  }
  const btn = 'components/tenant/MoveRoomNowButton.tsx'
  let bsrc = ''
  try { bsrc = readFileSync(btn, 'utf8') } catch { /* 아래 위반으로 잡는다 */ }
  if (!/changeRoomMoveDate\(/.test(bsrc) || !/advanceRoomSchedule\(/.test(bsrc) || !/undoRoomMove\(/.test(bsrc)) {
    violations.push(`${btn} — 오늘 이사 정본이 경계 이동·이사 기록·적용취소를 다 갖추지 않았다.`)
  }
  // 실패 시 반쪽 상태 금지 — 경계만 당겨지고 이사가 안 되면 되돌려야 한다.
  // 호출 이름만 찾으면 성글다 — 적용취소 쪽의 같은 호출이 검사를 가린다(역주입에서 실제로 통과했다).
  // **실패 분기(!r.ok) 안**에 있는지를 본다.
  const failBlock = bsrc.match(/if \(!r\.ok\) \{[\s\S]*?\n      \}/)
  if (bsrc && !(failBlock && /undoChangeRoomMoveDate\(boundaryUndo\)/.test(failBlock[0]))) {
    violations.push(`${btn} — 이사 실패 시 앞당긴 경계를 안 되돌린다. 일정만 오늘로 바뀐 반쪽 상태가 남는다.`)
  }
  // 두 표면이 정본을 쓴다 — 각자 적으면 문구·되돌리기가 갈린다.
  for (const [name, sf] of [
    ['프리즘 일정 행', 'components/entity-modal/bodies/TenantBody.tsx'],
    ['입주자 수정 폼', 'app/(app)/tenants/TenantClient.tsx'],
  ]) {
    if (!/MoveRoomNowButton/.test(readFileSync(sf, 'utf8'))) {
      violations.push(`${sf} — '${name}' 에 오늘 이사 정본 버튼이 없다.`)
    }
  }
  // 홈 알림 이사 확인도 같은 되돌리기를 쓴다 — 이사 처리에 undo 없는 클래스가 되살아나면 안 된다.
  if (!/undoRoomMove\(/.test(readFileSync('app/(app)/dashboard/DashboardClient.tsx', 'utf8'))) {
    violations.push('app/(app)/dashboard/DashboardClient.tsx — 홈 이사 확인에 적용취소가 없다.')
  }

  // ── 검토 패널 후속 (2026-09-01) ──────────────────────────────
  // 공실 반전 세 자리(이사·이사 적용취소·입실 적용취소)가 점유 정본을 지나는가.
  // 구간 수만 보면 뒤이은 예약이나 자기 계약 호실이 '빈 방'으로 골라진다(402호 실사례).
  {
    for (const fname of ['advanceRoomSchedule', 'undoRoomMove', 'undoRoomSchedule']) {
      const fn = src.match(new RegExp(`export async function ${fname}[\\s\\S]*?\\n\\}\\n`))
      if (!fn || !/stillUsed === 0 && !\(await roomStillOccupied\(/.test(fn[0])) {
        violations.push(`${f} — ${fname} 의 공실 반전이 점유 정본(roomStillOccupied)을 안 지난다. 예약 있는 방이 빈 방으로 골라진다.`)
      }
    }
    // 청소 예정 재사용 — 같은 방의 PLANNED 가 있으면 날짜만 당긴다. 안 보면 카드가 쌓인다.
    // 'PLANNED' 글자만 찾으면 생성 쪽의 같은 글자에 속는다(역주입에서 통과했다) — **조회**를 본다.
    const adv = src.match(/export async function advanceRoomSchedule[\s\S]*?\n\}\n/)
    if (adv && !/roomCleaning\.findFirst[\s\S]{0,200}status: 'PLANNED'/.test(adv[0])) {
      violations.push(`${f} — 이사 청소 예정이 기존 PLANNED 를 안 본다. 처리·적용취소 반복마다 청소 카드가 쌓인다.`)
    }
    // 버튼 준비 판정은 서버 한 자리 — 화면 둘이 각자 재면 문구와 실행이 갈린다(밀린 이사·입실 당일·퇴실 완료).
    if (!/moveNowReady/.test(src)) {
      violations.push(`${f} — getRoomScheduleState 가 오늘 이사 준비 판정(moveNowReady)을 안 내려준다.`)
    }
    // 글자 존재만 보면 주석("getRoomScheduleState.moveNowReady")과 임포트 줄에 속는다
    // (역주입에서 둘 다 실제로 통과했다). **값 접근**과 **JSX 사용**을 본다.
    for (const [name, sf, readyRe] of [
      ['프리즘 일정 행', 'components/entity-modal/bodies/TenantBody.tsx', /info\.moveNowReady/],
      ['입주자 수정 폼', 'app/(app)/tenants/TenantClient.tsx', /roomPlan\.moveNowReady/],
    ]) {
      const ssrc = readFileSync(sf, 'utf8')
      if (!readyRe.test(ssrc)) {
        violations.push(`${sf} — '${name}' 이 서버 준비 판정을 안 쓴다. 밀린 이사·입실 당일·퇴실 완료에도 버튼이 선다.`)
      }
      // 상시 적용취소 — 토스트(6초)가 지나가도 되돌릴 길이 남아야 한다(§16).
      if (!/<UndoRoomMoveButton/.test(ssrc)) {
        violations.push(`${sf} — '${name}' 에 이사 상시 적용취소가 없다. 토스트가 지나가면 입실 전체를 물러야 한다.`)
      }
    }
    // 경계 되돌림의 결과를 버리지 않는가 — 대입 없는 호출이 하나라도 있으면 침묵 실패다(§27.2).
    const bsrc2 = readFileSync('components/tenant/MoveRoomNowButton.tsx', 'utf8')
    const all = (bsrc2.match(/await undoChangeRoomMoveDate\(/g) ?? []).length
    const assigned = (bsrc2.match(/= (?:boundaryUndo \? )?await undoChangeRoomMoveDate\(/g) ?? []).length
    if (all !== assigned) {
      violations.push('components/tenant/MoveRoomNowButton.tsx — 경계 되돌림 결과를 버리는 호출이 있다. 실패해도 침묵한다.')
    }
  }
}

console.log(`[이사일 수정] 축 ⓐ 예약 단계 · ⓑ 입실 단계 · ⓒ 겹침·연속성 검증 · ⓓ 입실 후 남은 계획 · ⓔ 오늘 이사 / 위반 ${violations.length}건`)
if (violations.length > 0) {
  console.error('')
  for (const v of violations) console.error(`  - ${v}`)
  console.error('')
  console.error('  방이 비는 날과 실제로 드는 날은 다르다. 그 차이를 사람이 정할 수 있어야 한다.')
  process.exit(1)
}
