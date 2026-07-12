'use client'

// 규격 단계별 입력 위저드 — 포장형태 → (형태별 조건부) 규격 → 수량.
// 핵심: 1단계 포장형태 선택이 2단계 규격 선택지를 결정한다(운영자 기획 2026-07-04).
//   통·병 → ml/L/g/kg, 봉·팩 → g/kg/매/개, 박스 → 개/매/kg, 롤 → m/매, 낱개 → 규격 생략 or 치수·용도 서술.
// 결과는 기존 데이터 모델 그대로(qtyUnit=포장형태, specValue×specUnit=포장 내 규격, specText=서술) —
// 저장·재고 계산(§4) 무변경, 입력 UX 레이어만. 지출 품목·무상 비품·찍어올리기 승인·추적 품목 추가 공용.
import { useState, useEffect } from 'react'
import { Modal } from '@/components/ui/Modal'
import { Btn } from '@/components/ui/Btn'

export type SpecWizardResult = {
  qtyUnit: string                 // 포장형태(수량 단위): 통·봉·박스·롤·개…
  qtyValue: string                // 수량(몇 통/봉/박스)
  specValue: string               // 포장 내 규격 값('' = 없음)
  specUnit: string                // 포장 내 규격 단위('' = 없음)
  specText: string                // 치수·용도 서술('' = 없음) — 계산 비관여
  unitBasis: 'spec' | 'qty'       // 단가 기준 제안: 내용량당 / 완제품 1개당
}

type Mode = 'spec' | 'piece' | 'free'
type Group = { id: string; label: string; hint: string; units: string[]; specUnits: string[]; mode: Mode; basis: 'spec' | 'qty' }

// 단위 어휘는 지출 폼(SPEC_UNITS/QTY_UNITS)과 동일 집합에서 — 새 표기를 만들지 않아 데이터 파편화 방지.
const GROUPS: Group[] = [
  { id: 'bottle', label: '통 · 병',    hint: '세제·락스 등 용기',        units: ['통', '병'],                        specUnits: ['ml', 'L', 'g', 'kg'],       mode: 'spec',  basis: 'spec' },
  { id: 'bag',    label: '봉 · 팩',    hint: '봉지·팩 포장',             units: ['봉', '팩', '봉지', '포기'],         specUnits: ['g', 'kg', '매', '개', '인분'], mode: 'spec',  basis: 'spec' },
  { id: 'box',    label: '박스 · 묶음', hint: '겉포장(개입 수 등)',       units: ['박스', '세트', '포대', '망', '단'], specUnits: ['개', '매', 'g', 'kg'],       mode: 'spec',  basis: 'spec' },
  { id: 'roll',   label: '롤',        hint: '감긴 자재(장판·랩 등)',     units: ['롤'],                              specUnits: ['m', '매', '장'],             mode: 'spec',  basis: 'spec' },
  { id: 'piece',  label: '낱개',      hint: '개별 물건(봉투·의자 등)',   units: ['개', '장', '매', '알', '권'],       specUnits: [],                            mode: 'piece', basis: 'qty'  },
  { id: 'free',   label: '기타',      hint: '직접 입력',                units: [],                                  specUnits: ['kg', 'g', 'ml', 'L', '매', 'm', 'cm', 'mm', '장', '개', '회', '인분', '알', '권'], mode: 'free', basis: 'spec' },
]

const chip = (on: boolean) =>
  `min-h-[40px] px-3.5 rounded-lg border text-sm font-medium transition-colors ${
    on ? 'bg-[var(--coral)] border-[var(--coral)] text-[var(--on-solid)]'
       : 'bg-[var(--canvas)] border-[var(--warm-border)] text-[var(--warm-dark)] hover:border-[var(--coral)]'}`
const inputCls = 'bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2.5 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)]'

