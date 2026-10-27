// 방 이용료 저장의 계약 동기화 감지망. 읽기 전용, 위반 시 exit 1.
//
// 왜(2026-10-27 운영자 승인 '추천대로', 홍은주 602호 사건). 호실 수정(updateRoom)이 기본 이용료가 바뀌면 그 방 거주 계약을 협의가까지
// leaseTerm.updateMany({ rentAmount }) 한 줄로 전부 덮었고, 비거주 이용료가 바뀌면 비거주 계약을 안 건드렸다. 경로마다 제 규칙을 들고 있으면
// 다시 갈린다. 그래서 계약 이용료를 방 값에 맞추는 쓰기는 모두 정본 lib/roomRentSync syncLeaseRentForRoom 을 지난다.
//
// 축 다섯.
//   ⓐ 방 이용료를 바꾸는 네 경로(updateRoom · batchUpdateRooms · applyScheduledRentNow · lib/scheduledRent applyScheduledRentsFor)는
//      leaseTerm.updateMany 로 rentAmount 를 직접 쓰지 않고 syncLeaseRentForRoom 을 부른다. 적용취소 함수는 범위 밖이다.
//   ⓑ updateRoom 은 두 축(resident · nonResident)을 한 트랜잭션(tx)에서 동기화하고 STALE 이면 거부한다. 예약 도래는 두 축 모두 all 이다.
//   ⓒ 정본: followers 는 옛 기준가 조건(rentAmount: prevRent), leaseIds 는 영업장·방·축 범위에 단기 제외, 못 찾으면 STALE, all 은 축 전부.
//   ⓓ 적용취소 undoRoomRentSync 는 서명을 대조하고, 방 값과 계약 금액이 쓴 직후 그대로일 때만(조건부 쓰기) 되돌린다.
//   ⓔ 화면: 저장 전 previewRoomRentSync, 기준가와 다른 계약이 있으면 choiceDialog, 그다음 updateRoom. 성공 토스트 [적용취소] 는 undoRoomRentSync,
//      호실 수정 폼 이용료 칸 아래 WhyCaption(원위치). 문장은 lib/roomRentSyncText 정본(진리표 test-room-rent-sync-text).
//
// 실행: node scripts/check-room-rent-sync.mjs
import { readFileSync } from 'node:fs'

const strip = s => s
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, m => m.replace(/[^\n]/g, ''))
  .replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ''))
  .replace(/^[^\S\n]*\/\/.*$/gm, '')
const read = f => strip(readFileSync(f, 'utf8'))

const violations = []
const need = (ok, msg) => { if (!ok) violations.push(msg) }

