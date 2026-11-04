'use client'

// 스테이음 관리자 초대코드 탭. 발급 폼 + 코드 목록. 2026-11-04 가이드 정합(운영자 승인 '추천대로', 5단계).
//   · 버튼은 정본 Btn(raw button 걷음), 상태는 정본 Badge(비활성·만료·소진), 자동·수동 승인은 속성이라 §11 메타 칩이다.
//   · 쓰기 셋에 토스트 [적용취소]: 발급(아무도 안 썼을 때만 지움)·켜고 끄기(직전 값)·삭제(지운 행 그대로 되살림, §14 파괴 확인창).
//   · 다크에서 안 보이던 --persimmon-d 글자를 걷었다(§28). 삭제는 카드 '관리' 메뉴 구분선 아래(가입자 카드와 같은 문법).
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { DatePicker } from '@/components/ui/DatePicker'
import { EmptyState } from '@/components/ui/EmptyState'
import { Btn } from '@/components/ui/Btn'
import { Badge } from '@/components/ui/Badge'
import { ManageMenu } from '@/components/ui/RecordEditShell'
import { pushToast } from '@/lib/saveStatus'
import { kstYmdStr } from '@/lib/kstDate'
import { withParticle } from '@/lib/koParticle'
import { confirmDialog } from '@/components/ui/ConfirmDialog'
import {
  createInviteCode, toggleInviteCode, deleteInviteCode, restoreInviteCode, undoCreateInviteCode,
} from '../actions'

type Row = {
  id: string
  code: string
  note: string
  maxUses: number
  usedCount: number
  autoApprove: boolean
  isActive: boolean
  expiresAtLabel: string
  expired: boolean
  createdAtLabel: string
}

// 폼 입력 정본 값(§12): 높이 40/모바일 44, r-sm, --cream-2 바탕, 1.5px --border-s, 포커스 --tc 보더.
const inputCls = 'w-full h-[var(--input-h-touch)] sm:h-[var(--input-h)] px-3 rounded-sm text-sm outline-none bg-[var(--cream-2)] border-[1.5px] border-[var(--border-s)] text-[var(--ink)] placeholder:text-[var(--ink-m)] focus:border-[var(--tc)] focus:shadow-[var(--input-ring-focus)]'
const labelCls = 'block text-xs font-medium text-[var(--ink-s)] mb-1.5'
// §11 메타 칩 정본(속성 표시): bg --canvas · --warm-muted · ring 1px --warm-border · r-sm · 10.5px
const META_CHIP = 'shrink-0 rounded-sm bg-[var(--canvas)] px-1.5 py-0.5 text-[0.65625rem] text-[var(--warm-muted)] ring-1 ring-[var(--warm-border)]'
const NET_ERR = '처리 중 통신 오류가 발생했습니다.'

