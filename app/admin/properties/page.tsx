import { getPropertiesOverview } from '../actions'

const fmtDate = (d: Date) =>
  new Intl.DateTimeFormat('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(d)

export default async function AdminPropertiesPage() {
  const properties = await getPropertiesOverview()

  const totalRooms = properties.reduce((s, p) => s + p._count.rooms, 0)
  const totalTenants = properties.reduce((s, p) => s + p._count.tenants, 0)

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h1 className="text-lg font-semibold" style={{ color: 'var(--ink)' }}>
          영업장 <span style={{ color: 'var(--ink-mute)' }}>({properties.length})</span>
        </h1>
        <p className="text-xs" style={{ color: 'var(--ink-mute)' }}>
          총 방 {totalRooms} · 입주자 {totalTenants}
        </p>
      </div>

      {properties.length === 0 ? (
        <p className="text-sm py-8 text-center" style={{ color: 'var(--ink-mute)' }}>
          등록된 영업장이 없습니다.
        </p>
      ) : (
        <ul className="space-y-2.5">
          {properties.map((p) => (
            <li
              key={p.id}
              className="rounded-xl p-4"
              style={{ background: 'var(--cream)', border: '1px solid var(--cream-3)' }}
            >
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-semibold truncate" style={{ color: 'var(--ink)' }}>
                  {p.name}
                </span>
                {!p.isActive && (
                  <span
                    className="text-[11px] font-semibold px-1.5 py-0.5 rounded"
                    style={{ background: 'var(--cream-3)', color: 'var(--ink-3)' }}
                  >
                    비활성
                  </span>
                )}
              </div>
              <p className="text-sm mt-0.5 truncate" style={{ color: 'var(--ink-3)' }}>
                {p.address || '주소 미입력'}
              </p>
              <p className="text-xs mt-1" style={{ color: 'var(--ink-mute)' }}>
                소유자 {p.owner.realName || p.owner.name || p.owner.email} · 방 {p._count.rooms} · 입주자{' '}
                {p._count.tenants} · 구성원 {p._count.userRoles} · 개설 {fmtDate(p.createdAt)}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
