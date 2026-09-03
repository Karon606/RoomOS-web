'use client'

// 보증금 — 수납관리 탭 (2026-08-12, /finance '보증금' 탭에서 이동).
// 보증금은 받고 돌려주는 돈이라 지출이 아니라 수납 흐름이다(운영자 확정). 부가수익 이관(2026-07-02)과 같은 방향으로,
// 데이터·액션(finance/actions)은 그대로 두고 화면만 이곳에 둔다 — 홈 '보유 보증금' 딥링크도 여기로 온다.
import { useTransition, useState } from 'react'
import { useRouter } from 'next/navigation'
import { fmtWon } from '@/lib/fmtMoney'
import { fmtDateDot, fmtMD } from '@/lib/fmtDate'
import { recordDepositReceived, deletePayment } from './actions'
import type { DepositPerTenant, DepositLedgerEntry } from '@/app/(app)/finance/actions'
import { MoneyDisplay } from '@/components/ui/MoneyDisplay'
import { ViewTabs } from '@/components/ui/ViewTabs'
import { Badge } from '@/components/ui/Badge'
import { EmptyState } from '@/components/ui/EmptyState'
import { RowActionBtn } from '@/components/ui/RowActionBtn'
import { InfoHint } from '@/components/ui/InfoHint'
import { trackSave, pushToast, humanError } from '@/lib/saveStatus'
import { DatePicker } from '@/components/ui/DatePicker'
import { Btn } from '@/components/ui/Btn'
import { MANUAL_PAY_METHODS } from '@/lib/paymentMethods'
import { kstYmdStr } from '@/lib/kstDate'
import { fmtRoomNo } from '@/lib/roomNo'

// 행 인라인 미니폼 입력 — §12 전체 티어. DatePicker 트리거는 껍데기가 없어 이 클래스를 안 넘기면
// 맨글자로 렌더된다. min-h 로 44/40 을 만든다(inline-flex 는 truncate 를 죽인다).
const RECV_FIELD_CLS = 'w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2.5 text-sm text-[var(--warm-dark)] min-h-[var(--input-h-touch)] sm:min-h-[var(--input-h)] outline-none focus-visible:border-[var(--tc-text)] focus-visible:shadow-[var(--input-ring-focus)] transition-colors'

const DEPOSIT_STATUS_LABEL: Record<string, string> = {
  ACTIVE: '거주중', RESERVED: '예약', CHECKOUT_PENDING: '퇴실 예정',
  CHECKED_OUT: '퇴실', NON_RESIDENT: '비거주',
}

