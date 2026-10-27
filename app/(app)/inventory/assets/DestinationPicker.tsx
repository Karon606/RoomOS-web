'use client'
// 비품 옮기기 목적지 고르기 정본 — 세그먼트(여분 보관 / 방 / 공용부)로 무리를 먼저 고르고 그 무리만 담은 select 를 보인다.
//
// 왜 있나(2026-10-26 운영자 승인, 신고 0c37bc53 "미배정분 보관 위치 선택항목이 배정하는 방들의 리스트와 섞여있어서
// 스크롤도 불편하고 구분이 잘 안되니까"). 종전에는 select 하나에 optgroup 셋(보관 19 + 방 50 + 공용부 17 = 86행)이었고,
// iOS 휠·Android 목록에서 optgroup 은 회색 머리줄일 뿐이라 성격이 다른 셋(보관 = 미배정 상태 + 위치 메모, 방·공용부 = 배정)이
// 한 두루마리가 됐다. 방까지 가려면 보관 19행을 지나야 했다.
//
// 문법. 질문 라벨 바로 아래 SegmentedControl md(가이드 §12 '상호배타는 세그먼트', 고르지 않은 칸 --seg-ink-off, §23 필터로
// 읽히지 않게 '전체' 칸은 없다) → 그 무리만 담은 select(aria-label 은 무리 이름) → 여분 보관 칸에서만 캡션 한 줄.
// 옮기기 모달·일괄 옮기기 모달·나눠 배정의 '방·공용부 추가' 세 자리가 이 하나를 쓴다. 서버·적용취소는 그대로다
// (assignAggregateToTarget·batchAssignAssets·distributeAssetToTargets 가 받는 키는 종전 'store:'·'room:'·'loc:' 그대로).
import { useState } from 'react'
import { SegmentedControl } from '@/components/ui/SegmentedControl'
import { fmtRoomNo } from '@/lib/roomNo'
import {
  STORE_GROUP_LABEL, STORE_SEGMENT_LABEL, STORE_SEGMENT_CAPTION, STORE_UNKNOWN_OPTION, UNASSIGNED_PLACE,
  storeKey, storeOptionLabel, destGroupOf, type DestGroup,
} from './storagePlace'

const SELECT_CLS = 'w-full h-10 bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)]'

const GROUP_LABEL: Record<DestGroup, string> = { store: STORE_SEGMENT_LABEL, room: '방', loc: '공용부' }

export function DestinationPicker({
  label, value, onChange, groups, initialGroup, rooms, locations, storages, storeDefault, emptyLabel, excludeKeys, disabled,
}: {
  /** 질문 라벨('어디로 옮길까요?'). 세그먼트 바로 위에 선다. */
  label: string
  /** 'store:<id>' | 'store:' | 'room:<id>' | 'loc:<id>' | ''(아직 안 고름) */
  value: string
  onChange: (v: string) => void
  /** 세울 칸. 공용부가 0곳이면 부르는 쪽이 'loc' 를 빼도 되고, 여기서도 빈 무리는 숨긴다. */
  groups: readonly DestGroup[]
  /** 값이 비었을 때 처음 보일 칸(defaultDestGroup). */
  initialGroup: DestGroup
  rooms: { id: string; roomNo: string }[]
  locations: { id: string; pathName: string }[]
  storages: { id: string; pathName: string; isHub: boolean }[]
  /** 여분 보관 칸으로 바꿀 때 고를 값(기본 창고 하나면 그 위치, 아니면 '보관 위치 모름'). */
  storeDefault: string
  /** 방·공용부 select 의 빈 선택지 글자. 옮기기는 '고르세요', 나눠 배정은 '고르면 아래 목록에 추가됩니다'. */
  emptyLabel: (g: 'room' | 'loc') => string
  /** 목록에서 뺄 키(나눠 배정이 이미 담은 방·공용부). */
  excludeKeys?: ReadonlySet<string>
  disabled?: boolean
}) {
  const shown = groups.filter(g => g !== 'loc' || locations.length > 0)
  const [picked, setPicked] = useState<DestGroup>(shown.includes(initialGroup) ? initialGroup : shown[0])
  // 값이 있으면 값의 무리가 곧 칸이다(값과 칸이 갈리지 않게). 비었으면 사람이 고른 칸.
  const fromValue = destGroupOf(value)
  const group: DestGroup = fromValue && shown.includes(fromValue) ? fromValue : picked
  const pick = (g: DestGroup) => {
    setPicked(g)
    if (g === group) return
    // 여분 보관은 고를 값이 늘 있다(기본 창고 또는 '모름'). 방·공용부는 50행 중 하나라 미리 고르지 않는다.
    onChange(g === 'store' ? storeDefault : '')
  }
  const hasStores = storages.length > 0
  const ex = excludeKeys ?? new Set<string>()
  const roomOpts = rooms.filter(r => !ex.has('room:' + r.id))
  const locOpts = locations.filter(l => !ex.has('loc:' + l.id))
  return (
    <div>
      <span className="block text-xs font-medium text-[var(--warm-mid)] mb-1">{label}</span>
      {shown.length > 1 && (
        <SegmentedControl<DestGroup> size="md" ariaLabel={label} value={group} onChange={pick}
          options={shown.map(g => ({ value: g, label: GROUP_LABEL[g] }))} />
      )}
      <div className="mt-2">
        {group === 'store' && (hasStores ? (
          // 옮기기·일괄 옮기기의 보관 선택지 표기는 '{경로}에 보관'(공용부 칸의 같은 이름과 안 겹친다). 수령 창·무상 입수는 경로 그대로.
          <select value={value} disabled={disabled} aria-label={STORE_GROUP_LABEL}
            onChange={e => onChange(e.target.value)} className={SELECT_CLS}>
            {storages.map(s => <option key={s.id} value={storeKey(s.id)}>{storeOptionLabel(s)}</option>)}
            <option value={storeKey(null)}>{STORE_UNKNOWN_OPTION}</option>
          </select>
        ) : (
          // 위치가 0곳인 영업장. 고를 보관 위치가 없으니 select 없이 종전 행선지(미배정(여분))를 글자로 말한다.
          <p className="text-sm text-[var(--warm-dark)]">{UNASSIGNED_PLACE}으로</p>
        ))}
        {group === 'room' && (
          <select value={fromValue === 'room' ? value : ''} disabled={disabled} aria-label="방"
            onChange={e => onChange(e.target.value)} className={SELECT_CLS}>
            <option value="">{emptyLabel('room')}</option>
            {roomOpts.map(r => <option key={r.id} value={'room:' + r.id}>{fmtRoomNo(r.roomNo)}</option>)}
          </select>
        )}
        {group === 'loc' && (
          <select value={fromValue === 'loc' ? value : ''} disabled={disabled} aria-label="공용부"
            onChange={e => onChange(e.target.value)} className={SELECT_CLS}>
            <option value="">{emptyLabel('loc')}</option>
            {locOpts.map(l => <option key={l.id} value={'loc:' + l.id}>{l.pathName}</option>)}
          </select>
        )}
      </div>
      {group === 'store' && <p className="mt-1 text-[0.65625rem] text-[var(--warm-muted)] break-keep">{STORE_SEGMENT_CAPTION}</p>}
    </div>
  )
}