export function SpecWizard({ open, onClose, onComplete, itemLabel, unitsOnly = false, z = 260 }: {
  open: boolean
  onClose: () => void
  onComplete: (r: SpecWizardResult) => void
  itemLabel?: string              // 요약 표시용
  unitsOnly?: boolean             // true = 수량 단계 생략(추적 품목 추가처럼 단위만 정할 때)
  z?: 200 | 260 | 280
}) {
  const [step, setStep] = useState(0)                       // 0 포장형태 · 1 규격 · 2 수량
  const [group, setGroup] = useState<Group | null>(null)
  const [qtyUnit, setQtyUnit] = useState('')
  const [specValue, setSpecValue] = useState('')
  const [specUnit, setSpecUnit] = useState('')
  const [specText, setSpecText] = useState('')
  const [pieceMode, setPieceMode] = useState<'none' | 'text'>('none')   // 낱개: 수량만 / 서술
  const [qtyValue, setQtyValue] = useState('')

  useEffect(() => {
    if (!open) return
    setStep(0); setGroup(null); setQtyUnit(''); setSpecValue(''); setSpecUnit(''); setSpecText(''); setPieceMode('none'); setQtyValue('')
  }, [open])

  const pickUnit = (g: Group, u: string) => {
    setGroup(g); setQtyUnit(u)
    if (g.specUnits.length === 1) setSpecUnit(g.specUnits[0])
    setStep(1)
  }

  const specDone = !group ? false
    : group.mode === 'piece' ? (pieceMode === 'none' || specText.trim() !== '')
    : group.mode === 'free'  ? true   // 기타: 규격 생략 허용
    : unitsOnly ? specUnit !== ''     // 단위만 정하는 모드(추적 품목): 값 불필요
    : (specValue.trim() !== '' && specUnit !== '')

  const finish = () => {
    if (!group) return
    const usingText = (group.mode === 'piece' && pieceMode === 'text') || (group.mode === 'free' && specText.trim() !== '' && !specValue.trim())
    onComplete({
      qtyUnit: qtyUnit || '개',
      qtyValue: unitsOnly ? '' : (qtyValue.trim() || '1'),
      specValue: usingText ? '' : specValue.trim(),
      specUnit:  usingText ? '' : (specValue.trim() ? specUnit : ''),
      specText:  usingText ? specText.trim() : '',
      unitBasis: usingText ? 'qty' : group.basis,
    })
    onClose()
  }

  const summarySpec = specText.trim() ? specText.trim() : (specValue && specUnit ? `${specValue}${specUnit}` : '')

  return (
    <Modal open={open} onClose={onClose} title="규격 단계별 입력" z={z} width="sm"
      subtitle={itemLabel ? `${itemLabel}. 포장형태에 맞춰 차례대로 골라주세요` : '포장형태에 맞춰 차례대로 골라주세요'}>
      <div className="p-5 space-y-4">
        {/* 단계 표시 */}
        <p className="text-[0.6875rem] text-[var(--warm-muted)]">
          <span className={step === 0 ? 'font-bold text-[var(--coral)]' : ''}>1 포장형태</span>
          <svg className="mx-1.5 inline align-middle" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M9 18l6-6-6-6" /></svg>
          <span className={step === 1 ? 'font-bold text-[var(--coral)]' : ''}>2 규격</span>
          {!unitsOnly && (<><svg className="mx-1.5 inline align-middle" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M9 18l6-6-6-6" /></svg><span className={step === 2 ? 'font-bold text-[var(--coral)]' : ''}>3 수량</span></>)}
        </p>

        {step === 0 && (
          <div className="space-y-3">
            {GROUPS.map(g => (
              <div key={g.id}>
                <p className="text-xs font-semibold text-[var(--warm-dark)]">{g.label} <span className="font-normal text-[var(--warm-muted)]">· {g.hint}</span></p>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {g.units.length > 0 ? g.units.map(u => (
                    <button key={u} type="button" className={chip(false)} onClick={() => pickUnit(g, u)}>{u}</button>
                  )) : (
                    <FreeUnitInput onPick={u => pickUnit(g, u)} />
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {step === 1 && group && (
          <div className="space-y-3">
            {group.mode === 'piece' ? (
              <>
                <p className="text-sm text-[var(--warm-dark)]">낱개 품목이에요. 규격이 필요한가요?</p>
                <div className="flex flex-wrap gap-1.5">
                  <button type="button" className={chip(pieceMode === 'none')} onClick={() => { setPieceMode('none'); setSpecText('') }}>규격 없음 (수량만)</button>
                  <button type="button" className={chip(pieceMode === 'text')} onClick={() => setPieceMode('text')}>치수·용도 서술</button>
                </div>
                {pieceMode === 'text' && (
                  <input value={specText} onChange={e => setSpecText(e.target.value)} autoFocus
                    placeholder="예: 50L용, 40mm, 1200x600mm" className={`w-full ${inputCls}`} />
                )}
              </>
            ) : (
              <>
                <p className="text-sm text-[var(--warm-dark)]">{unitsOnly ? `${qtyUnit} 안 내용물은 어떤 단위로 재나요?` : `${qtyUnit} 하나에 얼마나 들어 있나요?`}</p>
                <div className="flex gap-1.5 items-center">
                  {!unitsOnly && (
                  <input value={specValue} inputMode="decimal" autoFocus
                    onChange={e => setSpecValue(e.target.value.replace(/[^0-9.]/g, ''))}
                    placeholder="값" className={`w-24 ${inputCls} tabular-nums`} />
                  )}
                  <div className="flex flex-wrap gap-1.5">
                    {group.specUnits.map(u => (
                      <button key={u} type="button" className={chip(specUnit === u)} onClick={() => setSpecUnit(u)}>{u}</button>
                    ))}
                  </div>
                </div>
                {group.mode === 'free' && (
                  <div>
                    <p className="text-xs text-[var(--warm-muted)] mb-1">또는 치수·용도 서술 (선택)</p>
                    <input value={specText} onChange={e => setSpecText(e.target.value)}
                      placeholder="예: 1200x600mm" className={`w-full ${inputCls}`} />
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {step === 2 && !unitsOnly && (
          <div className="space-y-2">
            <p className="text-sm text-[var(--warm-dark)]">몇 {qtyUnit} 샀나요?</p>
            <input value={qtyValue} inputMode="decimal" autoFocus
              onChange={e => setQtyValue(e.target.value.replace(/[^0-9.]/g, ''))}
              placeholder="1" className={`w-28 ${inputCls} tabular-nums`} />
            <p className="text-xs text-[var(--warm-muted)]">
              {itemLabel ? `${itemLabel} · ` : ''}{summarySpec ? `${summarySpec} × ` : ''}{qtyValue || '1'}{qtyUnit}
            </p>
          </div>
        )}

        <div className="flex gap-2 pt-1">
          {step > 0 ? (
            <Btn type="button" variant="secondary" size="md" className="flex-1" onClick={() => setStep(s => s - 1)}>뒤로</Btn>
          ) : (
            <Btn type="button" variant="secondary" size="md" className="flex-1" onClick={onClose}>취소</Btn>
          )}
          {step === 1 && (unitsOnly || group?.mode !== undefined) && (
            unitsOnly ? (
              <Btn type="button" variant="primary" size="md" className="flex-1" onClick={finish} disabled={!specDone}>완료</Btn>
            ) : (
              <Btn type="button" variant="primary" size="md" className="flex-1" onClick={() => setStep(2)} disabled={!specDone}>다음</Btn>
            )
          )}
          {step === 2 && !unitsOnly && (
            <Btn type="button" variant="primary" size="md" className="flex-1" onClick={finish}>완료</Btn>
          )}
        </div>
      </div>
    </Modal>
  )
}

// '기타' 포장형태 — 수량 단위 직접 입력 후 진행
function FreeUnitInput({ onPick }: { onPick: (u: string) => void }) {
  const [v, setV] = useState('')
  return (
    <span className="flex gap-1.5 items-center">
      <input value={v} onChange={e => setV(e.target.value)} placeholder="단위 직접 입력 (예: 케이스)"
        className={inputCls} />
      <Btn type="button" variant="secondary" size="sm" onClick={() => v.trim() && onPick(v.trim())} disabled={!v.trim()}>선택</Btn>
    </span>
  )
}