export function DepositSection({ summary, ledger, totalBalance }: {
  summary: DepositPerTenant[]
  ledger: DepositLedgerEntry[]
  totalBalance: number
}) {
  type SubTab = 'tenant' | 'ledger'
  const [sub, setSub] = useState<SubTab>('tenant')
  const router = useRouter()
  const [recPending, startRec] = useTransition()

  // 전 원장 등으로 받았으나 입금기록 없는 보증금 → '받음(실수납)'으로 **소급** 기록.
  //
  // 종전에는 확인창 둘(금액 3지선다 + 기록 확인)로 물었다. 그런데 금액을 칸으로 받으면 물을 것이
  // 없어지고, 무엇보다 **입금일과 결제수단을 확인창으로는 못 받는다**(ConfirmDialog 에 입력 필드가
  // 없다). 안 물으면 서버가 '오늘'과 '기타'를 박는데 그것은 버튼을 누른 날이지 돈이 들어온 날이
  // 아니다 — 그렇게 쌓인 record 가 7건이다(신고 98fb6fce). 그래서 행 안에서 펴는 미니폼으로 바꿨다.
  // 명시적 '기록' 버튼이 달린 폼 자체가 확인이고, 취소 버튼이 §27.5(취소는 무해)를 만족한다.
  //
  // 결제수단 기본값이 '기타'인 이유 — 이 경로는 소급 기록이라 앱이 수단을 모르는 것이 사실이다.
  // 아는 값을 고를 수 있게 열어 두되, 모를 때 '계좌이체'를 지어내지 않는다.
  const [recvFor, setRecvFor] = useState<string | null>(null)
  const [recvAmount, setRecvAmount] = useState(0)
  const [recvDate, setRecvDate] = useState(kstYmdStr())
  const [recvMethod, setRecvMethod] = useState('기타')

  const openRecv = (d: DepositPerTenant) => {
    // 프리필은 계약액 전액이 아니라 **현금으로 받았을 몫**이다. 청소비가 보증금 안의 몫을 채운
    // 계약에서 전액을 적으면 같은 청소비가 두 번 잡힌다(2026-08-10 사고).
    setRecvAmount(Math.max(0, d.contractDeposit - d.coveredByCleaning))
    setRecvDate(kstYmdStr())
    setRecvMethod('기타')
    setRecvFor(d.leaseTermId)
  }
  const saveRecv = (leaseTermId: string, name: string) => {
    startRec(async () => {
      const release = trackSave()
      try {
        const res = await recordDepositReceived(leaseTermId, {
          amount: recvAmount, payDate: recvDate || kstYmdStr(), payMethod: recvMethod,
        })
        let undone = false   // 연타 방지 — 두 번째 요청은 이미 지워진 걸 못 찾아 실패로 떨어진다
        // 대상·금액·수납일을 말한다(정본 money-display-feedback §2-a). 목록 화면이라 누구인지도 말해야 한다.
        pushToast('success', `${name} 보증금 ${fmtWon(recvAmount)} 받음으로 기록됨 · 입금일 ${fmtMD(recvDate)}`, {
          action: {
            label: '적용취소',
            run: () => {
              if (undone) return
              undone = true
              void deletePayment(res.id).then(r => {
                if (r.ok) { pushToast('info', '수납 기록을 취소했습니다'); router.refresh() }
                else pushToast('error', r.error)
              }).catch(() => pushToast('error', '되돌리기 중 통신 오류가 발생했습니다'))
            },
          },
        })
        setRecvFor(null)
        router.refresh()
      } catch (e) {
        pushToast('error', humanError(e, '기록 실패'))
      } finally { release() }
    })
  }

  const totalIn       = summary.reduce((s, d) => s + d.totalIn, 0)
  const totalReturned = summary.reduce((s, d) => s + d.totalReturned, 0)
  const totalWithheld = summary.reduce((s, d) => s + d.totalWithheld, 0)

  return (
    <div className="space-y-5">
      {/* 잔고 요약 */}
      <div className="bg-[var(--cream)] border border-[var(--warm-border)] rounded-xl p-5">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <div>
            <p className="text-xs text-[var(--warm-muted)] mb-1">현재 보유</p>
            <p className="text-xl font-bold" style={{ color: 'var(--deposit-fg)' }}>
              <MoneyDisplay amount={totalBalance} />
            </p>
          </div>
          <div>
            <p className="text-xs text-[var(--warm-muted)] mb-1">누적 입금</p>
            <p className="text-base font-semibold text-[var(--success-fg)]"><MoneyDisplay amount={totalIn} /></p>
          </div>
          <div>
            <p className="text-xs text-[var(--warm-muted)] mb-1">누적 반환</p>
            <p className="text-base font-semibold text-[var(--warning-fg)]"><MoneyDisplay amount={totalReturned} /></p>
          </div>
          <div>
            <p className="text-xs text-[var(--warm-muted)] mb-1">누적 미반환</p>
            <p className="text-base font-semibold" style={{ color: 'var(--coral)' }}><MoneyDisplay amount={totalWithheld} /></p>
          </div>
        </div>
      </div>

      {/* 서브 탭 — ViewTabs 정본 편입(2026-08-25 밑줄 탭 개정과 동시).
          종전에는 raw button 이 옛 코랄 채움 외형을 손으로 베끼고 있었다(§25 위반으로
          open-issues 등재). 정본이 밑줄 탭으로 바뀌는 이 시점에 안 고치면 이 모조품만
          옛 디자인으로 남는다 — 뷰 전환·항상 1개 활성·건수 접미까지 §25 판별에 정확히 맞는 자리다. */}
      <ViewTabs ariaLabel="보증금 보기" activeId={sub}
        onChange={id => setSub(id as SubTab)}
        tabs={[
          { id: 'tenant', label: '입주자별', suffix: String(summary.length) },
          { id: 'ledger', label: '거래 이력', suffix: String(ledger.length) },
        ]} />

      {sub === 'tenant' && (
        <div className="bg-[var(--cream)] border border-[var(--warm-border)] rounded-xl overflow-hidden">
          {summary.length === 0 ? (
            <EmptyState title="보증금 거래 이력이 있는 입주자가 없습니다." className="border-0 bg-transparent" />
          ) : (
            <ul className="divide-y divide-[var(--warm-border)]/50">
              {summary.map(d => (
                <li key={d.leaseTermId} className="px-5 py-3">
                  {/* 미니폼은 행 전체 폭으로 편다. 오른쪽 칼럼은 잔고 숫자만큼 좁아 폼이 못 들어간다. */}
                  <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <span className="text-sm font-semibold text-[var(--warm-dark)]">{d.tenantName}</span>
                      {d.roomNo && <span className="text-xs text-[var(--warm-muted)]">· {fmtRoomNo(d.roomNo, '')}</span>}
                      <span className="text-[0.65625rem] px-2 py-0.5 rounded-sm bg-[var(--canvas)] text-[var(--warm-muted)] ring-1 ring-[var(--warm-border)]">
                        {DEPOSIT_STATUS_LABEL[d.status] ?? d.status}
                      </span>
                      {d.hasNoInRecord && (
                        <Badge tone="pale-amber">입금 거래 기록 없음</Badge>
                      )}
                    </div>
                    <p className="text-xs text-[var(--warm-muted)]">
                      {d.hasNoInRecord
                        ? <>계약상 보증금 {fmtWon(d.contractDeposit)}
                            {/* 용어 설명(신고 249b5652) — ? 문법은 InfoHint 정본 */}
                            <InfoHint title="계약상 보증금">
                              계약서에 약정한 보증금 금액으로, 실제 입금 기록과는 별개입니다. 입금 기록이 없는 계약은 이 약정액을 기준으로 잔고를 계산합니다. 실제로 받았다면 옆의 받음으로 기록 버튼으로 실수납을 남기세요.
                            </InfoHint></>
                        : `입금 ${fmtWon(d.totalIn)}`}
                      {/* 청소비가 채운 몫은 받은 돈이다 — 병기하지 않으면 아래 '(계약 N)'이 어긋남처럼 읽힌다. */}
                      {d.coveredByCleaning > 0 && ` + 청소비 ${fmtWon(d.coveredByCleaning)}`}
                      {d.totalReturned > 0 && ` · 반환 ${fmtWon(d.totalReturned)}`}
                      {d.totalWithheld > 0 && ` · 미반환 ${fmtWon(d.totalWithheld)}`}
                      {!d.hasNoInRecord && d.contractDeposit !== d.totalIn && (
                        // 차이가 청소비 몫으로 설명되면 경고색이 아니다(포함형 영업장 상시 오탐이던 자리).
                        <span className={`ml-1 ${d.contractDeposit === d.totalIn + d.coveredByCleaning ? 'text-[var(--warm-muted)]' : 'text-[var(--warning-fg)]'}`}>(계약 {fmtWon(d.contractDeposit)})</span>
                      )}
                      {d.status === 'CHECKED_OUT' && d.balance === 0 && (d.totalReturned + d.totalWithheld === 0) && (
                        <span className="ml-1 text-[var(--warm-muted)]">· 퇴실 정리됨</span>
                      )}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-sm font-bold" style={{ color: d.balance > 0 ? 'var(--deposit-fg)' : 'var(--warm-muted)' }}>
                      {fmtWon(d.balance)}
                    </p>
                    <p className="text-[0.65625rem] text-[var(--warm-muted)]">현재 잔고</p>
                    {/* 행 액션은 RowActionBtn 정본 — 맨 버튼은 히트영역이 글자 높이라 §09 터치 타깃
                        44px 에 못 미친다. 형제(수납 기록·보증금 패널·상태 이력·청소 행)와 같은 문법이다.
                        mt-3.5 는 정본이 히트영역용으로 먹는 -my-2 를 되갚아 종전 6px 간격을 지킨다. */}
                    {d.hasNoInRecord && d.status !== 'CHECKED_OUT' && d.contractDeposit > 0 && recvFor !== d.leaseTermId && (
                      <RowActionBtn tone="success" disabled={recPending} className="mt-3.5 whitespace-nowrap"
                        onClick={() => openRecv(d)}>
                        받음으로 기록
                      </RowActionBtn>
                    )}
                  </div>
                  </div>
                  {recvFor === d.leaseTermId && (
                    <div className="mt-3 space-y-2 rounded-lg border border-[var(--warm-border)] bg-[var(--cream-soft)] px-2.5 py-2">
                      {/* 경계는 440 이다 — 이 화면은 페이지라 뷰포트 질의가 맞지만, 412px(Pixel 계열)에서
                          날짜 칸 글자 자리가 130px 로 정확히 경계선이라 그 아래는 세로로 편다. */}
                      <div className="grid grid-cols-1 min-[440px]:grid-cols-2 gap-2">
                        <div className="space-y-1.5">
                          <label className="text-xs font-medium text-[var(--warm-mid)]">금액</label>
                          <input type="text" inputMode="numeric" value={recvAmount.toLocaleString()}
                            onChange={e => setRecvAmount(Number(e.target.value.replace(/[^0-9]/g, '')))}
                            className={RECV_FIELD_CLS} />
                        </div>
                        <div className="space-y-1.5">
                          <label className="text-xs font-medium text-[var(--warm-mid)]">입금일</label>
                          <DatePicker value={recvDate} onChange={setRecvDate} className={RECV_FIELD_CLS} />
                        </div>
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-xs font-medium text-[var(--warm-mid)]">결제수단</label>
                        <select value={recvMethod} onChange={e => setRecvMethod(e.target.value)} className={RECV_FIELD_CLS}>
                          {MANUAL_PAY_METHODS.map(m => <option key={m} value={m}>{m}</option>)}
                        </select>
                      </div>
                      {d.coveredByCleaning > 0 && (
                        <p className="text-[0.65625rem] text-[var(--warm-muted)] leading-relaxed break-keep">
                          입실 때 받은 청소비 {fmtWon(d.coveredByCleaning)}이 계약 보증금의 일부를 채웁니다. 현금으로 받은 몫만 적으세요.
                        </p>
                      )}
                      <p className="text-[0.65625rem] text-[var(--warm-muted)] leading-relaxed break-keep">
                        이미 받았지만 입금 기록이 없는 보증금을 소급으로 남기는 자리입니다. 결제수단을 모르면 기타 그대로 두세요.
                      </p>
                      <div className="flex gap-2 justify-end">
                        <Btn variant="secondary" size="sm" disabled={recPending} onClick={() => setRecvFor(null)}>취소</Btn>
                        <Btn variant="primary" size="sm" disabled={recPending || recvAmount <= 0}
                          onClick={() => saveRecv(d.leaseTermId, d.tenantName)}>기록</Btn>
                      </div>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {sub === 'ledger' && (
        <div className="bg-[var(--cream)] border border-[var(--warm-border)] rounded-xl overflow-hidden">
          {ledger.length === 0 ? (
            <EmptyState title="보증금 거래 이력이 없습니다." className="border-0 bg-transparent" />
          ) : (
            <ul className="divide-y divide-[var(--warm-border)]/50">
              {ledger.map((e, i) => (
                <li key={i} className="px-5 py-3 flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                      <span className={`text-xs font-semibold ${e.type === 'IN' ? 'text-[var(--success-fg)]' : 'text-[var(--warning-fg)]'}`}>
                        {e.type === 'IN' ? '입금' : '반환'}
                      </span>
                      {/* 날짜는 fmtDateDot 정본(감사 B5) — toISOString 은 UTC 라 KST 00~09시에
                          하루 앞선 날짜를 그렸고, 서버·기기가 갈려 하이드레이션도 어긋날 자리였다. */}
                      <span className="text-xs text-[var(--warm-muted)]">{fmtDateDot(e.date)}</span>
                      <span className="text-xs text-[var(--warm-dark)]">· {e.tenantName}</span>
                      {e.roomNo && <span className="text-xs text-[var(--warm-muted)]">· {fmtRoomNo(e.roomNo, '')}</span>}
                    </div>
                    {e.type === 'REFUND' && (
                      <p className="text-xs text-[var(--warm-muted)]">
                        반환 {fmtWon((e.returnedAmount ?? 0))}
                        {(e.withheldAmount ?? 0) > 0 && ` · 미반환 ${fmtWon((e.withheldAmount ?? 0))}`}
                        {e.reason && ` · 사유: ${e.reason}`}
                      </p>
                    )}
                    {e.memo && <p className="text-xs text-[var(--warm-muted)] truncate">메모: {e.memo}</p>}
                  </div>
                  <div className="text-right shrink-0">
                    <p className={`text-sm font-semibold ${e.type === 'IN' ? 'text-[var(--success-fg)]' : 'text-[var(--warning-fg)]'}`}>
                      {e.type === 'IN' ? '+' : '−'}{fmtWon(e.amount)}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
