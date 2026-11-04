import { getPropertiesOverview, enterPropertyAsAdmin } from '../actions'
import { fmtDateDot as fmtDate } from '@/lib/fmtDate'
import EnterButton from './EnterButton'
import { EmptyState } from '@/components/ui/EmptyState'
import { Badge } from '@/components/ui/Badge'


export default async function AdminPropertiesPage() {
  const properties = await getPropertiesOverview()

  const totalRooms = properties.reduce((s, p) => s + p._count.rooms, 0)
  const totalTenants = properties.reduce((s, p) => s + p._count.tenants, 0)

  return (
    <div className="space-y-3">
      <div className="flex items-baseline justify-between gap-2 flex-wrap">
        <h1 className="text-xl font-bold text-[var(--ink)]">
          영업장 <span className="num text-[var(--ink-m)] font-semibold">({properties.length})</span>
        </h1>
        <p className="text-xs text-[var(--ink-m)] num">
          총 방 {totalRooms} · 입주자 {totalTenants}
        </p>
      </div>

      {properties.length === 0 ? (
        <EmptyState
          icon={<svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="var(--warm-muted)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 21 V8 L12 3 L21 8 V21 M9 21 V13 H15 V21" /></svg>}
          title="등록된 영업장이 없습니다"
        />
      ) : (
        <ul className="space-y-2.5">
          {properties.map((p) => (
            <li key={p.id} className="rounded-xl p-4 bg-[var(--cream)] border border-[var(--warm-border)]">
              <div className="flex items-center gap-1 flex-wrap">
                <span className="font-semibold text-[var(--ink)] truncate mr-1">{p.name}</span>
                {!p.isActive && <Badge tone="pale-neutral">운영 종료</Badge>}
              </div>
              {/* 주소는 있을 때만(빈 값을 '미입력'으로 채우면 본인이 빠뜨린 것처럼 읽힌다, §29) */}
              {p.address && <p className="text-sm text-[var(--ink-s)] mt-0.5 truncate">{p.address}</p>}
              <p className="text-xs text-[var(--ink-m)] mt-1 num">
                소유자 {p.owner.realName || p.owner.name || p.owner.email} · 방 {p._count.rooms} · 입주자{' '}
                {p._count.tenants} · 구성원 {p._count.userRoles} · 개설 {fmtDate(p.createdAt)}
              </p>
              <form action={enterPropertyAsAdmin} className="mt-3 flex justify-end">
                <input type="hidden" name="propertyId" value={p.id} />
                <EnterButton />
              </form>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
