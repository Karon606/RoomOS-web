// 호실의 공간 속성 — 층/창문/방향/면적.

import { InfoRow } from './InfoRow'

const WINDOW_TYPE_LABEL: Record<string, string> = { interior: '내창', exterior: '외창' }
const DIRECTION_LABEL: Record<string, string> = {
  east: '동향', west: '서향', south: '남향', north: '북향',
  southeast: '남동향', southwest: '남서향', northeast: '북동향', northwest: '북서향',
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