function bodyOf(src, name) {
  const start = src.indexOf(`export async function ${name}(`)
  if (start < 0) return null
  const next = src.indexOf('\nexport ', start + 1)
  return src.slice(start, next < 0 ? undefined : next)
}
const directRentWrite = body => /leaseTerm\.updateMany\(\{[\s\S]{0,300}?data:\s*\{\s*rentAmount\b/.test(body)

const ACT = 'app/(app)/room-manage/actions.ts'
const SCH = 'lib/scheduledRent.ts'
const LIB = 'lib/roomRentSync.ts'
const UI = 'app/(app)/room-manage/RoomManageClient.tsx'
const act = read(ACT), sch = read(SCH), lib = read(LIB), ui = read(UI)

// ⓐ 정본 경유
for (const fn of ['updateRoom', 'batchUpdateRooms', 'applyScheduledRentNow']) {
  const b = bodyOf(act, fn)
  need(!!b, `${ACT}: ${fn} 를 못 찾았다.`)
  if (!b) continue
  need(!directRentWrite(b), `${ACT}: ${fn} 가 leaseTerm.updateMany 로 rentAmount 를 직접 쓴다. lib/roomRentSync syncLeaseRentForRoom 을 지나야 한다.`)
  need(/syncLeaseRentForRoom\(/.test(b), `${ACT}: ${fn} 가 syncLeaseRentForRoom 을 부르지 않는다.`)
}
{
  const b = bodyOf(sch, 'applyScheduledRentsFor')
  need(!!b && !directRentWrite(b), `${SCH}: applyScheduledRentsFor 가 leaseTerm.updateMany 로 rentAmount 를 직접 쓴다.`)
  need(!!b && /syncLeaseRentForRoom\(prisma, \{ propertyId, roomId: room\.id, axis: 'resident', [^}]*all: true \}\)/.test(b), `${SCH}: 예약 도래 거주 축이 정본 all 갈래가 아니다(전 계약 적용 규칙, 2026-06-29).`)
  need(!!b && /syncLeaseRentForRoom\(prisma, \{ propertyId, roomId: room\.id, axis: 'nonResident', [^}]*all: true \}\)/.test(b), `${SCH}: 예약 도래 비거주 축이 정본 all 갈래가 아니다.`)
}

// ⓑ updateRoom 두 축·트랜잭션·STALE
{
  const b = bodyOf(act, 'updateRoom') ?? ''
  need(/synced = await prisma\.\$transaction\(async tx => \{\s*await tx\.room\.update\(/.test(b), `${ACT}: updateRoom 이 방 저장과 계약 동기화를 한 트랜잭션에서 하지 않는다.`)
  need(/\['resident', prevRoom\.baseRent, baseRent\]/.test(b) && /\['nonResident', prevRoom\.nonResidentRent, nonResidentRent\]/.test(b), `${ACT}: updateRoom 이 두 축(기본·비거주 이용료)을 모두 동기화하지 않는다.`)
  need(/syncLeaseRentForRoom\(tx, \{ propertyId, roomId: id, axis, prevRent, nextRent, excludeShortTerm: true \}\)/.test(b), `${ACT}: updateRoom 의 followers 동기화가 트랜잭션 클라이언트(tx)·영업장 범위로 돌지 않거나 단기 계약을 넣는다.`)
  need(/syncLeaseRentForRoom\(tx, \{ propertyId, roomId: id, axis, prevRent, nextRent, leaseIds: ids, expect: picked\.expect \}\)/.test(b), `${ACT}: updateRoom 이 확인창에서 고른 계약을 expect(updatedAt) 조건 없이 쓴다.`)
  need(/if \(err instanceof RoomRentSyncStale\) return \{ ok: false, error: ROOM_RENT_SYNC_STALE \}/.test(b), `${ACT}: updateRoom 이 STALE 을 거부로 돌려주지 않는다.`)
}

// ⓒ 정본 갈래
{
  need(/resident: \['ACTIVE', 'RESERVED', 'CHECKOUT_PENDING'\],\s*nonResident: \['NON_RESIDENT'\]/.test(lib), `${LIB}: 축별 계약 상태가 정본 표(거주 셋 · 비거주 하나)가 아니다.`)
  need(/const scope = \{ roomId: p\.roomId, propertyId: p\.propertyId, status: \{ in: statuses \} \}/.test(lib), `${LIB}: 쓰기 범위에 영업장·방·축이 다 들지 않는다.`)
  need(/const where = \{ \.\.\.scope, id, isShortTerm: false, \.\.\.\(at \? \{ updatedAt: new Date\(at\) \} : \{\}\) \}/.test(lib), `${LIB}: leaseIds 갈래가 단기 제외·updatedAt 조건을 걸지 않는다.`)
  need(/if \(!cur\) throw new RoomRentSyncStale\(\)/.test(lib) && /if \(r\.count !== 1\) throw new RoomRentSyncStale\(\)/.test(lib), `${LIB}: leaseIds 갈래가 못 찾거나 0건일 때 STALE 로 전체를 되감지 않는다.`)
  need(/rentAmount: p\.prevRent \}, data: \{ rentAmount: p\.nextRent \}/.test(lib), `${LIB}: followers 갈래가 옛 기준가 조건(rentAmount: prevRent) 없이 쓴다(협의가를 덮는다).`)
  need(/const followers = p\.prevRent == null \? \[\] :/.test(lib), `${LIB}: 옛 기준가가 없던 축(비거주 이용료가 비었던 방)에서 따라갈 계약을 만든다.`)
  need(/if \(p\.all\) \{[\s\S]*?updateMany\(\{ where: scope, data: \{ rentAmount: p\.nextRent \} \}\)/.test(lib), `${LIB}: all 갈래가 축 전부를 쓰지 않는다(예약 도래 규칙).`)
  need(/if \(p\.nextRent <= 0\) return \{ applied: \[\], skipped: \[\] \}\n\n  if \(p\.leaseIds\)/.test(lib), `${LIB}: 칸을 비운 저장(0원 이하)이 계약을 0원으로 옮긴다(독립 검수 B1).`)
  need(!/expectedAmount/.test(lib), `${LIB}: 정본이 수납 락(expectedAmount)을 건드린다. 이미 청구된 달은 그대로여야 한다.`)
}

// ⓓ 적용취소
{
  const b = bodyOf(act, 'undoRoomRentSync') ?? ''
  need(!!b, `${ACT}: undoRoomRentSync 가 없다.`)
  need(/verifyUndoBody\(ROOM_RENT_SYNC_UNDO_DOMAIN, propertyId, canonicalRoomRentSyncUndo\(u\), u\.sig\)/.test(b), `${ACT}: undoRoomRentSync 가 서명을 대조하지 않는다.`)
  need(/tx\.room\.updateMany\(\{\s*where: \{ id: u\.roomId, propertyId, baseRent: u\.room\.after\.baseRent, nonResidentRent: u\.room\.after\.nonResidentRent \}/.test(b), `${ACT}: 방 값을 쓴 직후 그대로일 때만 되돌리지 않는다.`)
  need(/tx\.paymentRecord\.count\(\{ where: \{ propertyId, leaseTermId: \{ in: u\.leases\.map\(l => l\.id\) \}, isDeposit: false, createdAt: \{ gt: new Date\(u\.at\) \} \} \}\)/.test(b), `${ACT}: 적용 뒤 새 수납 기록(락)이 생긴 계약도 되돌린다(독립 검수 권고 3).`)
  need(/tx\.leaseTerm\.updateMany\(\{ where: \{ id: l\.id, propertyId, roomId: u\.roomId, rentAmount: l\.after \}/.test(b), `${ACT}: 계약 금액을 영업장·방·쓴 직후 조건 없이 되돌린다.`)
  need(/ROOM_RENT_SYNC_UNDO_DOMAIN = 'room-rent-sync-v1'/.test(read('lib/roomRentSyncUndo.ts')), 'lib/roomRentSyncUndo.ts: 토큰 용도 라벨이 room-rent-sync-v1 이 아니다.')
}

// ⓔ 화면
{
  const h = ui.match(/const handleUpdate = async[\s\S]*?\n  \}\n/)
  need(!!h, `${UI}: handleUpdate 를 못 찾았다.`)
  if (h) {
    const s = h[0]
    const iPv = s.indexOf('previewRoomRentSync('), iDlg = s.indexOf('choiceDialog('), iUp = s.indexOf('updateRoom(formData)')
    need(iPv >= 0 && iDlg > iPv && iUp > iDlg, `${UI}: 저장 순서가 미리보기, 확인창, 저장이 아니다.`)
    need(/rentSyncDialogCopy\(/.test(s), `${UI}: 확인창 문장을 정본(rentSyncDialogCopy)이 정하지 않는다.`)
    need(/if \(choice === null\) return/.test(s), `${UI}: 확인창 취소가 무변경이 아니다(§27.5).`)
    need(/undoRoomRentSync\(undo\)/.test(s) && /label: '적용취소'/.test(s), `${UI}: 저장 토스트에 [적용취소](undoRoomRentSync)가 없다.`)
  }
  need((ui.match(/rentDriftCaption\(/g) ?? []).length === 2, `${UI}: 기본·비거주 이용료 칸 아래 한 줄(rentDriftCaption)이 둘이 아니다.`)
  need(/<WhyCaption id=\{`\$\{editRoom\.id\}-rent-drift`\}/.test(ui) && /<WhyCaption id=\{`\$\{editRoom\.id\}-nr-rent-drift`\}/.test(ui), `${UI}: 원위치 한 줄이 정본 WhyCaption 이 아니다.`)
}

if (violations.length) {
  console.log(`[방 이용료 계약 동기화] 위반 ${violations.length}건`)
  for (const v of violations) console.log('  ' + v)
  process.exit(1)
}
console.log('[방 이용료 계약 동기화] 축 ⓐ 정본 경유(네 경로) · ⓑ 두 축 한 트랜잭션·STALE · ⓒ 정본 갈래 · ⓓ 적용취소 조건부 · ⓔ 화면 결선 / 위반 0건')
