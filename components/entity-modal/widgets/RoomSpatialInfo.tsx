// 호실의 공간 속성 — 층/창문/방향/면적.

import { InfoRow } from './InfoRow'

// DB 실제 값은 대문자 enum (settings 폼 기준 OUTER/INNER, NORTH/EAST/SOUTH/WEST 및 대각선).
// 일부 마이그레이션 전 데이터가 소문자/한글일 수 있어 둘 다 매핑한다.
const WINDOW_TYPE_LABEL: Record<string, string> = {
  OUTER: '외창', INNER: '내창',
  exterior: '외창', interior: '내창',
}
const DIRECTION_LABEL: Record<string, string> = {
  NORTH: '북향', NORTH_EAST: '북동향', EAST: '동향', SOUTH_EAST: '남동향',
  SOUTH: '남향', SOUTH_WEST: '남서향', WEST: '서향', NORTH_WEST: '북서향',
  // 소문자 호환
  north: '북향', northeast: '북동향', east: '동향', southeast: '남동향',
  south: '남향', southwest: '남서향', west: '서향', northwest: '북서향',
}

export function RoomSpatialInfo({ room }: {
  room: {
    floor: string | null
    windowType: string | null
    direction: string | null
    areaPyeong: number | null
    areaM2: number | null
  }
}) {
  const hasAny = !!(room.floor || room.windowType || room.direction || room.areaPyeong || room.areaM2)
  if (!hasAny) return null
  return (
    <div className="space-y-2.5">
      {room.floor      && <InfoRow label="층"        value={`${room.floor}층`} />}
      {room.windowType && <InfoRow label="창문 타입" value={WINDOW_TYPE_LABEL[room.windowType] ?? room.windowType} />}
      {room.direction  && <InfoRow label="방향"      value={DIRECTION_LABEL[room.direction] ?? room.direction} />}
      {(room.areaPyeong || room.areaM2) && (
        <InfoRow label="면적" value={[
          room.areaPyeong ? `${room.areaPyeong}평` : '',
          room.areaM2     ? `${room.areaM2}㎡`    : '',
        ].filter(Boolean).join(' / ')} />
      )}
    </div>
  )
}
