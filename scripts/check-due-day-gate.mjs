// 납부일 게이트(설계 D)의 배선이 살아 있는지 잡는 그물. 읽기 전용, 위반 시 exit 1.
//
// 왜 필요한가(2026-09-07). 계약서 문(서명 요청·발급·미리보기)이 원천 납부일(lease.dueDay)이
// 빈 계약을 거절하고 채움 창을 세운다. 이 배선 중 하나라도 조용히 빠지면 납부일 없는 계약이
// 다시 종이가 되어 나가고, 청구 엔진(firstMonthGap)은 그 계약을 계산하지 못한다 — 겉으로는
// 아무 오류가 없다. 그래서 문마다 앵커를 박아 둔다.
//
//   ⓐ 발급 액션 게이트 — 원천(dueDaySource)을 보고 DUE_DAY_REQUIRED 를 돌려준다.
//   ⓑ 채움 액션 — 원천 저장 + 미서명 활성 링크 닫기.
//   ⓒ 이어받기 게이트 — 빈 납부일 스냅샷의 승계 거절.
//   ⓓ 발급 API 409 — SNAPSHOT(서명 완료 박제 재발급)만 예외.
//   ⓔ 스냅샷 운반 — ContractData.lease 가 원천·단기 여부를 싣는다(게이트 판정 재료).
//   ⓕ 화면 배선 — 계약서 화면 세 문(서명 요청·발급·미리보기)과 인라인 셀, 파일 패널.
//   ⓖ 보존 — 거주 전 저장·호실 일정 적용취소가 문에서 채운 납부일을 도로 걷지 않는다.
//   ⓗ 감사 예외 — 계약서 흔적 있는 예약 납부일을 오염으로 오인하지 않는다.
//
// 실행: node scripts/check-due-day-gate.mjs
import { readFileSync } from 'node:fs'

const violations = []
const read = f => readFileSync(f, 'utf8')
const must = (f, src, needle, why) => {
  if (!src.includes(needle)) violations.push(`${f} — "${needle}" 앵커가 없다. ${why}`)
}
// 함수 본문 추출 — 선언부터 다음 최상위 선언까지. 반환 타입의 { 를 본문으로 오인하지 않게
// 문자열 앵커로 자른다(거리·괄호 계수 금지 규칙).
const fnBody = (src, decl) => {
  const at = src.indexOf(decl)
  if (at < 0) return null
  const rest = src.slice(at + decl.length)
  const end = rest.search(/\nexport (async )?function |\nexport const /)
  return end < 0 ? rest : rest.slice(0, end)
}

// ⓐⓑⓒ — 발급 액션·채움 액션·이어받기
{
  const f = 'app/(app)/tenants/contractShare.ts'
  const src = read(f)
  const issue = fnBody(src, 'export async function issueContractShareLink')
  if (!issue) violations.push(`${f} — issueContractShareLink 를 찾지 못했다.`)
  else {
    must(f, issue, "code: 'DUE_DAY_REQUIRED'", '발급 게이트가 빠지면 납부일 없는 링크가 나간다.')
    must(f, issue, 'snapshot.lease.dueDaySource', '게이트가 병합값을 보면 표시값이 원천 빈 것을 가린다.')
  }
  const fill = fnBody(src, 'export async function setDueDayForContract')
  if (!fill) violations.push(`${f} — setDueDayForContract 를 찾지 못했다.`)
  else {
    must(f, fill, 'dueDay: v', '채움 창의 값이 원천(lease.dueDay)에 저장돼야 청구까지 흐른다.')
    must(f, fill, 'closedAt: new Date()', '미서명 활성 링크를 닫지 않으면 입주자 종이의 납부일이 낡는다.')
  }
  const renew = fnBody(src, 'export async function renewContractShareLink')
  if (!renew) violations.push(`${f} — renewContractShareLink 를 찾지 못했다.`)
  else must(f, renew, '폐기하고 새로 작성해야 납부일이 실립니다', '승계는 스냅샷 통째 복사라 빈 납부일이 그대로 연장된다.')
}

// ⓓ — 발급 API 409
{
  const f = 'app/api/contract/generate/route.ts'
  const src = read(f)
  must(f, src, "code: 'DUE_DAY_REQUIRED'", 'API 게이트가 빠지면 화면 밖 경로(미리보기·보내기)로 종이가 나간다.')
  must(f, src, "body_.source !== 'SNAPSHOT'", '서명 완료 박제 재발급까지 막으면 증거 보존이 막다른 길이 된다.')
}

// ⓔ — 스냅샷 운반
{
  const f = 'lib/contractData.ts'
  const src = read(f)
  must(f, src, 'dueDaySource: (lease as { dueDay?: string | null }).dueDay ?? null', '원천이 안 실리면 게이트·화면 판정이 병합값으로 오판한다.')
  must(f, src, 'isShortTerm: (lease as { isShortTerm?: boolean }).isShortTerm ?? false', '단기 예외 판정 재료가 빠지면 단기 계약이 게이트에 걸린다.')
}

// ⓕ — 화면 배선
{
  const f = 'app/contract/[tenantId]/ContractView.tsx'
  const src = read(f)
  must(f, src, "res.code === 'DUE_DAY_REQUIRED'", '서명 요청 문이 거절 코드를 안 받으면 막다른 거절이 된다.')
  const doors = src.split('needsDueDayFill() && !(await askDueDayFill())').length - 1
  if (doors < 2) violations.push(`${f} — 문 앞 선채움이 ${doors}곳뿐이다. 발급(handleContractSave)·미리보기(fetchPreviewPdf) 두 문이 다 지나야 한다.`)
  must(f, src, 'setDueDayForContract(leaseId, nextDue)', '인라인 납부일 셀이 원천 빈 동안 표시값으로 저장하면 종이와 청구가 갈린다.')
  must(f, src, '<DueDayFillDialog', '채움 창 렌더가 빠지면 다리(promise)가 영영 안 풀린다.')
}
{
  const f = 'components/entity-modal/widgets/ContractFilesPanel.tsx'
  const src = read(f)
  must(f, src, "res.code === 'DUE_DAY_REQUIRED'", '파일 패널의 서명 요청도 같은 문을 지나야 한다.')
  must(f, src, '<DueDayFillDialog', '채움 창 렌더가 빠지면 다리(promise)가 영영 안 풀린다.')
}

// ⓖ — 보존
{
  const f = 'app/(app)/tenants/actions.ts'
  const src = read(f)
  must(f, src, 'DUE_PENDING_STATUSES.includes(status) ? (currentLease.dueDay ?? null)', '거주 전 저장이 납부일을 강제로 비우면 문에서 채운 값이 사라진다.')
  const undo = fnBody(src, 'export async function undoRoomSchedule')
  if (!undo) violations.push(`${f} — undoRoomSchedule 을 찾지 못했다.`)
  else if (/dueDay:\s*null/.test(undo)) violations.push(`${f} — undoRoomSchedule 이 납부일을 도로 걷는다. 문에서 채운 납부일은 일정 적용취소와 무관하다.`)
}

// ⓗ — 감사 예외
{
  const f = 'lib/integrityAudit.ts'
  const src = read(f)
  must(f, src, 'contractShareLinks: { none: {} }', '예외가 빠지면 계약서 문이 채운 납부일이 매일 오염으로 신고된다.')
}

if (violations.length) {
  console.error(`납부일 게이트 그물 위반 ${violations.length}건`)
  for (const v of violations) console.error('  ' + v)
  process.exit(1)
}
console.log('check-due-day-gate OK — 문 게이트·채움 액션·화면 배선·보존·감사 예외 전부 살아 있음')