export default function InvitesClient({ rows }: { rows: Row[] }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [err, setErr] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  // 생성 폼
  const [code, setCode] = useState('')
  const [note, setNote] = useState('')
  const [maxUses, setMaxUses] = useState('1')
  const [autoApprove, setAutoApprove] = useState(true)
  const [expiresAt, setExpiresAt] = useState('')

  const undoToast = (label: string, run: () => Promise<{ ok: boolean; error?: string }>, doneMsg: string) => ({
    action: { label, run: () => { void run().then(r => {
      if (r.ok) { pushToast('info', doneMsg); router.refresh() } else pushToast('error', r.error ?? '되돌리지 못했습니다.')
    }).catch(() => pushToast('error', NET_ERR)) } },
  })

  function submit() {
    setErr(null)
    startTransition(async () => {
      try {
        const res = await createInviteCode({
          code: code || undefined,
          note: note || undefined,
          maxUses: Number(maxUses) || 0,
          autoApprove,
          expiresAt: expiresAt || null,
        })
        if (!res.ok) { setErr(res.error ?? '발급하지 못했습니다.'); return }
        setCode('')
        setNote('')
        setMaxUses('1')
        setExpiresAt('')
        const made = res.code
        pushToast('success', `코드 ${made} 발급했습니다`, undoToast('적용취소', () => undoCreateInviteCode(made), `적용취소했습니다 · 코드 ${made} 발급`))
        router.refresh()
      } catch {
        setErr(NET_ERR)
      }
    })
  }

  function toggle(c: Row) {
    const next = !c.isActive
    setBusyId(c.id)
    startTransition(async () => {
      try {
        const res = await toggleInviteCode(c.id, next)
        if (!res.ok) { pushToast('error', '처리하지 못했습니다. 새로고침 후 다시 확인해 주세요.'); return }
        pushToast('success', `코드 ${c.code} ${next ? '활성화' : '비활성화'}했습니다`,
          undoToast('적용취소', () => toggleInviteCode(c.id, c.isActive), `적용취소했습니다 · 코드 ${c.code} ${next ? '활성화' : '비활성화'}`))
        router.refresh()
      } catch {
        pushToast('error', NET_ERR)
      } finally {
        setBusyId(null)
      }
    })
  }

  async function remove(c: Row) {
    const ok = await confirmDialog({
      title: `코드 ${withParticle(c.code, '을/를')} 삭제할까요?`,
      level: 'danger',
      confirmLabel: '삭제',
      message: '실행 뒤 토스트의 적용취소로 되살릴 수 있습니다(토스트가 사라지면 되돌릴 수 없음).',
      impact: [{ label: `이 코드로 가입한 ${c.usedCount}명의 계정은 그대로이고, 이 코드로는 더 가입할 수 없습니다.` }],
      impactTitle: '바로 일어나는 일',
      irreversibleNote: '',
    })
    if (!ok) return
    setBusyId(c.id)
    startTransition(async () => {
      try {
        const res = await deleteInviteCode(c.id)
        if (!res.ok) { pushToast('error', res.error); return }
        const rid = res.restoreId
        pushToast('success', `코드 ${c.code} 삭제했습니다`, undoToast('적용취소', () => restoreInviteCode(rid), `적용취소했습니다 · 코드 ${c.code} 삭제`))
        router.refresh()
      } catch {
        pushToast('error', NET_ERR)
      } finally {
        setBusyId(null)
      }
    })
  }

  return (
    <div className="space-y-3">
      <h1 className="text-xl font-bold text-[var(--ink)]">
        초대코드 <span className="num text-[var(--ink-m)] font-semibold">({rows.length})</span>
      </h1>

      {/* 생성 폼 */}
      <div className="rounded-xl p-4 space-y-3 bg-[var(--cream)] border border-[var(--warm-border)]">
        <p className="text-sm font-semibold text-[var(--ink)]">새 코드 발급</p>
        <div className="grid grid-cols-2 gap-2.5 items-start">
          <div className="col-span-2">
            <label htmlFor="inv-code" className={labelCls}>코드 (비우면 자동 생성)</label>
            <input id="inv-code" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="STAY-XXXXXX" className={inputCls} autoComplete="off" />
          </div>
          <div className="col-span-2">
            <label htmlFor="inv-note" className={labelCls}>메모 (용도)</label>
            <input id="inv-note" value={note} onChange={(e) => setNote(e.target.value)}
              placeholder="예: 1차 베타 테스터" className={inputCls} />
          </div>
          <div>
            <label htmlFor="inv-max" className={labelCls}>사용 인원</label>
            <input id="inv-max" type="number" inputMode="numeric" value={maxUses} onChange={(e) => setMaxUses(e.target.value)}
              min={0} className={`${inputCls} num`} aria-describedby="inv-max-hint" />
            <p id="inv-max-hint" className="mt-1 text-[0.65625rem] text-[var(--warm-muted)]">0 이면 무제한</p>
          </div>
          <div>
            <p className={labelCls}>만료일 (선택)</p>
            <DatePicker value={expiresAt} onChange={setExpiresAt} minDate={kstYmdStr()} placeholder="만료일 선택" className={inputCls} />
          </div>
        </div>
        <label className="flex items-center gap-2 text-sm text-[var(--warm-dark)] cursor-pointer min-h-[44px]">
          <input type="checkbox" checked={autoApprove} onChange={(e) => setAutoApprove(e.target.checked)}
            className="w-4 h-4 accent-[var(--coral)] shrink-0" />
          <span className="break-keep">이 코드로 가입하면 자동 승인 (선착순 무료)</span>
        </label>
        {err && <p className="text-xs text-[var(--danger-fg)]" role="alert">{err}</p>}
        <Btn variant="primary" size="md" onClick={submit} disabled={pending}>
          {pending && !busyId ? '발급 중…' : '코드 발급'}
        </Btn>
      </div>

      {/* 목록 */}
      {rows.length === 0 ? (
        <EmptyState
          icon={<svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="var(--warm-muted)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 7 h16 a1 1 0 0 1 1 1 v3 a2 2 0 0 0 0 4 v3 a1 1 0 0 1-1 1 H4 a1 1 0 0 1-1-1 v-3 a2 2 0 0 0 0-4 V8 a1 1 0 0 1 1-1 Z M12 7 v12" /></svg>}
          title="발급한 코드가 없습니다"
          description="새 초대코드를 발급하면 여기에 표시됩니다."
        />
      ) : (
        <ul className="space-y-2.5">
          {rows.map((c) => {
            const exhausted = c.maxUses > 0 && c.usedCount >= c.maxUses
            const rowBusy = pending && busyId === c.id
            return (
              <li key={c.id} className="rounded-xl p-4 bg-[var(--cream)] border border-[var(--warm-border)]" style={{ opacity: rowBusy ? 0.6 : 1 }}>
                <div className="flex items-center gap-1 flex-wrap">
                  <span className="num font-semibold text-[var(--ink)] mr-1">{c.code}</span>
                  {!c.isActive && <Badge tone="pale-neutral">비활성</Badge>}
                  {c.expired && <Badge tone="pale-neutral">만료</Badge>}
                  {exhausted && <Badge tone="pale-neutral">소진</Badge>}
                  <span className={META_CHIP}>{c.autoApprove ? '자동 승인' : '수동 승인'}</span>
                </div>
                {c.note && <p className="text-sm text-[var(--ink-s)] mt-1 break-keep">{c.note}</p>}
                <p className="text-xs text-[var(--ink-m)] mt-1 num">
                  사용 {c.usedCount}/{c.maxUses > 0 ? c.maxUses : '무제한'} · 발급 {c.createdAtLabel}
                  {c.expiresAtLabel ? ` · 만료 ${c.expiresAtLabel}` : ''}
                </p>
                {/* 카드 발끝 문법은 가입자 카드와 같다. 자주 쓰는 동작 + '관리'(파괴 동작은 구분선 아래) */}
                <div className="flex justify-end gap-2 mt-3">
                  <Btn variant="secondary" size="sm" disabled={rowBusy} onClick={() => toggle(c)}>
                    {c.isActive ? '비활성화' : '활성화'}
                  </Btn>
                  <ManageMenu items={[{ key: 'delete', label: '삭제', danger: true, onSelect: () => { void remove(c) } }]} disabled={rowBusy} placement="auto" size="sm" />
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
